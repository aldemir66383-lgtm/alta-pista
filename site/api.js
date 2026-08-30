// Camada de acesso ao Supabase.
//
// Tudo o que envolve dado pessoal passa por função no banco (rpc). O site
// nunca faz "select * from inscricoes" para ver a lista dos outros: as
// políticas de segurança do Postgres devolveriam apenas as linhas do próprio
// usuário de qualquer forma. Ver supabase/0001_esquema.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CONFIG } from "./config.js";

/** true enquanto o config.js ainda estiver com os valores de exemplo. */
export const configPendente =
  /SEU-PROJETO|COLE-AQUI/.test(String(CONFIG.supabaseUrl) + String(CONFIG.supabaseAnonKey));

/**
 * Trava de sessão tolerante a impasse.
 *
 * O cliente do Supabase coordena as abas com Web Locks para não renovar o
 * mesmo token duas vezes. O problema é que, se a trava fica presa (uma aba que
 * travou, um recarregamento no meio da renovação), TODAS as chamadas seguintes
 * esperam para sempre — a página abre e nada carrega, sem erro nenhum no
 * console. Já aconteceu aqui.
 *
 * Aqui pedimos a trava com `ifAvailable`: se estiver livre, usamos e mantemos a
 * coordenação entre abas; se estiver ocupada, seguimos sem ela em vez de
 * esperar. O pior caso vira uma renovação de token repetida — inofensiva —
 * no lugar de um site que não abre.
 */
async function travaTolerante(nome, _tempoLimite, executar) {
  if (typeof navigator === "undefined" || !navigator.locks) return await executar();
  try {
    return await navigator.locks.request(
      nome, { mode: "exclusive", ifAvailable: true },
      async () => await executar()   // recebe null quando ocupada: seguimos assim mesmo
    );
  } catch (e) {
    return await executar();
  }
}

export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: travaTolerante
  }
});

/** Traduz o erro do Postgres para uma frase que dá para mostrar na tela. */
function traduzir(erro) {
  if (!erro) return null;
  const m = erro.message || "";
  if (/Entre na sua conta/i.test(m)) return "Entre na sua conta para se inscrever.";
  if (/row-level security|permission denied/i.test(m))
    return "Você não tem permissão para isso.";
  if (/duplicate key/i.test(m)) return "Esse registro já existe.";
  return m || "Não foi possível concluir. Tente de novo.";
}
function conferir({ data, error }) {
  if (error) throw new Error(traduzir(error));
  return data;
}

/* ---------------------------------------------------------------- sessão -- */

export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session || null;
}
export function aoMudarSessao(callback) {
  return sb.auth.onAuthStateChange((_evento, sessao) => callback(sessao));
}
export async function entrarPorEmail(email, nome) {
  return conferir(await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      data: nome ? { nome } : undefined
    }
  }));
}
export async function sair() {
  await sb.auth.signOut();
}
export async function souOrganizador() {
  const { data, error } = await sb.rpc("eh_organizador");
  if (error) return false;
  return !!data;
}
export async function meuPerfil() {
  const s = await sessaoAtual();
  if (!s) return null;
  const { data } = await sb.from("perfis").select("*").eq("id", s.user.id).maybeSingle();
  return data;
}

/**
 * Garante que a conta tenha uma linha em `perfis`.
 *
 * No banco existe um gatilho que cria essa linha quando a conta nasce, mas
 * alguns projetos Supabase não deixam criar gatilho na tabela de usuários. Para
 * não depender disso, o site também cria a linha por conta própria — a política
 * de segurança já permite que cada um crie a sua, e só a sua.
 */
export async function garantirPerfil(nome) {
  const s = await sessaoAtual();
  if (!s) return null;
  const existente = await meuPerfil();
  if (existente) return existente;
  const { data, error } = await sb.from("perfis")
    .insert({ id: s.user.id, nome: nome || s.user.user_metadata?.nome || "" })
    .select().maybeSingle();
  if (error) return null;  // corrida com o gatilho: alguém já criou, tudo bem
  return data;
}
export async function salvarPerfil(campos) {
  const s = await sessaoAtual();
  if (!s) throw new Error("Entre na sua conta.");
  return conferir(await sb.from("perfis").update(campos).eq("id", s.user.id).select().single());
}

/* --------------------------------------------------------------- público -- */

export async function nomeOrganizacao() {
  const { data } = await sb.rpc("nome_organizacao");
  return data || "";
}
/** Identidade visual pública: iniciais, nome, cor, textos do rodapé. */
export async function identidade() {
  const { data, error } = await sb.rpc("identidade");
  if (error) return null;
  return data;
}
export async function eventosPublicos() {
  return conferir(await sb.rpc("eventos_publicos")) || [];
}
export async function eventoPublico(slug) {
  return conferir(await sb.rpc("evento_publico", { p_slug: slug }));
}

/* ------------------------------------------------------------ inscrições -- */

export async function inscrever(dados) {
  return conferir(await sb.rpc("inscrever", {
    p_evento: dados.eventoId,
    p_nome: dados.nome,
    p_nascimento: dados.nascimento || null,
    p_email: dados.email || "",
    p_telefone: dados.telefone || "",
    p_eh_titular: dados.ehTitular !== false,
    p_respostas: dados.respostas || {},
    p_observacao: dados.observacao || ""
  }));
}
export async function minhasInscricoes() {
  return conferir(await sb.from("inscricoes")
    .select("*, eventos(nome, slug, data, hora, local)")
    .order("criado_em", { ascending: false })) || [];
}
export async function cobranca(inscricaoId) {
  return conferir(await sb.rpc("cobranca", { p_inscricao: inscricaoId }));
}
export async function posicaoNaFila(inscricaoId) {
  const { data } = await sb.rpc("posicao_na_fila", { p_inscricao: inscricaoId });
  return data ?? null;
}
export async function cancelarInscricao(inscricaoId) {
  return conferir(await sb.rpc("cancelar_inscricao", { p_inscricao: inscricaoId }));
}

/* ---------------------------------------------------------------- painel -- */

export async function configuracao() {
  return conferir(await sb.from("configuracao").select("*").eq("id", true).single());
}
export async function salvarConfiguracao(campos) {
  return conferir(await sb.from("configuracao").update(campos).eq("id", true).select().single());
}
export async function eventosDoPainel() {
  return conferir(await sb.from("eventos")
    .select("*, lotes(*), perguntas(*)")
    .order("data", { ascending: true, nullsFirst: false })) || [];
}
/**
 * Grava o evento com seus lotes e perguntas.
 *
 * Linhas que já existem são ATUALIZADAS, não recriadas: apagar e reinserir
 * daria ids novos, e aí a contagem de vendidos por lote voltaria a zero e as
 * respostas guardadas (que são indexadas pelo id da pergunta) ficariam órfãs.
 * Só some do banco o que o organizador realmente removeu da tela.
 */
export async function salvarEvento(evento) {
  const { id, lotes = [], perguntas = [], ...campos } = evento;
  const salvo = id
    ? conferir(await sb.from("eventos").update(campos).eq("id", id).select().single())
    : conferir(await sb.from("eventos").insert(campos).select().single());
  const eventoId = salvo.id;

  await sincronizarFilhos("lotes", eventoId, lotes, (l, i) => ({
    evento_id: eventoId, ordem: i + 1, nome: l.nome,
    preco_centavos: l.preco_centavos || 0,
    vende_ate: l.vende_ate || null, quantidade: l.quantidade || 0
  }));
  await sincronizarFilhos("perguntas", eventoId, perguntas, (p, i) => ({
    evento_id: eventoId, ordem: i + 1, rotulo: p.rotulo, tipo: p.tipo,
    opcoes: p.opcoes || "", obrigatorio: !!p.obrigatorio
  }));
  return salvo;
}

/**
 * Grava a lista de filhos (lotes ou perguntas) em quatro idas ao banco, não
 * uma por linha. Antes, um evento com 2 lotes e 6 perguntas custava cerca de
 * onze chamadas em sequência e o salvamento demorava visivelmente.
 *
 * As linhas que já existem vão juntas num upsert; as novas, juntas num insert;
 * e o que o organizador tirou da tela sai num delete só.
 */
async function sincronizarFilhos(tabela, eventoId, lista, mapear) {
  const existentes = conferir(
    await sb.from(tabela).select("id").eq("evento_id", eventoId)
  ) || [];

  const paraAtualizar = [];
  const paraCriar = [];
  const posicaoDosNovos = [];
  lista.forEach((item, i) => {
    const linha = mapear(item, i);
    if (item.id) paraAtualizar.push({ ...linha, id: item.id });
    else { paraCriar.push(linha); posicaoDosNovos.push(i); }
  });

  if (paraAtualizar.length) {
    conferir(await sb.from(tabela).upsert(paraAtualizar, { onConflict: "id" }));
  }
  if (paraCriar.length) {
    const criados = conferir(await sb.from(tabela).insert(paraCriar).select("id")) || [];
    // o Postgres devolve na mesma ordem em que enviamos
    criados.forEach((c, k) => { lista[posicaoDosNovos[k]].id = c.id; });
  }

  const mantidos = new Set(lista.map(x => x.id).filter(Boolean));
  const remover = existentes.filter(e => !mantidos.has(e.id)).map(e => e.id);
  if (remover.length) conferir(await sb.from(tabela).delete().in("id", remover));
}
export async function apagarEvento(id) {
  return conferir(await sb.from("eventos").delete().eq("id", id));
}
export async function inscritosDoPainel() {
  return conferir(await sb.from("inscricoes")
    .select("*, eventos(nome, slug)")
    .order("criado_em", { ascending: false })) || [];
}
/* --------------------------------------------------------------- equipe -- */

/**
 * Nenhuma chamada deve poder pendurar a tela. Se o banco não responder em
 * `ms`, desistimos com um erro legível em vez de deixar o Painel travado —
 * foi exatamente o que aconteceu quando a função de equipe ainda não existia
 * no banco e o cliente ficou tentando recarregar o esquema sem parar.
 */
function comPrazo(promessa, ms, oQue) {
  return Promise.race([
    promessa,
    new Promise((_, rejeitar) => setTimeout(
      () => rejeitar(new Error("O banco demorou demais para responder (" + oQue + ").")), ms))
  ]);
}

export async function listarOrganizadores() {
  const r = await comPrazo(sb.rpc("listar_organizadores"), 8000, "equipe");
  if (r.error && /schema cache|does not exist|PGRST202/i.test(r.error.message || "")) {
    throw new Error("A parte de equipe ainda não foi instalada no banco. " +
      "Rode o arquivo supabase/0005_equipe.sql no SQL Editor.");
  }
  return conferir(r) || [];
}
export async function promoverOrganizador(email) {
  return conferir(await sb.rpc("promover_organizador", { p_email: email }));
}
export async function removerOrganizador(userId) {
  return conferir(await sb.rpc("remover_organizador", { p_user_id: userId }));
}

/* ------------------------------------------------------------ resultados -- */

export async function eventosComResultado() {
  return conferir(await sb.rpc("eventos_com_resultado")) || [];
}
export async function resultadosDoEvento(eventoId) {
  return conferir(await sb.from("resultados")
    .select("*").eq("evento_id", eventoId)
    .order("posicao", { ascending: true, nullsFirst: false })) || [];
}
/** Substitui a classificação inteira do evento — é sempre uma importação nova. */
export async function substituirResultados(eventoId, linhas) {
  conferir(await sb.from("resultados").delete().eq("evento_id", eventoId));
  if (!linhas.length) return [];
  return conferir(await sb.from("resultados")
    .insert(linhas.map(l => ({ ...l, evento_id: eventoId })))
    .select());
}

/* ----------------------------------------------------------- capa/imagem -- */

/** Envia a capa para o balde público "capas" e devolve a URL definitiva. */
export async function enviarCapa(arquivo) {
  const ext = (arquivo.name.split(".").pop() || "jpg").toLowerCase();
  const caminho = crypto.randomUUID() + "." + ext;
  const { error } = await sb.storage.from("capas")
    .upload(caminho, arquivo, { cacheControl: "31536000", upsert: false });
  if (error) throw new Error(traduzir(error));
  return sb.storage.from("capas").getPublicUrl(caminho).data.publicUrl;
}

export async function definirStatus(id, status) {
  const campos = { status, pago_em: status === "pago" ? new Date().toISOString() : null };
  return conferir(await sb.from("inscricoes").update(campos).eq("id", id).select().single());
}
