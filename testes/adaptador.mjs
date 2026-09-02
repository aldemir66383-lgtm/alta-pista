// Testes do adaptador que faz a mesma função servir na Vercel e na Netlify.
//
// Este arquivo existe por causa de um defeito real: as funções de pagamento
// estavam escritas no formato da Netlify (request → Response) e, publicadas na
// Vercel, ficavam penduradas até o timeout — sem erro, sem log, sem resposta.
// A causa era a Vercel chamar handler(req, res), no estilo do Node, e o
// `Response` devolvido ir para o lixo.
//
// Os testes abaixo chamam o mesmo handler pelos dois caminhos e conferem que
// nos dois sai resposta de verdade.
//
//   node testes/adaptador.mjs

import { Readable } from "node:stream";
import { universal } from "../lib/handler.mjs";

const verde = t => "\x1b[32m" + t + "\x1b[0m";
const vermelho = t => "\x1b[31m" + t + "\x1b[0m";

let passou = 0, falhou = 0;
async function teste(nome, fn) {
  try { await fn(); console.log(verde("  ok  ") + nome); passou++; }
  catch (e) { console.log(vermelho("FALHOU  ") + nome + "\n        " + e.message); falhou++; }
}
const confere = (c, m) => { if (!c) throw new Error(m); };
const igual = (a, b, m) => {
  if (a !== b) throw new Error(m + " — esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
};

console.log("\nBalcão de Inscrições — adaptador das funções de servidor\n");

/* ------------------------------------------------------------------ */
/* Um handler de mentira, no formato da web, que devolve o que recebeu */

const handler = universal(async request => {
  if (request.method !== "POST")
    return new Response(JSON.stringify({ error: "Método não permitido." }),
      { status: 405, headers: { "content-type": "application/json" } });

  const corpo = await request.json().catch(() => ({}));
  return new Response(JSON.stringify({
    ok: true,
    metodo: request.method,
    autorizacao: request.headers.get("authorization") || null,
    busca: new URL(request.url).searchParams.get("data.id"),
    recebido: corpo
  }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
});

/** Resposta do Node de mentira, que guarda o que foi escrito. */
function respostaFalsa() {
  return {
    statusCode: 0, headersSent: false, cabecalhos: {}, corpo: null, terminou: false,
    setHeader(nome, valor) { this.cabecalhos[String(nome).toLowerCase()] = valor; },
    end(dado) { this.corpo = dado == null ? "" : String(dado); this.terminou = true; }
  };
}

/** Pedido do Node de mentira. `corpoPronto` imita a Vercel já tendo lido tudo. */
function pedidoFalso({ method = "POST", url = "/api/x", headers = {}, corpo = "", corpoPronto } = {}) {
  const req = corpoPronto === undefined ? Readable.from([Buffer.from(corpo)]) : Readable.from([]);
  req.method = method;
  req.url = url;
  req.headers = { host: "alta-pista.vercel.app", ...headers };
  if (corpoPronto !== undefined) req.body = corpoPronto;
  return req;
}

/* ------------------------------------------------------- estilo web ----- */

await teste("no formato da Netlify, devolve o Response direto", async () => {
  const r = await handler(new Request("https://alta-pista.vercel.app/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inscricaoId: "abc" })
  }));
  confere(r instanceof Response, "devia devolver um Response");
  igual(r.status, 200, "status");
  const j = await r.json();
  igual(j.recebido.inscricaoId, "abc", "o corpo chegou");
});

await teste("o segundo argumento da Netlify (context) não confunde o adaptador", async () => {
  const r = await handler(
    new Request("https://alta-pista.vercel.app/api/x", { method: "POST", body: "{}" }),
    { requestId: "netlify-123" }            // context, sem setHeader
  );
  confere(r instanceof Response, "devia continuar no caminho web");
  igual(r.status, 200, "status");
});

/* ------------------------------------------------------ estilo Node ----- */

await teste("no formato da Vercel, escreve a resposta em vez de devolvê-la", async () => {
  const res = respostaFalsa();
  await handler(pedidoFalso({
    headers: { "content-type": "application/json", authorization: "Bearer xyz" },
    corpo: JSON.stringify({ inscricaoId: "def" })
  }), res);

  confere(res.terminou, "a resposta precisa ser encerrada, senão o pedido pendura");
  igual(res.statusCode, 200, "status");
  const j = JSON.parse(res.corpo);
  igual(j.recebido.inscricaoId, "def", "o corpo chegou");
  igual(j.autorizacao, "Bearer xyz", "o cabeçalho chegou");
});

await teste("o GET responde 405 na hora, em vez de pendurar", async () => {
  const res = respostaFalsa();
  await handler(pedidoFalso({ method: "GET" }), res);
  confere(res.terminou, "sem isso, é exatamente o defeito que estava no ar");
  igual(res.statusCode, 405, "status");
});

await teste("corpo já lido pela Vercel continua chegando ao handler", async () => {
  const res = respostaFalsa();
  await handler(pedidoFalso({
    headers: { "content-type": "application/json" },
    corpoPronto: { data: { id: "123456" } }   // objeto já interpretado
  }), res);
  const j = JSON.parse(res.corpo);
  igual(j.recebido.data.id, "123456", "o webhook perderia o id do pagamento");
});

await teste("os parâmetros de busca sobrevivem à conversão", async () => {
  const res = respostaFalsa();
  await handler(pedidoFalso({
    url: "/api/webhook-mercadopago-pix?type=payment&data.id=987",
    headers: { "content-type": "application/json" },
    corpo: "{}"
  }), res);
  igual(JSON.parse(res.corpo).busca, "987", "o formato antigo do Mercado Pago usa query");
});

await teste("o content-type definido pelo handler chega à resposta do Node", async () => {
  const res = respostaFalsa();
  await handler(pedidoFalso({ corpo: "{}" }), res);
  confere(/application\/json/.test(res.cabecalhos["content-type"] || ""),
    "veio " + JSON.stringify(res.cabecalhos["content-type"]));
});

await teste("handler que estoura vira 500, e não pedido pendurado", async () => {
  const quebrado = universal(async () => { throw new Error("boom"); });
  const res = respostaFalsa();
  const antes = console.error;          // o estouro é de propósito: não sujar a saída
  console.error = () => {};
  try { await quebrado(pedidoFalso({ corpo: "{}" }), res); }
  finally { console.error = antes; }
  confere(res.terminou, "precisa encerrar mesmo quebrando");
  igual(res.statusCode, 500, "status");
});

/* --------------------------------------------------------- fechamento --- */

console.log("\n" + (passou + falhou) + " testes · " +
  (falhou ? vermelho(falhou + " falharam") : verde(passou + " passaram")) + "\n");
process.exit(falhou ? 1 : 0);
