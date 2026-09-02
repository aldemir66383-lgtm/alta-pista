// Testes da confirmação automática de pagamento pelo Mercado Pago.
//
// O webhook é o que transforma "pendente" em "pago" sem ninguém conferir
// extrato. Se ele aceitar um evento que não devia — valor a menos, pagamento
// não aprovado, cobrança de outra pessoa, assinatura forjada — uma inscrição
// entra como paga de graça. Estas checagens travam a lógica pura, sem rede
// nem banco.
//
//   node testes/webhook-mercadopago.mjs

import crypto from "node:crypto";
import { idDoPagamento, avaliarPagamento, assinaturaConfere } from "../netlify/functions/_mercadopago.mjs";

const verde = t => "\x1b[32m" + t + "\x1b[0m";
const vermelho = t => "\x1b[31m" + t + "\x1b[0m";

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log(verde("  ok  ") + nome); passou++; }
  catch (e) { console.log(vermelho("FALHOU  ") + nome + "\n        " + e.message); falhou++; }
}
const confere = (c, m) => { if (!c) throw new Error(m); };
const igual = (a, b, m) => {
  if (a !== b) throw new Error(m + " — esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
};

console.log("\nBalcão de Inscrições — confirmação Pix pelo Mercado Pago\n");

/* ------------------------------------------------ idDoPagamento ---------- */

teste("acha o id no corpo JSON do webhook", () => {
  igual(idDoPagamento({ body: { type: "payment", data: { id: "123456" } } }), "123456", "id no corpo");
});

teste("acha o id nos parâmetros de query (IPN antigo)", () => {
  igual(idDoPagamento({ query: { type: "payment", "data.id": "789" } }), "789", "data.id na query");
});

teste("extrai o id de uma URL em resource", () => {
  igual(idDoPagamento({ body: { topic: "payment", resource: "https://api.mercadopago.com/v1/payments/555" } }),
    "555", "id dentro da URL");
});

teste("ignora tópicos que não são pagamento", () => {
  confere(idDoPagamento({ body: { type: "merchant_order", data: { id: "1" } } }) === null, "merchant_order deve ser null");
});

/* ---------------------------------------------- avaliarPagamento --------- */

const cobranca = { correlation_id: "corr-abc", valor_centavos: 8000 };

teste("confirma quando aprovado, da cobrança certa e com valor exato", () => {
  const r = avaliarPagamento(
    { status: "approved", external_reference: "corr-abc", transaction_amount: 80 }, cobranca);
  confere(r.confirmar, "deveria confirmar");
});

teste("recusa pagamento ainda pendente", () => {
  const r = avaliarPagamento(
    { status: "pending", external_reference: "corr-abc", transaction_amount: 80 }, cobranca);
  confere(!r.confirmar, "pendente não pode confirmar");
});

teste("recusa pagamento de outra cobrança", () => {
  const r = avaliarPagamento(
    { status: "approved", external_reference: "corr-xyz", transaction_amount: 80 }, cobranca);
  confere(!r.confirmar, "external_reference diferente");
  igual(r.motivo, "pagamento de outra cobrança", "motivo");
});

teste("recusa valor diferente do cobrado", () => {
  const r = avaliarPagamento(
    { status: "approved", external_reference: "corr-abc", transaction_amount: 50 }, cobranca);
  confere(!r.confirmar, "valor a menos não pode passar");
  igual(r.motivo, "valor divergente", "motivo");
});

teste("recusa resposta vazia", () => {
  confere(!avaliarPagamento({}, cobranca).confirmar, "resposta vazia");
  confere(!avaliarPagamento(null, cobranca).confirmar, "resposta nula");
});

/* --------------------------------------------- assinaturaConfere -------- */

const assinar = (secret, dataId, xRequestId, ts) => {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId || ""};ts:${ts};`;
  return crypto.createHmac("sha256", secret).update(manifest).digest("hex");
};

teste("sem segredo configurado, devolve null (não dá para conferir)", () => {
  igual(assinaturaConfere({ xSignature: "ts=1,v1=abc", dataId: "1" }), null, "sem secret");
});

teste("assinatura correta confere", () => {
  const v1 = assinar("s3cr3t", "123", "req-1", "1700000000");
  const r = assinaturaConfere({
    xSignature: `ts=1700000000,v1=${v1}`, xRequestId: "req-1", dataId: "123", secret: "s3cr3t"
  });
  confere(r === true, "deveria conferir");
});

teste("assinatura adulterada é recusada", () => {
  const v1 = assinar("s3cr3t", "123", "req-1", "1700000000");
  const r = assinaturaConfere({
    xSignature: `ts=1700000000,v1=${v1.replace(/.$/, "0")}`, xRequestId: "req-1", dataId: "123", secret: "s3cr3t"
  });
  confere(r === false, "deveria recusar");
});

teste("assinatura ausente com segredo configurado é recusada", () => {
  confere(assinaturaConfere({ dataId: "1", secret: "s3cr3t" }) === false, "sem x-signature");
});

/* ----------------------------------------------------------------------- */

console.log("\n" + (falhou ? vermelho(falhou + " falhou") : verde("tudo certo")) +
  " — " + passou + " passaram\n");
process.exit(falhou ? 1 : 0);
