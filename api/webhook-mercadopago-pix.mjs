import { createClient } from "@supabase/supabase-js";
import { idDoPagamento, avaliarPagamento, assinaturaConfere } from "../lib/mercadopago.mjs";

const ok = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const MP_API = "https://api.mercadopago.com";

export default async request => {
  if (request.method !== "POST") return ok({ error: "Método não permitido." }, 405);

  try {
    // base fixa só para o parser aceitar `request.url` seja ele absoluto
    // (Vercel/Netlify) ou só o caminho.
    const query = Object.fromEntries(
      new URL(request.url, "http://local").searchParams.entries());
    const body = await request.json().catch(() => ({}));

    const dataId = idDoPagamento({ body, query });
    if (!dataId) return ok({ received: true, ignored: "evento sem id de pagamento" });

    // Camada extra: se o segredo do painel do Mercado Pago estiver configurado,
    // confere a assinatura. A prova real vem da reconsulta mais abaixo.
    const assinatura = assinaturaConfere({
      xSignature: request.headers.get("x-signature"),
      xRequestId: request.headers.get("x-request-id"),
      dataId: query["data.id"] || dataId,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET
    });
    if (assinatura === false) return ok({ error: "Assinatura inválida." }, 401);

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY ||
        !process.env.MERCADOPAGO_ACCESS_TOKEN)
      return ok({ received: true, ignored: "não configurado" });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: charge, error: chargeError } = await sb.from("pix_cobrancas")
      .select("*,inscricoes(id,status,valor_centavos)")
      .eq("transaction_id", String(dataId))
      .maybeSingle();

    // O webhook dispara para qualquer pagamento da conta, não só os nossos QR:
    // um id sem cobrança correspondente é normal, apenas ignora.
    if (chargeError || !charge) return ok({ received: true, ignored: "cobrança desconhecida" });
    if (charge.status === "paga") return ok({ received: true, duplicate: true });

    // Não basta confiar no POST recebido: consulta o pagamento direto no
    // Mercado Pago e confere estado, cobrança de origem e valor.
    const consulta = await fetch(MP_API + "/v1/payments/" + encodeURIComponent(dataId), {
      headers: { "authorization": "Bearer " + process.env.MERCADOPAGO_ACCESS_TOKEN }
    });
    const pagamento = await consulta.json().catch(() => ({}));
    if (!consulta.ok) return ok({ received: true, ignored: "consulta ao Mercado Pago falhou" });

    const veredito = avaliarPagamento(pagamento, charge);
    if (!veredito.confirmar) return ok({ received: true, ignored: veredito.motivo });

    if (!charge.inscricoes || charge.inscricoes.status !== "pendente")
      return ok({ received: true, ignored: "inscrição não está pendente" });

    const pagoEm = pagamento.date_approved || new Date().toISOString();
    const agora = new Date().toISOString();

    // A condição status='ativa' garante que uma reentrega do webhook não
    // "pague" duas vezes: a segunda não encontra linha para atualizar.
    const { data: atualizada, error: paymentError } = await sb.from("pix_cobrancas")
      .update({ status: "paga", end_to_end_id: String(pagamento.id), pago_em: pagoEm, atualizado_em: agora })
      .eq("id", charge.id).eq("status", "ativa")
      .select("id");
    if (paymentError) throw paymentError;
    if (!atualizada || !atualizada.length) return ok({ received: true, duplicate: true });

    const { error: registrationError } = await sb.from("inscricoes")
      .update({ status: "pago", pago_em: pagoEm })
      .eq("id", charge.inscricao_id).eq("status", "pendente");
    if (registrationError) throw registrationError;

    return ok({ received: true, confirmed: true });
  } catch (error) {
    console.error("webhook-mercadopago-pix", error);
    return ok({ error: "Falha temporária ao processar o evento." }, 500);
  }
};
