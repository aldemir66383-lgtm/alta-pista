// Confere, no site publicado, o que falta para o Pix confirmar sozinho.
//
//   node conferir-pagamento.mjs [endereço do site]
//
// Não precisa de senha nem de chave: descobre tudo pelas respostas públicas
// das funções. Serve para responder, em dez segundos, a pergunta que só se
// respondia abrindo três painéis diferentes — "já está ligado ou não?".

const SITE = (process.argv[2] || "https://alta-pista.vercel.app").replace(/\/$/, "");

const verde     = t => "\x1b[32m" + t + "\x1b[0m";
const vermelho  = t => "\x1b[31m" + t + "\x1b[0m";
const amarelo   = t => "\x1b[33m" + t + "\x1b[0m";
const sim  = "  " + verde("ok") + "    ";
const nao  = "  " + vermelho("falta") + " ";
const meio = "  " + amarelo("~") + "     ";

async function pedir(caminho, opcoes = {}) {
  const controle = new AbortController();
  const corte = setTimeout(() => controle.abort(), 25000);
  try {
    const r = await fetch(SITE + caminho, { ...opcoes, signal: controle.signal });
    const texto = await r.text();
    let corpo = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = { texto }; }
    return { status: r.status, corpo };
  } catch (e) {
    return { status: 0, corpo: { erro: String(e.message || e) } };
  } finally {
    clearTimeout(corte);
  }
}

const postJSON = corpo => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(corpo)
});

console.log("\n  Conferindo " + SITE + "\n");

/* 1. o site em si ------------------------------------------------------- */
const site = await pedir("/");
console.log(site.status === 200
  ? sim + "o site está no ar"
  : nao + "o site não respondeu (HTTP " + site.status + ")");

/* 2. as funções existem e respondem ------------------------------------- */
const viva = await pedir("/api/criar-cobranca-pix");
if (viva.status === 405) {
  console.log(sim + "a função de cobrança responde");
} else if (viva.status === 0) {
  console.log(nao + "a função de cobrança não respondeu — pendurada ou não publicada");
} else if (viva.status === 404) {
  console.log(nao + "a função de cobrança não está publicada (404)");
} else {
  console.log(meio + "a função de cobrança respondeu HTTP " + viva.status + " (esperado 405)");
}

/* 3. as chaves estão configuradas? -------------------------------------- */
const semLogin = await pedir("/api/criar-cobranca-pix", postJSON({}));
const recado = (semLogin.corpo && semLogin.corpo.error) || "";
let configurado = false;

if (semLogin.status === 401) {
  configurado = true;
  console.log(sim + "as chaves estão configuradas na Vercel");
} else if (/configurad/i.test(recado)) {
  console.log(nao + "as chaves ainda não estão na Vercel");
  console.log("        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e MERCADOPAGO_ACCESS_TOKEN");
  console.log("        em Project › Settings › Environment Variables");
} else {
  console.log(meio + "resposta inesperada da cobrança: HTTP " + semLogin.status +
    (recado ? " — " + recado : ""));
}

/* 4. o webhook ---------------------------------------------------------- */
const wh = await pedir("/api/webhook-mercadopago-pix", postJSON({}));
console.log(wh.status === 200
  ? sim + "o webhook responde"
  : nao + "o webhook não respondeu (HTTP " + wh.status + ")");

const whPago = await pedir("/api/webhook-mercadopago-pix?type=payment&data.id=999999",
  postJSON({ type: "payment", data: { id: "999999" } }));
const ignorou = (whPago.corpo && whPago.corpo.ignored) || "";
if (/desconhecida/i.test(ignorou)) {
  console.log(sim + "o webhook já fala com o banco e com o Mercado Pago");
} else if (/configurad/i.test(ignorou)) {
  console.log(nao + "o webhook está no ar, mas sem as chaves");
} else if (whPago.status === 200) {
  console.log(meio + "o webhook respondeu: " + JSON.stringify(whPago.corpo));
}

/* 5. veredito ----------------------------------------------------------- */
console.log("");
if (configurado && /desconhecida/i.test(ignorou)) {
  console.log("  " + verde("Tudo ligado.") + " O Pix deve confirmar sozinho.");
  console.log("  Faça uma inscrição de teste e pague para ver a inscrição virar");
  console.log("  paga sem ninguém conferir extrato.\n");
} else if (viva.status === 405) {
  console.log("  As funções estão publicadas e respondendo, mas ainda falta a");
  console.log("  configuração. Enquanto isso o site usa o Pix manual: a pessoa");
  console.log("  paga e alguém confirma no Painel. Nada quebra.\n");
  console.log("  O passo a passo está no README, em \"Confirmação automática do");
  console.log("  pagamento › Ligar (uma vez)\".\n");
} else {
  console.log("  As funções não estão respondendo. Enquanto isso o site cai no");
  console.log("  Pix manual sozinho, então ninguém fica sem se inscrever.\n");
}
