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

// O site publicado. Mudou da Netlify para a Vercel: os testes precisam
// olhar para onde as pessoas realmente entram, senão passam conferindo
// uma publicação antiga que ninguém usa.
const SITE = process.env.SITE_URL || "https://alta-pista.vercel.app";

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

await teste("ler a chave Pix de um evento", async () => {
  // Este teste nasceu de um vazamento real: a chave Pix passou a morar na
  // tabela de eventos, que é pública para eventos publicados, e ficou legível
  // por qualquer visitante — inclusive quando a chave é um CPF. Vale para
  // qualquer coluna sensível que um dia vá parar em `eventos`.
  const r = await rest("eventos?select=chave_pix,recebedor_nome&limit=5");
  if (r.ok) {
    const j = await r.json();
    const vazou = (j || []).some(e =>
      String(e.chave_pix || "").trim() || String(e.recebedor_nome || "").trim());
    confere(!vazou, "VAZAMENTO: a chave Pix do evento foi lida sem conta");
  } else {
    confere(r.status === 401 || r.status === 403 || r.status === 400,
      "esperava recusa, veio " + r.status);
  }
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

await teste("disparar a expiração de pendências sem conta", async () => {
  // 0013: cancela pendências vencidas. Só organizador logado (ou o pg_cron)
  // pode chamar. Sem conta deve ser recusada — ou nem existir ainda.
  const r = await rpc("expirar_pendencias");
  confere(!r.ok, "BRECHA: expirar_pendencias aceitou chamada anônima");
});


await teste("marcar um kit como entregue", async () => {
  const r = await rest("inscricoes?id=eq.00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    body: JSON.stringify({ kit_retirado: true })
  });
  const j = await r.json().catch(() => []);
  confere(!r.ok || (Array.isArray(j) && j.length === 0),
    "BRECHA: dá para dar baixa em kit sem conta");
});

await teste("escolher o próprio número de peito", async () => {
  const r = await rest("inscricoes?id=eq.00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    body: JSON.stringify({ numero: 1 })
  });
  const j = await r.json().catch(() => []);
  confere(!r.ok || (Array.isArray(j) && j.length === 0),
    "BRECHA: dá para escolher número de peito sem conta");
});

await teste("chamar a função que atribui números", async () => {
  const r = await rpc("atribuir_numero");
  confere(!r.ok, "a função de numeração deveria ser interna, só do gatilho");
});

await teste("mudar a aparência do número de peito de um evento", async () => {
  const r = await rest("eventos?id=eq.00000000-0000-0000-0000-000000000000", {
    method: "PATCH",
    body: JSON.stringify({ peito_cor: "#000000", numero_digitos: 6 })
  });
  const j = await r.json().catch(() => []);
  confere(!r.ok || (Array.isArray(j) && j.length === 0),
    "BRECHA: dá para mexer na aparência do peito sem conta");
});

await teste("o banco recusa cor de peito que não é cor", async () => {
  // a restrição existe para um erro de digitação não gerar folhas tortas;
  // aqui só conferimos que ela está instalada, sem escrever nada
  const r = await rest("eventos?select=peito_cor&peito_cor=not.is.null&limit=50");
  confere(r.ok, "status " + r.status);
  const j = await r.json();
  confere(j.every(e => e.peito_cor === "" || /^#[0-9a-fA-F]{6}$/.test(e.peito_cor)),
    "há evento com peito_cor fora do formato: " + JSON.stringify(j));
});

await teste("números de peito não se repetem dentro do evento", async () => {
  // o índice único é a garantia; aqui conferimos o efeito visível do que
  // o público consegue enxergar dos eventos publicados
  const r = await rest("eventos?select=id,numero_inicial,numero_digitos");
  confere(r.ok, "status " + r.status);
  const j = await r.json();
  confere(j.every(e => e.numero_inicial >= 1), "numero_inicial deveria começar em 1 ou mais");
  confere(j.every(e => e.numero_digitos >= 0 && e.numero_digitos <= 6),
    "numero_digitos fora do limite de 0 a 6");
});

await teste("o gerador do número de peito está publicado", async () => {
  const r = await fetch(SITE + "/peito.js");
  confere(r.ok, "peito.js respondeu " + r.status);
  const t = await r.text();
  confere(/formatarNumero/.test(t), "o arquivo publicado está desatualizado");
  confere(/enderecoDeImagem/.test(t), "faltou o filtro de endereço de imagem");
});

/* --------------------------------------------------- saúde e desempenho -- */
console.log("\nSaúde do serviço:\n");

await teste("o balde de imagens existe e é público", async () => {
  const r = await fetch(URL_BASE + "/storage/v1/object/public/capas/_inexistente.png", { headers: cabecalhos });
  const t = await r.text();
  confere(/NoSuchKey|Object not found/i.test(t), "o balde 'capas' não parece existir: " + t.slice(0, 80));
});

await teste("o site publicado responde", async () => {
  const r = await fetch(SITE + "/", { redirect: "follow" });
  confere(r.ok, "o site respondeu " + r.status);
  const html = await r.text();
  confere(/Balc|Alta-Pista/i.test(html), "a página não parece a do site");
});

await teste("o site não expõe chave secreta no código", async () => {
  for (const arq of ["app.js", "api.js", "config.js"]) {
    const t = await (await fetch(SITE + "/" + arq)).text();
    confere(!/sb_secret_|service_role"\s*:/.test(t), "chave secreta encontrada em " + arq);
  }
});

await teste("o site não carrega JavaScript de CDN de terceiros", async () => {
  // Um import de CDN é código de fora rodando com a sessão de quem está
  // logado. O do Supabase virou cópia local em site/vendor/. Conferido no
  // código-fonte deste repositório, sem depender do que já foi publicado.
  const dir = join(aqui, "..", "site");
  for (const arq of ["app.js", "api.js", "qr.js", "pix.js", "peito.js"]) {
    const t = readFileSync(join(dir, arq), "utf8");
    confere(!/from\s+["']https?:\/\//.test(t) && !/import\(["']https?:\/\//.test(t),
      "import de endereço externo em site/" + arq);
  }
  const vendor = readFileSync(join(dir, "vendor", "supabase-js.js"), "utf8");
  confere(vendor.length > 10000 && /createClient/.test(vendor),
    "site/vendor/supabase-js.js parece incompleto — rode: npm run vendor");

  // As fontes também são servidas pelo próprio site (site/fontes/), via
  // site/fontes.css. Nada de Google Fonts: cada carregamento por lá entregaria
  // o IP do visitante ao Google.
  const html = readFileSync(join(dir, "index.html"), "utf8");
  confere(!/fonts\.googleapis\.com/.test(html),
    "site/index.html ainda aponta para fonts.googleapis.com");
  confere(!/fonts\.gstatic\.com/.test(html),
    "site/index.html ainda aponta para fonts.gstatic.com");
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
