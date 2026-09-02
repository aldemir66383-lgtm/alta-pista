// Dá acesso ao Painel sem depender do envio de e-mail.
//
//   node dar-acesso.mjs
//
// O login do site é por link enviado por e-mail. Enquanto o envio não estiver
// configurado (ou quando ele falha justo na hora), ninguém entra — e foi o que
// travou o coordenador. Este script contorna isso pelo lado de dentro: cria a
// conta se não existir, promove a pessoa a organizadora e devolve o link de
// acesso pronto, para você mandar por WhatsApp. Nenhum e-mail é disparado.
//
// Precisa da chave secreta do projeto (a "service_role"), que NUNCA pode ir
// para o site nem para o GitHub. Ela fica em `.chave-servico`, um arquivo que
// o .gitignore já bloqueia. Se ela vazar, gere outra no painel do Supabase.

import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITE = "https://alta-pista.netlify.app";

/* ------------------------------------------------- a chave secreta --- */

const ARQUIVO_CHAVE = join(AQUI, ".chave-servico");

function chaveSecreta() {
  if (!existsSync(ARQUIVO_CHAVE)) {
    console.log(`
  Falta a chave secreta do projeto — uma vez só, e nunca mais.

  1. Abra o painel do Supabase, em Project Settings › API Keys.
  2. Copie a chave "service_role" (a secreta, não a publishable).
  3. Salve num arquivo de texto puro chamado

       .chave-servico

     aqui dentro da pasta do projeto, com a chave e mais nada.

  Essa chave ignora todas as travas de segurança do banco: ela não pode ir
  para o site, para o GitHub nem para conversa nenhuma. O arquivo já está
  bloqueado no .gitignore. Se ela vazar um dia, gere outra no mesmo lugar.
`);
    process.exit(1);
  }
  const chave = readFileSync(ARQUIVO_CHAVE, "utf8").trim();
  if (!chave) { console.log("\n  O arquivo .chave-servico está vazio.\n"); process.exit(1); }
  return chave;
}

/* --------------------------------------------------- o endereço ----- */

function urlDoProjeto() {
  const cfg = readFileSync(join(AQUI, "site", "config.js"), "utf8");
  const achado = cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
  if (!achado) { console.log("\n  Não achei a URL do Supabase em site/config.js.\n"); process.exit(1); }
  return achado[0];
}

/* ---------------------------------------------------- as chamadas --- */

async function api(url, chave, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: {
      apikey: chave,
      Authorization: "Bearer " + chave,
      "Content-Type": "application/json",
      ...(opcoes.headers || {})
    }
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = { msg: texto }; }
  return { ok: r.ok, status: r.status, corpo };
}

/** Gera o link de acesso. Não envia e-mail: só devolve o endereço. */
async function gerarLink(base, chave, email) {
  return api(base + "/auth/v1/admin/generate_link", chave, {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email, redirect_to: SITE + "/" })
  });
}

async function criarConta(base, chave, email) {
  return api(base + "/auth/v1/admin/users", chave, {
    method: "POST",
    body: JSON.stringify({ email, email_confirm: true })
  });
}

async function promover(base, chave, userId) {
  return api(base + "/rest/v1/organizadores", chave, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ user_id: userId })
  });
}

/* ------------------------------------------------------- o roteiro -- */

const chave = chaveSecreta();
const base = urlDoProjeto();

const pergunta = createInterface({ input: process.stdin, output: process.stdout });
const email = (await pergunta.question("\n  E-mail de quem vai receber o acesso: ")).trim().toLowerCase();
pergunta.close();

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.log("\n  Esse endereço não parece um e-mail. Rode de novo.\n");
  process.exit(1);
}

console.log("\n  Preparando o acesso de " + email + "…\n");

let r = await gerarLink(base, chave, email);

// Ainda não tem conta: cria (sem disparar e-mail) e tenta de novo.
if (!r.ok) {
  const cria = await criarConta(base, chave, email);
  if (!cria.ok && cria.status !== 422) {
    console.log("  Não deu para criar a conta: " +
      ((cria.corpo && (cria.corpo.msg || cria.corpo.message)) || cria.status) + "\n");
    process.exit(1);
  }
  console.log("  Conta criada.");
  r = await gerarLink(base, chave, email);
}

if (!r.ok) {
  console.log("  Não deu para gerar o link: " +
    ((r.corpo && (r.corpo.msg || r.corpo.message)) || r.status) + "\n");
  process.exit(1);
}

const link = r.corpo.action_link;
const userId = (r.corpo.user && r.corpo.user.id) || r.corpo.id;

const p = await promover(base, chave, userId);
console.log(p.ok || p.status === 409
  ? "  Acesso ao Painel liberado."
  : "  Atenção: o link funciona, mas não consegui marcar como organizador (" +
    ((p.corpo && (p.corpo.message || p.corpo.msg)) || p.status) + ").");

console.log(`
  ────────────────────────────────────────────────────────────────
  Mande este link para a pessoa:

${link}

  ────────────────────────────────────────────────────────────────

  Ele entra direto, sem senha e sem esperar e-mail. Vale por pouco
  tempo — se expirar, é só rodar isto de novo e mandar outro.

  Mande por WhatsApp ou pessoalmente: quem tiver o link entra na
  conta dessa pessoa, então não é para grupo nem para rede social.
`);
