// Bateria de testes do Balcão de Inscrições.
//
// Roda contra o banco de verdade usando SÓ a chave pública — exatamente o que
// um visitante mal-intencionado teria na mão. A pergunta que cada teste
// responde é: "o que dá para fazer sem ter conta?"
//
//   node testes/seguranca.mjs
//
// Não escreve nada no banco. Pode rodar a qualquer momento, inclusive com o
// evento no ar.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(join(aqui, "..", "site", "config.js"), "utf8");
const URL_BASE = (config.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1];
const CHAVE = (config.match(/supabaseAnonKey:\s*"([^"]+)"/) || [])[1];

if (!URL_BASE || !CHAVE) {
  console.error("Não achei a configuração. Rode antes: node configurar.mjs <endereço>");
  process.exit(1);
}

const verde = t => "\x1b[32m" + t + "\x1b[0m";
const vermelho = t => "\x1b[31m" + t + "\x1b[0m";
const cinza = t => "\x1b[90m" + t + "\x1b[0m";

const cabecalhos = { apikey: CHAVE, Authorization: "Bearer " + CHAVE, "Content-Type": "application/json" };
const rest = (caminho, opcoes = {}) =>
  fetch(URL_BASE + "/rest/v1/" + caminho, { headers: cabecalhos, ...opcoes });
const rpc = (nome, corpo = {}) =>
  rest("rpc/" + nome, { method: "POST", body: JSON.stringify(corpo) });

let passou = 0, falhou = 0;
const tempos = [];

async function teste(nome, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    tempos.push(ms);
    console.log(verde("  ok  ") + nome + cinza("  " + ms + "ms"));
    passou++;
  } catch (e) {
    console.log(vermelho("FALHOU  ") + nome);
    console.log("        " + e.message);
    falhou++;
  }
}
const confere = (condicao, mensagem) => { if (!condicao) throw new Error(mensagem); };

console.log("\nBalcão de Inscrições — testes de segurança e contrato");
console.log(cinza("projeto: " + URL_BASE) + "\n");

/* ------------------------------------------------ o que deve ser público -- */
console.log("O que QUALQUER pessoa pode ver:\n");

await teste("a lista de eventos publicados responde", async () => {
  const r = await rpc("eventos_publicos");
  confere(r.ok, "status " + r.status);
  const j = await r.json();
  confere(Array.isArray(j), "deveria devolver uma lista");
});

await teste("a identidade do site responde sem expor o Pix", async () => {
  const r = await rpc("identidade");
  confere(r.ok, "status " + r.status);
  const j = await r.json();
  confere(j && typeof j === "object", "deveria devolver um objeto");
  confere(!("chave_pix" in j), "VAZAMENTO: a chave Pix veio na identidade pública");
  confere(!("beneficiario" in j), "VAZAMENTO: o beneficiário veio na identidade pública");
});

await teste("a lista de eventos com resultado responde", async () => {
  const r = await rpc("eventos_com_resultado");
  confere(r.ok, "status " + r.status);
  confere(Array.isArray(await r.json()), "deveria devolver uma lista");
});

await teste("eventos em rascunho não aparecem para o público", async () => {
  const r = await rest("eventos?select=id,publicado");
  confere(r.ok, "status " + r.status);
  const j = await r.json();
  confere(j.every(e => e.publicado === true), "um evento não publicado apareceu");
});

/* ------------------------------------------- o que NÃO pode ser possível -- */
console.log("\nO que NINGUÉM consegue fazer sem conta:\n");

await teste("ler a lista de inscritos", async () => {
  const r = await rest("inscricoes?select=id,participante_nome,participante_email");
  const j = await r.json();
  confere(Array.isArray(j) && j.length === 0,
    "VAZAMENTO GRAVE: vieram " + (Array.isArray(j) ? j.length : "?") + " inscrições");
});

await teste("ler a chave Pix da organização", async () => {
  const r = await rest("configuracao?select=chave_pix,beneficiario");
  const j = await r.json();
  confere(Array.isArray(j) && j.length === 0, "VAZAMENTO: a configuração foi lida sem conta");
});

await teste("ler os perfis das pessoas", async () => {
  const r = await rest("perfis?select=id,nome,telefone");
  const j = await r.json();
  confere(Array.isArray(j) && j.length === 0, "VAZAMENTO: perfis foram lidos sem conta");
});

await teste("descobrir quem é organizador", async () => {
  const r = await rest("organizadores?select=user_id");
  const j = await r.json();
  confere(Array.isArray(j) && j.length === 0, "VAZAMENTO: a lista de organizadores foi lida");
});

await teste("inserir uma inscrição direto na tabela", async () => {
  const r = await rest("inscricoes", {
    method: "POST",
    body: JSON.stringify({
      evento_id: "00000000-0000-0000-0000-000000000000",
      titular_id: "00000000-0000-0000-0000-000000000000",
      participante_nome: "INVASOR", codigo: "XXX-999", valor_centavos: 0
    })
  });
  confere(!r.ok, "BRECHA GRAVE: a inserção direta foi aceita");
});

await teste("alterar a chave Pix", async () => {
  const r = await rest("configuracao?id=eq.true", {
    method: "PATCH",
    body: JSON.stringify({ chave_pix: "pix-do-invasor@exemplo.com" })
  });
  const j = await r.json().catch(() => []);
  confere(!r.ok || (Array.isArray(j) && j.length === 0),
    "BRECHA GRAVÍSSIMA: a chave Pix foi alterada sem conta");
});

await teste("se promover a organizador", async () => {
  const r = await rest("organizadores", {
    method: "POST",
    body: JSON.stringify({ user_id: "00000000-0000-0000-0000-000000000000" })
  });
  confere(!r.ok, "BRECHA GRAVE: qualquer um vira organizador");
});

await teste("chamar a função de inscrever sem estar logado", async () => {
  const r = await rpc("inscrever", {
    p_evento: "00000000-0000-0000-0000-000000000000", p_nome: "INVASOR"
  });
  confere(!r.ok, "BRECHA: inscrever aceitou chamada anônima");
  const j = await r.json().catch(() => ({}));
  confere(/conta|autentic|28000|not found|encontrado/i.test(JSON.stringify(j)),
    "a recusa deveria ser por falta de conta, veio: " + JSON.stringify(j).slice(0, 90));
});

await teste("ver a equipe da organização", async () => {
  const r = await rpc("listar_organizadores");
  confere(!r.ok, "VAZAMENTO: a equipe foi listada sem conta");
});

await teste("promover alguém a organizador pela função", async () => {
  const r = await rpc("promover_organizador", { p_email: "invasor@exemplo.com" });
  confere(!r.ok, "BRECHA GRAVE: promoção aceita sem conta");
});

await teste("pegar os dados de cobrança de uma inscrição", async () => {
  const r = await rpc("cobranca", { p_inscricao: "00000000-0000-0000-0000-000000000000" });
  confere(!r.ok, "VAZAMENTO: dados de cobrança devolvidos sem conta");
});

await teste("cancelar a inscrição de outra pessoa", async () => {
  const r = await rpc("cancelar_inscricao", { p_inscricao: "00000000-0000-0000-0000-000000000000" });
  confere(!r.ok, "BRECHA GRAVE: cancelamento aceito sem conta");
});

await teste("apagar um evento", async () => {
  const r = await rest("eventos?id=eq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
  const j = await r.json().catch(() => []);
  confere(!r.ok || (Array.isArray(j) && j.length === 0), "BRECHA: exclusão aceita sem conta");
});

await teste("gerar códigos de inscrição à vontade", async () => {
  const r = await rpc("gerar_codigo");
  confere(!r.ok, "a função de gerar código deveria ser interna");
});

/* --------------------------------------------------- saúde e desempenho -- */
console.log("\nSaúde do serviço:\n");

await teste("o balde de imagens existe e é público", async () => {
  const r = await fetch(URL_BASE + "/storage/v1/object/public/capas/_inexistente.png", { headers: cabecalhos });
  const t = await r.text();
  confere(/NoSuchKey|Object not found/i.test(t), "o balde 'capas' não parece existir: " + t.slice(0, 80));
});

await teste("o site publicado responde", async () => {
  const r = await fetch("https://alta-pista.netlify.app/", { redirect: "follow" });
  confere(r.ok, "o site respondeu " + r.status);
  const html = await r.text();
  confere(/Balc/i.test(html), "a página não parece a do Balcão");
});

await teste("o site não expõe chave secreta no código", async () => {
  for (const arq of ["app.js", "api.js", "config.js"]) {
    const t = await (await fetch("https://alta-pista.netlify.app/" + arq)).text();
    confere(!/sb_secret_|service_role"\s*:/.test(t), "chave secreta encontrada em " + arq);
  }
});

/* ------------------------------------------------------------- resumo --- */
const media = tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : 0;
console.log("\n" + (passou + falhou) + " testes · " + verde(passou + " passaram") +
  (falhou ? " · " + vermelho(falhou + " falharam") : "") +
  cinza(" · resposta média " + media + "ms"));

if (falhou) {
  console.log(vermelho("\nHá falhas de segurança. Não divulgue o site até resolver.\n"));
  process.exit(1);
}
console.log(verde("\nNenhuma brecha encontrada.\n"));
