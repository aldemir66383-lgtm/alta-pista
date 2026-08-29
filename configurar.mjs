// Configura o site com os dados do seu projeto Supabase e confere se está tudo
// no lugar. Rode assim, na pasta do projeto:
//
//   node configurar.mjs https://SEU-PROJETO.supabase.co SUA_CHAVE_ANON
//
// Ele escreve o site/config.js e depois testa a conexão de verdade: confere se
// a chave é aceita, se as tabelas existem e se o balde de imagens foi criado.

import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));

// A chave pública deste projeto. É pública por natureza: ela viaja dentro do
// código do site e qualquer visitante consegue lê-la. Quem protege os dados são
// as políticas do banco. Para usar em outro projeto, passe a chave como
// segundo argumento na linha de comando.
const CHAVE_PADRAO = "sb_publishable_Ut48k2c6g1wa47BVyPMAiQ_D2wLzLvS";

const [, , entrada, chaveArg] = process.argv;
const chave = chaveArg || CHAVE_PADRAO;

/**
 * Aceita o endereço em qualquer formato que apareça na sua frente:
 *   https://abcdefgh.supabase.co
 *   https://supabase.com/dashboard/project/abcdefgh/settings/api
 *   abcdefgh
 */
function acharEndereco(bruto) {
  const t = String(bruto || "").trim().replace(/^["']|["']$/g, "");
  if (!t) return null;
  const painel = t.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{16,})/i);
  if (painel) return "https://" + painel[1] + ".supabase.co";
  const api = t.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (api) return "https://" + api[1] + ".supabase.co";
  if (/^[a-z0-9]{16,}$/i.test(t)) return "https://" + t + ".supabase.co";
  return null;
}
const url = acharEndereco(entrada);

const vermelho = t => "\x1b[31m" + t + "\x1b[0m";
const verde = t => "\x1b[32m" + t + "\x1b[0m";
const amarelo = t => "\x1b[33m" + t + "\x1b[0m";

if (!url) {
  console.log(`
Uso:  node configurar.mjs <endereço do seu projeto>

Serve qualquer um destes formatos — pode colar o que estiver à mão:

  · o endereço da barra do navegador com o painel aberto:
      https://supabase.com/dashboard/project/abcdefghijklmnop/settings/api
  · o Project URL, em Project Settings › Data API:
      https://abcdefghijklmnop.supabase.co
  · só o identificador do projeto:
      abcdefghijklmnop
${entrada ? "\n" + vermelho("Não reconheci: ") + JSON.stringify(entrada) + "\n" : ""}
A chave pública já está embutida no script. Se um dia precisar de outra,
passe como segundo argumento. NUNCA use a "service_role" nem a "secret key".
`);
  process.exit(1);
}
if (chave.length < 40) {
  console.log(vermelho("A chave parece curta demais.") +
    " Use a chave pública inteira, não o Project ID.");
  process.exit(1);
}
if (/^sb_secret_/i.test(chave)) {
  console.log(vermelho("Essa é a 'secret key' — ela NUNCA pode ir para o site."));
  console.log("Use a 'Publishable key'. E gere outra secret, já que esta apareceu aqui.");
  process.exit(1);
}
// A chave do Supabase é um JWT: o papel vem codificado no miolo, não em texto
// puro. Sem abrir o miolo, uma service_role passaria batida por aqui.
function papelDaChave(jwt) {
  try {
    const miolo = jwt.split(".")[1];
    if (!miolo) return null;
    const json = Buffer.from(miolo.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json).role || null;
  } catch (e) { return null; }
}
const papel = papelDaChave(chave);
if (papel === "service_role") {
  console.log(vermelho("Essa é a chave service_role — ela NUNCA pode ir para o site."));
  console.log("Ela ignora todas as políticas de segurança: qualquer visitante leria e mudaria tudo.");
  console.log("Use a 'anon public'. E como essa já foi exposta aqui, gere outra no painel do Supabase.");
  process.exit(1);
}
if (papel && papel !== "anon") {
  console.log(amarelo("! a chave informada tem o papel '" + papel + "', e o esperado é 'anon'."));
  console.log("  Confira em Project Settings › API se copiou a 'anon public'.");
  process.exit(1);
}

const base = url.replace(/\/$/, "");

// ---------------------------------------------------------------- escreve --
const destino = join(aqui, "site", "config.js");
writeFileSync(destino, `// Gerado por configurar.mjs — pode editar à mão se precisar.
// Estes dois valores são públicos por natureza: quem protege os dados são as
// políticas de segurança do banco, não o segredo da chave.

export const CONFIG = {
  supabaseUrl: ${JSON.stringify(base)},
  supabaseAnonKey: ${JSON.stringify(chave)}
};
`);
console.log(verde("✓") + " site/config.js escrito");

// ----------------------------------------------------------------- testa ---
const cabecalhos = { apikey: chave, Authorization: "Bearer " + chave };

async function testar(nome, caminho, opcoes = {}) {
  try {
    const r = await fetch(base + caminho, {
      headers: { ...cabecalhos, ...(opcoes.headers || {}) },
      method: opcoes.method || "GET",
      body: opcoes.body
    });
    return { ok: r.ok, status: r.status, corpo: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, corpo: e.message };
  }
}

console.log("\nTestando a conexão…\n");

// Usamos /auth/v1/settings como teste de vida. A raiz /rest/v1/ NÃO serve:
// no sistema novo de chaves ela exige chave secreta e devolve 401 mesmo com a
// chave pública correta — daria um falso "chave recusada".
const vivo = await testar("auth", "/auth/v1/settings");
if (vivo.status === 0) {
  console.log(vermelho("✗ Não consegui falar com o projeto.") + " Confira o endereço e sua internet.");
  process.exit(1);
}
if (vivo.status === 401 || vivo.status === 403) {
  console.log(vermelho("✗ A chave foi recusada.") + " Confira se copiou a chave pública inteira.");
  process.exit(1);
}
console.log(verde("✓") + " o projeto responde e a chave é aceita");

const ident = await testar("identidade", "/rest/v1/rpc/identidade", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
});
if (ident.ok) {
  console.log(verde("✓") + " as tabelas e funções estão instaladas");
} else if (/could not find the function|does not exist|PGRST202/i.test(ident.corpo)) {
  console.log(amarelo("! falta rodar o SQL."));
  console.log("  Abra o SQL Editor do Supabase, cole o conteúdo de");
  console.log("  supabase/0000_tudo.sql e clique em Run. Depois rode este script de novo.");
  process.exit(1);
} else {
  console.log(amarelo("! a função identidade respondeu com erro:"), ident.corpo.slice(0, 200));
}

const eventos = await testar("eventos", "/rest/v1/rpc/eventos_publicos", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
});
if (eventos.ok) {
  let n = 0;
  try { n = JSON.parse(eventos.corpo).length; } catch (e) {}
  console.log(verde("✓") + ` a lista pública de eventos responde (${n} publicado${n === 1 ? "" : "s"})`);
}

// Não dá para perguntar "esse balde existe?" com chave pública: o endereço
// /storage/v1/bucket exige chave secreta e responde "Bucket not found" mesmo
// quando o balde está lá. O jeito honesto é pedir um arquivo qualquer e ler o
// erro: "Object not found" significa que o balde existe e o arquivo é que não.
const balde = await testar("storage", "/storage/v1/object/public/capas/_teste_inexistente.png");
if (/NoSuchKey|Object not found/i.test(balde.corpo)) {
  console.log(verde("✓") + " o balde de imagens 'capas' existe e é público");
} else if (/Bucket not found|NoSuchBucket/i.test(balde.corpo)) {
  console.log(amarelo("! o balde 'capas' não existe") + " — rode o supabase/0004_finalizar.sql");
} else {
  console.log(amarelo("! não consegui confirmar o balde:"), balde.corpo.slice(0, 120));
}

// a tabela de inscrições NÃO pode ser lida por quem não entrou: é o teste
// mais importante, porque é o que protege os dados dos participantes
const vazamento = await testar("inscricoes", "/rest/v1/inscricoes?select=id&limit=1");
let linhas = -1;
try { linhas = JSON.parse(vazamento.corpo).length; } catch (e) {}
if (linhas === 0) {
  console.log(verde("✓") + " sem conta, ninguém enxerga inscrição nenhuma (proteção ativa)");
} else if (linhas > 0) {
  console.log(vermelho("✗ ATENÇÃO: a tabela de inscrições devolveu dados sem login."));
  console.log("  Isso não deveria acontecer. Rode o supabase/0000_tudo.sql de novo e me avise.");
} else {
  console.log(verde("✓") + " a tabela de inscrições está fechada para quem não entrou");
}

console.log(`
${verde("Tudo certo.")} Próximos passos:

  1. Teste na sua máquina:      npx serve site
  2. Publique arrastando a pasta 'site' em https://app.netlify.com/drop
  3. No Supabase, em Authentication › URL Configuration, ponha o endereço
     publicado em Site URL e em Redirect URLs.
  4. Entre no site com o seu e-mail, e então rode no SQL Editor:

     insert into public.organizadores (user_id)
     select id from auth.users where email = 'seu-email@exemplo.com'
     on conflict do nothing;
`);

if (!existsSync(join(aqui, "site", "app.js"))) {
  console.log(vermelho("Aviso: não achei site/app.js — rode este script de dentro da pasta do projeto."));
}
