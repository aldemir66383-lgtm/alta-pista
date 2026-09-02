// Regras puras da integração com o Mercado Pago — sem rede, sem banco.
//
// Ficam separadas para poderem ser testadas isoladamente, sem subir função
// nem falar com a API (ver testes/webhook-mercadopago.mjs). O que decide se um
// pagamento entrou é a reconsulta ao Mercado Pago, não o corpo do webhook;
// estas funções só interpretam esses dados.

import crypto from "node:crypto";

/**
 * A notificação do Mercado Pago chega de dois jeitos: no corpo JSON
 * ({ type: "payment", data: { id } }) ou como parâmetros de query
 * (?type=payment&data.id=123, o formato antigo "IPN"). Só interessa o id de um
 * evento de pagamento; qualquer outro tópico (merchant_order, plan…) é
 * ignorado. Devolve só os dígitos, porque às vezes o id vem dentro de uma URL.
 */
export function idDoPagamento({ body, query } = {}) {
  const tipo = body?.type || body?.topic || query?.type || query?.topic || "";
  if (tipo && !/payment/i.test(tipo)) return null;
  const bruto = body?.data?.id || body?.resource ||
    query?.["data.id"] || query?.id || null;
  if (!bruto) return null;
  // `resource` às vezes vem como URL (.../v1/payments/123): pega o último
  // trecho do caminho, não todos os dígitos (senão o "1" de "v1" entra junto).
  const ultimo = String(bruto).replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop();
  const digitos = String(ultimo).replace(/\D/g, "");
  return digitos || null;
}

/**
 * Decide se a consulta ao pagamento confirma a cobrança.
 *
 *   pagamento  corpo do GET /v1/payments/{id}
 *   cobranca   linha de pix_cobrancas (precisa de correlation_id e valor_centavos)
 *
 * Só devolve { confirmar: true } quando o pagamento está aprovado, aponta para
 * a nossa cobrança (external_reference) e o valor bate exatamente — qualquer
 * folga aqui é dinheiro a menos aceito como inscrição paga.
 */
export function avaliarPagamento(pagamento, cobranca) {
  if (!pagamento || pagamento.status !== "approved")
    return { confirmar: false, motivo: "pagamento ainda não aprovado" };

  if (cobranca?.correlation_id && pagamento.external_reference &&
      pagamento.external_reference !== cobranca.correlation_id)
    return { confirmar: false, motivo: "pagamento de outra cobrança" };

  const esperado = Number(cobranca?.valor_centavos) / 100;
  if (!Number.isFinite(esperado) || Number(pagamento.transaction_amount) !== esperado)
    return { confirmar: false, motivo: "valor divergente" };

  return { confirmar: true, motivo: "ok" };
}

/**
 * Confere a assinatura `x-signature` do webhook: HMAC-SHA256, com o segredo do
 * painel do Mercado Pago, sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
 *
 *   - sem segredo configurado → devolve null (não dá para conferir; quem chama
 *     decide se aceita mesmo assim, apoiado na reconsulta)
 *   - assinatura ausente ou diferente → false
 *   - confere → true
 */
export function assinaturaConfere({ xSignature, xRequestId, dataId, secret } = {}) {
  if (!secret) return null;
  if (!xSignature) return false;

  const partes = Object.fromEntries(
    String(xSignature).split(",").map(p => {
      const i = p.indexOf("=");
      return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const ts = partes.ts, v1 = partes.v1;
  if (!ts || !v1) return false;

  const id = dataId ? String(dataId).toLowerCase() : "";
  const manifest = `id:${id};request-id:${xRequestId || ""};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(esperado, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}
