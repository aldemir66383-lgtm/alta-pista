import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { universal } from "../lib/handler.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const MP_API = "https://api.mercadopago.com";
const EXPIRA_MINUTOS = 35;   // o Mercado Pago exige folga; a tela mostra ~35 min

function ambiente() {
  const req = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MERCADOPAGO_ACCESS_TOKEN"];
  if (req.some(k => !process.env[k]))
    throw new Error("Pagamento automático ainda não foi configurado.");
}

function urlDoSite(request) {
  // Ordem: um override manual; a Vercel (domínio de produção estável); a
  // Netlify; e, por último, a origem do próprio pedido. O que importa é o
  // endereço público onde o Mercado Pago vai bater com o aviso de pagamento.
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.URL) return process.env.URL.replace(/\/$/, "");
  try { return new URL(request.url).origin; } catch { return ""; }
}

export default universal(async request => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    ambiente();
    const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Entre na sua conta para gerar o Pix." }, 401);

    const body = await request.json().catch(() => ({}));
    const inscricaoId = String(body.inscricaoId || "");
    if (!/^[0-9a-f-]{36}$/i.test(inscricaoId)) return json({ error: "Inscrição inválida." }, 400);

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: auth, error: authError } = await sb.auth.getUser(token);
    if (authError || !auth?.user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401);

    const { data: inscricao, error: inscricaoError } = await sb.from("inscricoes")
      .select("id,titular_id,status,valor_centavos,codigo")
      .eq("id", inscricaoId).maybeSingle();
    if (inscricaoError || !inscricao || inscricao.titular_id !== auth.user.id)
      return json({ error: "Esta inscrição não é sua." }, 403);
    if (inscricao.status !== "pendente" || inscricao.valor_centavos <= 0)
      return json({ error: "Esta inscrição não tem pagamento pendente." }, 409);

    const agora = new Date().toISOString();

    // Reaproveita uma cobrança ainda válida em vez de criar QR atrás de QR.
    const { data: ativa } = await sb.from("pix_cobrancas")
      .select("correlation_id,transaction_id,valor_centavos,payload_pix,expira_em,status")
      .eq("inscricao_id", inscricao.id).eq("status", "ativa").gt("expira_em", agora)
      .order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (ativa) return json({ ...ativa, reutilizada: true });

    await sb.from("pix_cobrancas").update({ status: "expirada", atualizado_em: agora })
      .eq("inscricao_id", inscricao.id).eq("status", "ativa").lte("expira_em", agora);

    const correlationId = randomUUID();
    const expiraEm = new Date(Date.now() + EXPIRA_MINUTOS * 60 * 1000);

    const response = await fetch(MP_API + "/v1/payments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + process.env.MERCADOPAGO_ACCESS_TOKEN,
        "x-idempotency-key": correlationId
      },
      body: JSON.stringify({
        transaction_amount: Number((inscricao.valor_centavos / 100).toFixed(2)),
        description: "Inscrição " + inscricao.codigo,
        payment_method_id: "pix",
        date_of_expiration: expiraEm.toISOString().replace("Z", "-00:00"),
        external_reference: correlationId,
        notification_url: urlDoSite(request) + "/api/webhook-mercadopago-pix",
        payer: { email: auth.user.email }
      })
    });
    const mp = await response.json().catch(() => ({}));
    const tx = mp?.point_of_interaction?.transaction_data;
    if (!response.ok || !mp.id || !tx?.qr_code)
      throw new Error("O Mercado Pago não conseguiu criar a cobrança agora.");

    const row = {
      inscricao_id: inscricao.id,
      correlation_id: correlationId,
      transaction_id: String(mp.id),
      valor_centavos: inscricao.valor_centavos,
      status: "ativa",
      payload_pix: tx.qr_code,
      expira_em: mp.date_of_expiration || expiraEm.toISOString()
    };
    const { error: saveError } = await sb.from("pix_cobrancas").insert(row);
    if (saveError) throw new Error("Não foi possível registrar a cobrança.");

    return json({ ...row, qrCodeImageBase64: tx.qr_code_base64, reutilizada: false });
  } catch (error) {
    console.error("criar-cobranca-pix", error);
    return json({ error: error.message || "Não foi possível gerar o Pix." }, 500);
  }
});
