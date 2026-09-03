// Alta-Pista — aplicação do site.
//
// Nenhuma regra de dinheiro ou de vaga é decidida aqui. O preço, o lote e o
// status saem da função inscrever() no banco; esta tela só mostra e pergunta.

import * as api from "./api.js";
import { CONFIG } from "./config.js";
import { QR } from "./qr.js";
import { Pix } from "./pix.js";
import { folha as folhaDePeito, paginaParaImprimir, formatarNumero } from "./peito.js";

/* =========================================================== utilidades == */

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dinheiro = c => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const MODALIDADES = ["Corrida de rua", "Corrida rústica", "Trail run", "Caminhada",
  "Ciclismo", "Triatlo", "Circuito", "Outro"];

const hora = h => (h || "").slice(0, 5);
function dataLonga(iso) {
  if (!iso) return "Data a definir";
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function dataCurta(iso) {
  if (!iso) return { dia: "--", mes: "" };
  const [, m, d] = iso.split("-").map(Number);
  return { dia: String(d).padStart(2, "0"), mes: MESES[m - 1] || "" };
}
const dataBR = iso => iso ? iso.split("-").reverse().join("/") : "—";
const hojeISO = () => new Date().toISOString().slice(0, 10);
const cidadeUF = ev => [ev.cidade, ev.uf].filter(Boolean).join(" - ");

function torrar(msg) {
  const t = $("#torrada");
  t.textContent = msg;
  t.classList.add("ver");
  clearTimeout(torrar._t);
  torrar._t = setTimeout(() => t.classList.remove("ver"), 3400);
}

function validaCPF(bruto) {
  const s = (bruto || "").replace(/\D/g, "");
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  for (const corte of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < corte; i++) soma += parseInt(s[i], 10) * (corte + 1 - i);
    let d = (soma * 10) % 11;
    if (d === 10) d = 0;
    if (d !== parseInt(s[corte], 10)) return false;
  }
  return true;
}
const formataCPF = b => (b || "").replace(/\D/g, "").slice(0, 11)
  .replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2")
  .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

const rotuloStatus = s => ({
  pago: "Pago", pendente: "Aguardando pagamento",
  cancelada: "Cancelada", espera: "Na lista de espera"
}[s] || s);
const classeStatus = s => s === "cancelada" ? "cancelado" : s;

/* Contagem regressiva para a data da corrida */
function diasAte(iso) {
  if (!iso) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(a, m - 1, d);
  data.setHours(0, 0, 0, 0);
  const diff = Math.round((data - hoje) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { texto: "Concluído", classe: "passou", diff };
  if (diff === 0) return { texto: "🏁 É hoje!", classe: "hoje", diff };
  if (diff === 1) return { texto: "🔥 É amanhã!", classe: "amanha", diff };
  return { texto: "⏳ Faltam " + diff + " dias", classe: "futuro", diff };
}

/* Acha o objeto do evento pelo slug, olhando tudo o que já está carregado:
   a tela de evento aberta, a lista pública, as inscrições da pessoa e a tela
   de resultados. Evita uma ida ao banco só para compartilhar ou salvar na
   agenda. */
function eventoPorSlug(slug) {
  if (!slug) return null;
  if (estado.evento && estado.evento.slug === slug) return estado.evento;
  const naLista = (estado.eventos || []).find(e => e.slug === slug);
  if (naLista) return naLista;
  const naMinha = (estado.minhas || []).map(i => i.eventos).find(e => e && e.slug === slug);
  if (naMinha) return naMinha;
  if (estado.resultados.evento && estado.resultados.evento.slug === slug) return estado.resultados.evento;
  return null;
}

/* Salvar na agenda (Google Calendar e arquivo .ics para Apple/Outlook) */
function linkGoogleCalendar(ev) {
  if (!ev.data) return "#";
  const [a, m, d] = ev.data.split("-");
  const horaStr = (ev.hora || "07:00").replace(":", "") + "00";
  const inicio = `${a}${m}${d}T${horaStr}`;
  const fimHora = String(Math.min(23, Number((ev.hora || "07:00").slice(0, 2)) + 3)).padStart(2, "0") + "0000";
  const fim = `${a}${m}${d}T${fimHora}`;
  const titulo = encodeURIComponent(ev.nome || "Corrida");
  const local = encodeURIComponent([ev.local, cidadeUF(ev)].filter(Boolean).join(", "));
  const detalhes = encodeURIComponent(`Inscrições e informações: ${window.location.origin}/#evento=${ev.slug}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${titulo}&dates=${inicio}/${fim}&details=${detalhes}&location=${local}`;
}

function gerarICS(ev) {
  if (!ev.data) return;
  const [a, m, d] = ev.data.split("-");
  const horaStr = (ev.hora || "07:00").replace(":", "") + "00";
  const inicio = `${a}${m}${d}T${horaStr}`;
  const fimHora = String(Math.min(23, Number((ev.hora || "07:00").slice(0, 2)) + 3)).padStart(2, "0") + "0000";
  const fim = `${a}${m}${d}T${fimHora}`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Alta-Pista//Eventos//PT-BR",
    "BEGIN:VEVENT",
    `SUMMARY:${ev.nome}`,
    `DESCRIPTION:Informações e inscrições: ${window.location.origin}/#evento=${ev.slug}`,
    `LOCATION:${[ev.local, cidadeUF(ev)].filter(Boolean).join(", ")}`,
    `DTSTART:${inicio}`,
    `DTEND:${fim}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${ev.slug || "evento"}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Compartilhamento direto no WhatsApp ou no menu nativo */
async function compartilharEvento(ev) {
  const url = `${window.location.origin}/#evento=${encodeURIComponent(ev.slug)}`;
  const texto = `🏃‍♂️ Participe da prova "${ev.nome}"!\n📅 Data: ${dataLonga(ev.data)}${ev.hora ? " às " + hora(ev.hora) : ""}\n📍 Local: ${ev.local || "A definir"} ${cidadeUF(ev) ? "— " + cidadeUF(ev) : ""}\n🔗 Inscreva-se: ${url}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: ev.nome, text: texto, url });
      return;
    } catch (e) { /* continua no WhatsApp */ }
  }
  const zapUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
  window.open(zapUrl, "_blank", "noopener,noreferrer");
}

/* Certificado de Conclusão / Participação em SVG de alta qualidade */
function gerarCertificadoSVG(d) {
  const largura = 1000;
  const altura = 700;
  const id = estado.identidade || {};
  const org = esc(d.organizacao || id.nome_site || "Alta-Pista");
  const evento = esc(d.evento || "Corrida");
  const atleta = esc(d.atleta || "Participante");
  const percurso = esc(d.percurso || "Percurso oficial");
  const tempo = esc(d.tempo || "—");
  const pos = d.posicao != null ? `${d.posicao}º Lugar` : "Concluinte";
  const data = esc(d.data || "2026");
  const local = esc(d.local || "");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>Certificado - ${atleta}</title><style>` +
    `@page { size: A4 landscape; margin: 0; }` +
    `body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0B1B2B; font-family: 'Helvetica Neue', Arial, sans-serif; }` +
    `svg { width: 100%; max-width: 960px; height: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.5); background: #fff; }` +
    `@media print { body { background: #fff; min-height: auto; } svg { box-shadow: none; width: 100%; height: 100%; } .no-print { display: none; } }` +
    `</style></head><body>` +
    `<div class="no-print" style="position:fixed;top:16px;right:16px;z-index:99;display:flex;gap:8px">` +
    `<button onclick="window.print()" style="padding:10px 18px;background:#C6F24E;border:0;font-weight:bold;cursor:pointer;border-radius:4px;color:#0B1B2B;font-size:14px">🖨️ Imprimir / Salvar PDF</button>` +
    `</div>` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${altura}">` +
    `<rect width="${largura}" height="${altura}" fill="#FAFBFD"/>` +
    `<rect x="24" y="24" width="${largura - 48}" height="${altura - 48}" fill="none" stroke="#0B1B2B" stroke-width="4"/>` +
    `<rect x="32" y="32" width="${largura - 64}" height="${altura - 64}" fill="none" stroke="#C6F24E" stroke-width="2"/>` +
    `<circle cx="500" cy="90" r="36" fill="#0B1B2B"/>` +
    `<text x="500" y="98" text-anchor="middle" font-size="20" font-weight="900" fill="#C6F24E">AP</text>` +
    `<text x="500" y="156" text-anchor="middle" font-size="14" font-weight="700" letter-spacing="4" fill="#6A8095" text-transform="uppercase">${org}</text>` +
    `<text x="500" y="210" text-anchor="middle" font-size="34" font-weight="900" letter-spacing="3" fill="#0B1B2B" text-transform="uppercase">CERTIFICADO DE CONCLUSÃO</text>` +
    `<text x="500" y="250" text-anchor="middle" font-size="16" fill="#4E6274">Certificamos com orgulho que o(a) atleta</text>` +
    `<text x="500" y="310" text-anchor="middle" font-size="34" font-weight="800" fill="#0B1B2B" text-transform="uppercase">${atleta}</text>` +
    `<line x1="250" y1="330" x2="750" y2="330" stroke="#BAC6D0" stroke-width="1"/>` +
    `<text x="500" y="370" text-anchor="middle" font-size="16" fill="#4E6274">concluiu com êxito a sua participação na prova oficial</text>` +
    `<text x="500" y="415" text-anchor="middle" font-size="26" font-weight="800" fill="#0B1B2B">${evento}</text>` +
    `<rect x="180" y="455" width="640" height="90" rx="8" fill="#F0F4F8" stroke="#D6DEE5"/>` +
    `<text x="280" y="488" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1" fill="#8496A5">PERCURSO</text>` +
    `<text x="280" y="520" text-anchor="middle" font-size="20" font-weight="800" fill="#0B1B2B">${percurso}</text>` +
    `<line x1="390" y1="465" x2="390" y2="535" stroke="#D6DEE5"/>` +
    `<text x="500" y="488" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1" fill="#8496A5">TEMPO OFICIAL</text>` +
    `<text x="500" y="520" text-anchor="middle" font-size="20" font-weight="800" fill="#0B1B2B">${tempo}</text>` +
    `<line x1="610" y1="465" x2="610" y2="535" stroke="#D6DEE5"/>` +
    `<text x="720" y="488" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1" fill="#8496A5">CLASSIFICAÇÃO</text>` +
    `<text x="720" y="520" text-anchor="middle" font-size="20" font-weight="800" fill="#0B1B2B">${pos}</text>` +
    `<text x="500" y="600" text-anchor="middle" font-size="14" fill="#4E6274">${[local, data].filter(Boolean).join(" · ")}</text>` +
    `<text x="500" y="635" text-anchor="middle" font-size="11" letter-spacing="1" fill="#8496A5">CRONOMETRAGEM & REGISTRO OFICIAL ALTA-PISTA</text>` +
    `</svg></body></html>`;
}

function abrirCertificado(dados) {
  const html = gerarCertificadoSVG(dados);
  const win = window.open("", "_blank");
  if (!win) { torrar("Libere os pop-ups para ver o certificado."); return; }
  win.document.write(html);
  win.document.close();
}

/* Gerenciamento de Tema Claro e Escuro */
function iniciarTema() {
  const salvo = localStorage.getItem("tema");
  if (salvo) {
    document.documentElement.setAttribute("data-theme", salvo);
  }
  atualizarIconeTema();
}

function alternarTema() {
  const atual = document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const novo = atual === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", novo);
  localStorage.setItem("tema", novo);
  atualizarIconeTema();
  torrar(novo === "dark" ? "Modo escuro ativado" : "Modo claro ativado");
}

function atualizarIconeTema() {
  const btn = $("#botao-tema");
  if (!btn) return;
  const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  btn.innerHTML = dark ? "☀️" : "🌙";
  btn.title = dark ? "Mudar para modo claro" : "Mudar para modo escuro";
}

/* Edital em texto simples: ## título, - item, **negrito**, parágrafos. */
function renderEdital(texto) {
  const linhas = String(texto || "").split(/\r?\n/);
  let html = "", lista = false;
  const forte = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const linha of linhas) {
    const l = linha.trim();
    if (!l) { if (lista) { html += "</ul>"; lista = false; } continue; }
    if (l.startsWith("## ")) {
      if (lista) { html += "</ul>"; lista = false; }
      html += "<h3>" + forte(l.slice(3)) + "</h3>";
    } else if (l.startsWith("- ")) {
      if (!lista) { html += "<ul>"; lista = true; }
      html += "<li>" + forte(l.slice(2)) + "</li>";
    } else {
      if (lista) { html += "</ul>"; lista = false; }
      html += "<p>" + forte(l) + "</p>";
    }
  }
  if (lista) html += "</ul>";
  return html;
}

/* ------------------------------------------------------------- lotes ---- */

const loteVencido = l => !!l.vende_ate && l.vende_ate < hojeISO();
const loteEsgotado = l => l.quantidade > 0 && (l.vendidos || 0) >= l.quantidade;
const loteAtivo = ev => (ev.lotes || []).find(l => !loteVencido(l) && !loteEsgotado(l)) || null;
function precoAtual(ev) {
  const l = loteAtivo(ev);
  if (l) return l.preco_centavos;
  const ultimo = (ev.lotes || []).slice(-1)[0];
  return ultimo ? ultimo.preco_centavos : 0;
}
function motivoLote(ev, l) {
  if (loteVencido(l)) return "encerrado em " + dataBR(l.vende_ate);
  if (loteEsgotado(l)) return "esgotado";
  const a = loteAtivo(ev);
  return a && a.id === l.id ? "à venda agora" : "em seguida";
}
function vagasRestantes(ev) {
  if (!ev.vagas) return null;
  return Math.max(0, ev.vagas - (ev.ocupadas || 0));
}
const semVaga = ev => vagasRestantes(ev) === 0 || !loteAtivo(ev);


/* ------------------------------------------------- número de peito --- */

/**
 * As respostas do formulário são guardadas com o id da pergunta como chave,
 * não com o rótulo. Este mapa devolve o rótulo de cada id, juntando o que
 * estiver carregado — os eventos do Painel, se for o organizador, e os
 * eventos públicos, se for o participante.
 */
function rotulosDasPerguntas() {
  const mapa = {};
  const fontes = [estado.painel.eventos, estado.eventos, [estado.evento]];
  for (const lista of fontes) {
    for (const ev of (lista || [])) {
      for (const pg of ((ev || {}).perguntas || [])) {
        if (pg && pg.id) mapa[pg.id] = String(pg.rotulo || "");
      }
    }
  }
  return mapa;
}

/**
 * Procura, nas respostas do formulário, o campo cujo rótulo fala de uma
 * coisa. Serve para achar o tamanho da camisa e o percurso escolhido sem
 * exigir que o organizador use um nome exato de campo.
 */
function respostaSobre(respostas, palavras, rotulos) {
  for (const [chave, valor] of Object.entries(respostas || {})) {
    const texto = String(valor == null ? "" : valor).trim();
    if (!texto) continue;
    const r = String((rotulos || {})[chave] || chave).toLowerCase();
    if (palavras.some(pl => r.includes(pl))) return texto;
  }
  return "";
}

/** Reúne inscrição, evento e identidade no formato que o peito.js espera. */
function dadosDaFolha(i, ev, rotulos) {
  const e = ev || i.eventos || {};
  const id = estado.identidade || {};
  const r = rotulos || rotulosDasPerguntas();
  return {
    numero: i.numero,
    nome: i.participante_nome,
    codigo: i.codigo,
    evento: e.nome || "",
    data: e.data ? dataLonga(e.data) : "",
    local: e.cidade ? e.cidade + (e.uf ? "/" + e.uf : "") : (e.local || ""),
    distancia: respostaSobre(i.respostas, ["percurso", "distância", "distancia", "prova", "km"], r) ||
               String(e.distancias || "").split(",")[0].trim(),
    camisa: respostaSobre(i.respostas, ["camisa", "camiseta", "tamanho", "blusa"], r),
    sigla: id.sigla || "",
    marca: id.nome_site || "",
    /* a cor do evento manda; sem ela, a do site */
    cor: e.peito_cor || id.cor_acento || "#0B1B2B",
    digitos: e.numero_digitos || 0,
    logoUrl: e.peito_logo_url || "",
    fundoUrl: e.peito_fundo_url || "",
    prontoUrl: e.peito_pronto_url || ""
  };
}

/** Abre uma janela com as folhas prontas e chama a impressão. */
function imprimirPeitos(inscricoes, titulo) {
  const validas = inscricoes.filter(i => i.numero != null);
  if (!validas.length) {
    torrar("Nenhuma inscrição paga com número ainda.");
    return;
  }
  const rotulos = rotulosDasPerguntas();
  const html = paginaParaImprimir(
    validas.map(i => folhaDePeito(dadosDaFolha(i, null, rotulos))), titulo);
  const janela = window.open("", "_blank");
  if (!janela) {
    torrar("O navegador bloqueou a janela. Libere os pop-ups deste site.");
    return;
  }
  janela.document.write(html);
  janela.document.close();
  // A página de impressão não tem script próprio; quem manda imprimir é aqui.
  const imprimir = () => { try { janela.focus(); janela.print(); } catch (e) {} };
  if (janela.document.readyState === "complete") setTimeout(imprimir, 400);
  else janela.addEventListener("load", () => setTimeout(imprimir, 400));
}

/* ============================================================== estado === */

/* =========================================================== identidade == */

const IDENTIDADE_PADRAO = {
  organizacao: "", sigla: "AP", nome_site: "Alta-Pista",
  subtitulo: "Inscrições esportivas", cor_acento: "#C6F24E",
  sobre: "", contato: "", instagram: "", whatsapp: "", logo_url: ""
};

/** Preto ou branco por cima da cor escolhida, conforme a luminância dela. */
function tintaSobre(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length !== 6) return "#071320";
  const canal = i => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luz = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  // contraste contra branco vs contra quase-preto
  return (1.05 / (luz + 0.05)) > ((luz + 0.05) / 0.06) ? "#FFFFFF" : "#071320";
}

/** Versão mais escura da cor, para o estado de hover dos botões. */
function escurecer(hex, quanto) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length !== 6) return hex;
  const canal = i => Math.max(0, Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - quanto)));
  return "#" + [0, 2, 4].map(i => canal(i).toString(16).padStart(2, "0")).join("");
}

/** Valida URLs de imagens externas/embutidas para evitar esquemas perigosos. */
function enderecoDeImagem(url) {
  const u = String(url || "").trim();
  return /^(https?:\/\/|data:image\/|\/)/i.test(u) ? u : "";
}

function aplicarIdentidade(id) {
  const i = Object.assign({}, IDENTIDADE_PADRAO, id || {});
  // Migração visual gratuita da identidade inicial. Organizações que já
  // escolheram outro nome continuam com a própria marca.
  if (i.nome_site === "Balcão" && (i.sigla === "B" || !i.sigla)) {
    i.nome_site = "Alta-Pista";
    i.sigla = "AP";
  }
  estado.identidade = i;
  estado.organizacao = i.organizacao || "";

  const raiz = document.documentElement.style;
  raiz.setProperty("--acento", i.cor_acento);
  raiz.setProperty("--sobre-acento", tintaSobre(i.cor_acento));
  raiz.setProperty("--acento-escuro", escurecer(i.cor_acento, 0.12));

  const selo = $(".marca .selo");
  const logoSegura = enderecoDeImagem(i.logo_url);
  selo.innerHTML = logoSegura
    ? '<img src="' + esc(logoSegura) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
    : esc((i.sigla || "AP").slice(0, 3).toUpperCase());
  selo.classList.toggle("com-logo", !!logoSegura);
  $(".marca b").textContent = i.nome_site || "Alta-Pista";
  $("#marca-org").textContent = i.organizacao || i.subtitulo || "Inscrições esportivas";
  document.title = (i.nome_site || "Alta-Pista") + (i.organizacao ? " · " + i.organizacao : "");

  if (i.sobre) $("#rodape-sobre").textContent = i.sobre;
  const contato = [];
  if (i.contato) contato.push("<li><span>" + esc(i.contato) + "</span></li>");
  const zap = String(i.whatsapp || "").replace(/\D/g, "");
  if (zap) contato.push('<li><a href="https://wa.me/' +
    esc(zap) + '" target="_blank" rel="noopener noreferrer">WhatsApp ' + esc(i.whatsapp) + "</a></li>");
  const insta = String(i.instagram || "").replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "");
  if (insta) contato.push('<li><a href="https://instagram.com/' +
    esc(insta) + '" target="_blank" rel="noopener noreferrer">@' +
    esc(insta) + "</a></li>");
  if (contato.length) $("#rodape-contato").innerHTML = contato.join("");
}

/* ============================================================== estado === */

const estado = {
  sessao: null,
  organizador: false,
  organizacao: "",
  identidade: Object.assign({}, IDENTIDADE_PADRAO),
  eventos: [],
  evento: null,
  minhas: [],
  filtro: { texto: "", categoria: "", cidade: "" },
  resultados: { lista: [], evento: null, linhas: [] },
  painel: { config: null, eventos: [], inscritos: [] },
  // Taxa de serviço da plataforma, em centavos. Vem do banco (0016) para poder
  // mudar sem republicar o site; 0 desliga a exibição.
  taxa: 0,
  destino: null
};
let vista = "eventos";

/* =============================================================== rotas === */

function ir(nome, ctx, atualizarHist = true) {
  vista = nome;
  if (nome !== "eventos") clearInterval(carrosselRelogio); // não roda escondido
  if (nome !== "minhas") { clearInterval(minhasRelogio); clearInterval(pixValidadeRelogio); }
  document.querySelectorAll(".secao").forEach(s => s.classList.remove("ativa"));
  $("#v-" + nome).classList.add("ativa");
  document.querySelectorAll("#menu button").forEach(b => {
    const marca = b.dataset.ir === nome ||
      (b.dataset.ir === "eventos" && ["evento", "inscricao"].includes(nome));
    if (marca) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (atualizarHist) atualizarEndereco(nome, ctx);
  return desenhar(ctx);
}

/** URLs diretas facilitam a navegação no navegador e divulgação no WhatsApp. */
function atualizarEndereco(nome, ctx) {
  let hash = "";
  if (nome === "evento" && ctx) hash = "#evento=" + encodeURIComponent(ctx);
  else if (nome === "resultados" && ctx) hash = "#resultados=" + encodeURIComponent(ctx);
  else if (nome === "resultados") hash = "#resultados";
  else if (nome === "minhas") hash = "#minhas";
  else if (nome === "entrar") hash = "#entrar";
  else if (nome === "painel") hash = "#painel";
  else if (nome === "inscricao") hash = "#inscricao";
  else if (nome === "eventos") hash = "";

  if (window.location.hash !== hash && !(hash === "" && (!window.location.hash || window.location.hash === "#"))) {
    history.pushState(null, "", window.location.pathname + window.location.search + hash);
  }
}

function destinoDoEndereco() {
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return null;
  const [chave, valor] = h.split("=");
  if (chave === "evento" && valor) return { vista: "evento", slug: decodeURIComponent(valor) };
  if (chave === "resultados") return { vista: "resultados", slug: valor ? decodeURIComponent(valor) : null };
  if (["eventos", "minhas", "entrar", "painel", "inscricao"].includes(chave)) return { vista: chave, slug: null };
  return null;
}

async function desenhar(ctx) {
  $("#rodape-assinatura").textContent =
    (estado.organizacao || estado.identidade.nome_site || "Alta-Pista") + " · " + new Date().getFullYear();
  // Qualquer pessoa com conta pode publicar o próprio evento, então o Painel
  // deixou de ser exclusivo da administração: ele mostra a cada um o que é dele.
  $("#menu button[data-ir='painel']").hidden = !estado.sessao;
  desenharIdentidade();
  if (vista === "eventos") return telaEventos();
  if (vista === "evento") return telaEvento(ctx);
  if (vista === "inscricao") return telaInscricao();
  if (vista === "minhas") return telaMinhas();
  if (vista === "resultados") return telaResultados(ctx);
  if (vista === "entrar") return telaEntrar();
  if (vista === "painel") return telaPainel();
}

function desenharIdentidade() {
  $("#identidade").innerHTML = estado.sessao
    ? '<span class="quem">' + esc(estado.sessao.user.email) + '</span>' +
      '<button class="btn clara pequeno" data-sair="1">Sair</button>'
    : '<button class="btn pequeno" data-ir="entrar">Entrar</button>';
}
const carregando = alvo => { $(alvo).innerHTML = '<p class="carregando">Carregando…</p>'; };

/* ======================================================= tela: eventos == */

/**
 * Busca a lista no banco e desenha. Mexer no filtro chama só `desenharEventos`:
 * filtrar é trabalho de tela, não motivo para bater no banco a cada tecla.
 */
async function telaEventos() {
  carregando("#v-eventos");
  try { estado.eventos = await api.eventosPublicos(); }
  catch (e) { return erroNa("#v-eventos", e); }
  desenharEventos();
}

function desenharEventos() {
  const todos = estado.eventos;
  const f = estado.filtro;
  const visiveis = todos.filter(ev => {
    if (f.categoria && ev.categoria !== f.categoria) return false;
    if (f.cidade && cidadeUF(ev) !== f.cidade) return false;
    if (f.texto) {
      const alvo = (ev.nome + " " + ev.cidade + " " + ev.local + " " + ev.descricao).toLowerCase();
      if (!alvo.includes(f.texto.toLowerCase())) return false;
    }
    return true;
  });

  // Faixa de abertura: se a organização marcou dois ou mais como destaque, são
  // exatamente esses. Se marcou um só (ou nenhum), completa com os próximos
  // eventos abertos até três, para a faixa não ficar parada.
  const abertos = todos.filter(e => e.inscricoes_abertas);
  const marcados = abertos.filter(e => e.destaque);
  const carrossel = marcados.length >= 2
    ? marcados.slice(0, 5)
    : [...marcados, ...abertos.filter(e => !e.destaque)].slice(0, 3);
  if (!carrossel.length && todos.length) carrossel.push(todos[0]);

  let html = carrossel.length ? heroHTML(carrossel) : "";

  html += '<div class="faixa"><div class="limite">' +
    '<div class="cabeca-secao"><h2>Eventos</h2>' +
      '<div class="ao-lado"><span class="contagem">' + visiveis.length + " de " + todos.length +
      (todos.length === 1 ? " evento" : " eventos") + '</span></div></div>' +
    filtroHTML(todos) +
    (visiveis.length
      ? '<div class="grade">' + visiveis.map(cartao).join("") + '</div>'
      : '<div class="vazio"><h3>' + (todos.length ? "Nada com esse filtro" : "Nenhum evento aberto") + '</h3>' +
        '<p>' + (todos.length
          ? "Tente outra busca ou limpe o filtro."
          : "Assim que a organização publicar uma corrida, ela aparece aqui.") + '</p></div>') +
    '</div></div>';

  if (!estado.sessao) {
    html += '<div class="faixa compacta"><div class="limite"><div class="chamada">' +
      '<h2>Sua próxima corrida começa aqui</h2>' +
      '<p>Crie sua conta com o e-mail, escolha o percurso e inscreva-se. ' +
      'Você acompanha o pagamento e a confirmação em um só lugar — e ninguém além da ' +
      'organização enxerga seus dados.</p>' +
      '<div class="acoes"><button class="btn" data-ir="entrar">Entrar ou criar conta</button></div>' +
      '</div></div></div>';
  }

  $("#v-eventos").innerHTML = html;
  ligarFiltro();
  ligarCarrossel();
}

function heroSlide(ev, ativo, naPagina) {
  const lotado = semVaga(ev);
  const preco = precoAtual(ev);
  return '<div class="hero-slide' + (ativo ? " ativo" : "") + '" data-slide>' +
    (ev.imagem_url ? '<div class="hero-foto" style="background-image:url(' + esc(ev.imagem_url) + ')"></div>' : "") +
    '<div class="hero-in">' +
      '<span class="destaque-selo">' + esc(ev.categoria || "Próximo evento") + '</span>' +
      '<h1>' + esc(ev.nome) + '</h1>' +
      '<div class="hero-meta">' +
        '<span><i>◷</i>' + esc(dataLonga(ev.data)) + (ev.hora ? " · " + hora(ev.hora) : "") + '</span>' +
        (cidadeUF(ev) ? '<span><i>⌖</i>' + esc(cidadeUF(ev)) + '</span>' : "") +
        (ev.distancias ? '<span><i>↔</i>' + esc(ev.distancias) + '</span>' : "") +
        '<span><i>◈</i>' + (preco > 0 ? dinheiro(preco) : "Gratuito") + '</span>' +
      '</div>' +
      '<div class="acoes">' +
        // Na própria página do evento, "Detalhes" não leva a lugar nenhum e o
        // botão grande precisa abrir o formulário — antes ele só reabria esta
        // mesma página, e parecia que o clique não fazia nada.
        (naPagina ? "" : '<button class="btn clara" data-abrir="' + esc(ev.slug) + '">Detalhes</button>') +
        (ev.inscricoes_abertas
          ? (naPagina
              ? '<button class="btn" data-inscrever="1">' +
                (lotado ? "Entrar na lista de espera" : "Fazer inscrição") + '</button>'
              : '<button class="btn" data-abrir="' + esc(ev.slug) + '">' +
                (lotado ? "Lista de espera" : "Inscreva-se") + '</button>')
          : '<span class="tag cancelado">Inscrições encerradas</span>') +
      '</div>' +
    '</div></div>';
}

/** Faixa de abertura. Com mais de um evento vira carrossel. */
function heroHTML(lista, naPagina) {
  const evs = Array.isArray(lista) ? lista : [lista];
  if (!evs.length) return "";
  const varios = evs.length > 1;
  return '<section class="hero"' + (varios ? ' id="carrossel"' : "") + '>' +
    evs.map((ev, i) => heroSlide(ev, i === 0, naPagina)).join("") +
    (varios
      ? '<span class="hero-contador" id="hero-contador">1 / ' + evs.length + '</span>' +
        '<button class="hero-seta anterior" data-slide-passo="-1" aria-label="Evento anterior">‹</button>' +
        '<button class="hero-seta proximo" data-slide-passo="1" aria-label="Próximo evento">›</button>' +
        '<div class="hero-pontos">' + evs.map((ev, i) =>
          '<button data-slide-ir="' + i + '" aria-current="' + (i === 0) + '" ' +
          'aria-label="Ver ' + esc(ev.nome) + '"></button>').join("") + '</div>'
      : "") +
  '</section>';
}

let carrosselRelogio = null;
let minhasRelogio = null;
let pixValidadeRelogio = null;
function ligarCarrossel() {
  clearInterval(carrosselRelogio);
  const caixa = $("#carrossel");
  if (!caixa) return;
  const slides = [...caixa.querySelectorAll("[data-slide]")];
  const pontos = [...caixa.querySelectorAll("[data-slide-ir]")];
  if (slides.length < 2) return;
  let atual = 0;

  const mostrar = i => {
    atual = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle("ativo", k === atual));
    pontos.forEach((p, k) => p.setAttribute("aria-current", String(k === atual)));
    const c = $("#hero-contador");
    if (c) c.textContent = (atual + 1) + " / " + slides.length;
  };

  caixa.addEventListener("click", e => {
    const b = e.target.closest("[data-slide-passo],[data-slide-ir]");
    if (!b) return;
    mostrar(b.dataset.slideIr != null ? +b.dataset.slideIr : atual + (+b.dataset.slidePasso));
    reiniciar();
  });

  const paradinho = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reiniciar = () => {
    clearInterval(carrosselRelogio);
    if (!paradinho) carrosselRelogio = setInterval(() => mostrar(atual + 1), 6500);
  };
  caixa.addEventListener("mouseenter", () => clearInterval(carrosselRelogio));
  caixa.addEventListener("mouseleave", reiniciar);
  reiniciar();
}

function filtroHTML(todos) {
  const cats = [...new Set(todos.map(e => e.categoria).filter(Boolean))].sort();
  const cidades = [...new Set(todos.map(cidadeUF).filter(Boolean))].sort();
  const f = estado.filtro;
  const opcoes = (lista, sel) => lista.map(v =>
    '<option value="' + esc(v) + '"' + (sel === v ? " selected" : "") + '>' + esc(v) + '</option>').join("");
  return '<div class="filtro">' +
    '<label>Buscar<input id="f-texto" value="' + esc(f.texto) + '" placeholder="Nome do evento, cidade…"></label>' +
    (cats.length > 1 ? '<label>Modalidade<select id="f-categoria">' +
      '<option value="">Todas</option>' + opcoes(cats, f.categoria) + '</select></label>' : "") +
    (cidades.length > 1 ? '<label>Cidade<select id="f-cidade">' +
      '<option value="">Todas</option>' + opcoes(cidades, f.cidade) + '</select></label>' : "") +
    (f.texto || f.categoria || f.cidade
      ? '<button class="btn fantasma pequeno" data-limpar-filtro="1">Limpar</button>' : "") +
  '</div>';
}

function ligarFiltro() {
  const t = $("#f-texto");
  if (t) {
    let atraso;
    t.addEventListener("input", () => {
      clearTimeout(atraso);
      atraso = setTimeout(() => { estado.filtro.texto = t.value; desenharEventos(); }, 280);
    });
  }
  const c = $("#f-categoria");
  if (c) c.addEventListener("change", () => { estado.filtro.categoria = c.value; desenharEventos(); });
  const u = $("#f-cidade");
  if (u) u.addEventListener("change", () => { estado.filtro.cidade = u.value; desenharEventos(); });
}

function cartao(ev) {
  const { dia, mes } = dataCurta(ev.data);
  const rest = vagasRestantes(ev);
  const lote = loteAtivo(ev);
  const preco = precoAtual(ev);
  const fechado = !ev.inscricoes_abertas;
  const lotado = semVaga(ev);
  const contagem = diasAte(ev.data);
  const iniciais = (ev.nome || "?").split(/\s+/).slice(0, 2).map(p => p[0] || "").join("").toUpperCase();

  let acao;
  if (fechado) acao = '<span class="tag cancelado">Encerradas</span>';
  else if (!lotado) acao = '<button class="btn largo" data-abrir="' + esc(ev.slug) + '">Inscreva-se</button>';
  else if (ev.espera_ativa)
    acao = '<button class="btn fantasma largo" data-abrir="' + esc(ev.slug) + '">Lista de espera' +
      (ev.na_fila ? " (" + ev.na_fila + ")" : "") + '</button>';
  else acao = '<span class="tag pendente">Lotado</span>';

  return '<article class="cartao' + (lotado || fechado ? " encerrado" : "") + '">' +
    '<div class="capa">' +
      (ev.imagem_url
        ? '<img src="' + esc(ev.imagem_url) + '" alt="" loading="lazy">'
        : '<div class="sem-foto">' + esc(iniciais) + '</div>') +
      '<div class="data-selo"><span class="mes">' + mes + '</span><span class="dia">' + dia + '</span></div>' +
      (ev.categoria ? '<span class="modalidade">' + esc(ev.categoria) + '</span>' : "") +
    '</div>' +
    '<div class="cartao-corpo">' +
      (contagem ? '<span class="badge-contagem ' + contagem.classe + '">' + contagem.texto + '</span>' : "") +
      '<h3>' + esc(ev.nome) + '</h3>' +
      '<div class="linhas">' +
        '<span><i>◷</i>' + (ev.hora ? hora(ev.hora) : "Horário a definir") + '</span>' +
        (cidadeUF(ev) ? '<span><i>⌖</i>' + esc(cidadeUF(ev)) + '</span>' : "") +
        (ev.distancias ? '<span><i>↔</i>' + esc(ev.distancias) + '</span>' : "") +
      '</div>' +
      '<div class="preco-linha">' +
        '<span class="preco">' + (preco > 0 ? dinheiro(preco) : "Gratuito") + '</span>' +
        (lote && (ev.lotes || []).length > 1 ? '<small>' + esc(lote.nome) + '</small>' : "") +
        (rest != null ? '<span class="vagas" style="margin-left:auto">' +
          (rest === 0 ? "Sem vagas" : rest === 1 ? "1 vaga" : rest + " vagas") + '</span>' : "") +
      '</div>' + acao +
    '</div></article>';
}

/* ================================================ tela: evento + edital == */

async function telaEvento(slug) {
  if (slug) {
    carregando("#v-evento");
    try { estado.evento = await api.eventoPublico(slug); }
    catch (e) { return erroNa("#v-evento", e); }
  }
  const ev = estado.evento;
  if (!ev) return ir("eventos");

  const rest = vagasRestantes(ev);
  const lote = loteAtivo(ev);
  const lotado = semVaga(ev);
  const fechado = !ev.inscricoes_abertas;
  const contagem = diasAte(ev.data);
  const linkMaps = "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent([ev.local, cidadeUF(ev)].filter(Boolean).join(", "));

  const tabelaLotes = (ev.lotes || []).length > 1
    ? '<div class="sub"><h4>Lotes</h4><div style="margin-top:6px">' +
      ev.lotes.map(l => {
        const m = motivoLote(ev, l);
        const cor = m === "à venda agora" ? "pago"
          : (m === "esgotado" || m.startsWith("encerrado")) ? "cancelado" : "espera";
        return '<div class="linha-dados"><dt style="text-transform:none;letter-spacing:0">' + esc(l.nome) +
          ' <span class="tag ' + cor + '" style="margin-left:6px">' + esc(m) + '</span></dt>' +
          '<dd class="mono">' + dinheiro(l.preco_centavos) + '</dd></div>';
      }).join("") + '</div></div>'
    : "";

  clearInterval(carrosselRelogio); // a página do evento tem faixa única, sem rodízio
  $("#v-evento").innerHTML =
    heroHTML([ev], true) +
    '<div class="faixa"><div class="limite">' +
    '<button class="btn fantasma pequeno" data-ir="eventos" style="margin-bottom:18px">← Todos os eventos</button>' +
    '<div class="painel">' +
      (contagem ? '<span class="badge-contagem ' + contagem.classe + '" style="margin-bottom:8px">' + contagem.texto + '</span>' : "") +
      '<span class="eyebrow">' + (lotado && !fechado ? "Lista de espera" : "Inscrições") + '</span>' +
      '<h2 style="margin-top:4px">' + esc(ev.nome) + '</h2>' +
      (ev.descricao ? '<p style="margin-top:10px;color:var(--tinta-media)">' + esc(ev.descricao) + '</p>' : "") +
      '<div class="linha-acoes-evento">' +
        '<button class="btn fantasma pequeno" data-compartilhar="' + esc(ev.slug) + '">📤 Compartilhar no WhatsApp</button>' +
        '<button class="btn fantasma pequeno" data-calendario="' + esc(ev.slug) + '">📅 Salvar na agenda</button>' +
        '<a class="btn fantasma pequeno" href="' + esc(linkMaps) + '" target="_blank" rel="noopener noreferrer">📍 Como chegar (GPS)</a>' +
      '</div>' +
      '<dl style="margin-top:14px">' +
        '<div class="linha-dados"><dt>Quando</dt><dd>' + esc(dataLonga(ev.data)) +
          (ev.hora ? " · " + hora(ev.hora) : "") + '</dd></div>' +
        '<div class="linha-dados"><dt>Onde</dt><dd>' + esc(ev.local || "A definir") +
          (cidadeUF(ev) ? " — " + esc(cidadeUF(ev)) : "") + '</dd></div>' +
        (ev.distancias ? '<div class="linha-dados"><dt>Percursos</dt><dd>' + esc(ev.distancias) + '</dd></div>' : "") +
        '<div class="linha-dados"><dt>Valor' + (lote && ev.lotes.length > 1 ? " · " + esc(lote.nome) : "") +
          '</dt><dd class="mono">' + valorComTaxa(precoAtual(ev)) + '</dd></div>' +
        (rest != null ? '<div class="linha-dados"><dt>Vagas restantes</dt><dd class="mono">' + rest + '</dd></div>' : "") +
        (ev.na_fila ? '<div class="linha-dados"><dt>Na lista de espera</dt><dd class="mono">' + ev.na_fila + '</dd></div>' : "") +
      '</dl>' + tabelaLotes +
      (String(ev.edital || "").trim()
        ? '<div class="edital"><h2 style="font-size:1.1rem;margin-bottom:14px">Edital do evento</h2>' +
          renderEdital(ev.edital) + '</div>' +
          '<div class="acoes"><button class="btn fantasma pequeno" data-imprimir="1">Imprimir ou salvar em PDF</button></div>'
        : "") +
      assistenteDoEventoHTML(ev) +
      '<div class="acoes">' +
        (fechado
          ? '<span class="tag cancelado">Inscrições encerradas</span>'
          : '<button class="btn" data-inscrever="1">' +
            (lotado ? "Entrar na lista de espera" : "Fazer inscrição") + '</button>') +
        (ev.resultados_publicados
          ? '<button class="btn fantasma" data-resultado="' + esc(ev.slug) + '">Ver resultados</button>' : "") +
      '</div>' +
    '</div></div></div>';

  ligarAssistenteDoEvento(ev);
}

/* Assistente local: pesquisa inteligente no edital e dados do evento. */
function assistenteDoEventoHTML(ev) {
  const sugestoes = [
    "Qual o valor da inscrição?",
    "Onde e que horas?",
    "Quais os percursos?",
    "Até quando posso me inscrever?",
    "Como funciona o kit e camisa?"
  ];
  return '<aside class="assistente-evento" aria-label="Tire dúvidas sobre o evento">' +
    '<span class="eyebrow">Ajuda rápida</span><h3>Tem alguma dúvida?</h3>' +
    '<p>Pergunte sobre data, local, lotes, percursos, valores ou regras. A resposta usa as informações oficiais deste evento.</p>' +
    '<div class="ajuda-chips" role="group" aria-label="Perguntas rápidas">' +
      sugestoes.map(s => '<button type="button" class="chip-ajuda" data-pergunta-chip="' + esc(s) + '">' + esc(s) + '</button>').join("") +
    '</div>' +
    '<form id="form-ajuda-evento"><label class="sr-only" for="pergunta-evento">Sua pergunta</label>' +
      '<div class="ajuda-linha">' +
        '<input id="pergunta-evento" maxlength="280" autocomplete="off" placeholder="Ex.: até quando posso me inscrever?">' +
        '<button class="btn pequeno" type="submit">Perguntar</button>' +
      '</div>' +
    '</form>' +
    '<div id="resposta-evento" class="resposta-ajuda" aria-live="polite"></div>' +
  '</aside>';
}

const STOPWORDS_PT = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "em", "no", "na", "nos", "nas", "por", "para", "com", "sem", "sob", "sobre",
  "ao", "aos", "qual", "quais", "quem", "como", "onde", "quando", "quanto", "quantos",
  "quanta", "quantas", "que", "se", "ou", "e", "este", "esta", "estes", "estas",
  "esse", "essa", "esses", "essas", "aquele", "aquela", "aqueles", "aquelas",
  "isto", "isso", "aquilo", "meu", "minha", "seu", "sua", "dele", "dela",
  "nosso", "nossa", "tem", "temos", "pode", "podem", "fazer", "acontece",
  "ser", "esta", "estao", "estava", "estavam", "vai", "vao", "voce", "voces", "eu",
  "ha", "deste", "desta", "nesse", "nessa", "mim", "me"
]);

function palavrasDaPergunta(texto) {
  const norm = String(texto || "").toLocaleLowerCase("pt-BR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const palavras = norm.match(/[a-z0-9]{2,}/g) || [];
  const filtradas = palavras.filter(p => !STOPWORDS_PT.has(p));
  return filtradas.length ? filtradas : palavras;
}

function respostaDoEvento(ev, pergunta) {
  const termos = palavrasDaPergunta(pergunta);
  if (!termos.length) return "Escreva uma pergunta para eu procurar a resposta no edital.";

  const textoBusca = " " + termos.join(" ") + " ";
  const tem = t => termos.includes(t) || textoBusca.includes(" " + t + " ");

  // Intenção 1: Data / Horário / Início
  if (tem("data") || tem("quando") || tem("dia") || tem("hora") || tem("horario") ||
      tem("horas") || tem("inicio") || tem("largada") || tem("comeca") || tem("termina")) {
    const d = dataLonga(ev.data);
    const h = ev.hora ? " às " + hora(ev.hora) : "";
    return "Data e horário: " + d + h + ". Local: " + (ev.local || "a definir") + (cidadeUF(ev) ? " — " + cidadeUF(ev) : "") + ".";
  }

  // Intenção 2: Local / Cidade / Onde
  if (tem("local") || tem("onde") || tem("endereco") || tem("cidade") || tem("chegar") ||
      tem("rua") || tem("pista") || tem("estadio") || tem("bairro") || tem("mapa") || tem("uf")) {
    return "Local da prova: " + (ev.local || "A definir") + (cidadeUF(ev) ? " (" + cidadeUF(ev) + ")" : "") + ".";
  }

  // Intenção 3: Valores / Preço / Lotes / Pix
  if (tem("preco") || tem("precos") || tem("valor") || tem("valores") || tem("custa") ||
      tem("custo") || tem("lote") || tem("lotes") || tem("taxa") || tem("taxas") ||
      tem("pagar") || tem("pagamento") || tem("pix") || tem("gratis") || tem("gratuito")) {
    const lotes = (ev.lotes || []).slice().sort((a, b) => a.ordem - b.ordem);
    const preco = precoAtual(ev);
    let descLotes = "";
    if (lotes.length > 1) {
      descLotes = " Lotes: " + lotes.map(l => l.nome + " (" + (l.preco_centavos > 0 ? dinheiro(l.preco_centavos) : "Gratuito") + ")").join(", ") + ".";
    }
    return "Valor da inscrição: " + (preco > 0 ? dinheiro(preco) : "Gratuito") + "." + descLotes + " O pagamento é feito via Pix no próprio site.";
  }

  // Intenção 4: Percursos / Distâncias
  if (tem("percurso") || tem("percursos") || tem("distancia") || tem("distancias") ||
      tem("km") || tem("5k") || tem("5km") || tem("10k") || tem("10km") || tem("21k") ||
      tem("21km") || tem("42k") || tem("42km") || tem("trajeto") || tem("caminhada") || tem("corrida")) {
    if (ev.distancias) {
      return "Percursos confirmados: " + ev.distancias + ".";
    }
  }

  // Intenção 5: Inscrições / Vagas / Prazos
  if (tem("inscricao") || tem("inscricoes") || tem("inscrever") || tem("prazo") ||
      tem("ate") || tem("encerramento") || tem("encerrar") || tem("aberta") ||
      tem("abertas") || tem("vaga") || tem("vagas") || tem("espera") || tem("fila")) {
    const status = ev.inscricoes_abertas ? "Inscrições abertas no site." : "Inscrições encerradas.";
    const vagas = ev.vagas ? " Vagas restantes: " + (vagasRestantes(ev) ?? "ilimitadas") + "." : "";
    return "Situação das inscrições: " + status + vagas;
  }

  // Busca contextual em fatos e trechos do edital
  const fatos = [
    "Data e horário: " + dataLonga(ev.data) + (ev.hora ? " às " + hora(ev.hora) : ""),
    "Local: " + (ev.local || "a definir") + (cidadeUF(ev) ? " — " + cidadeUF(ev) : ""),
    ev.distancias ? "Percursos: " + ev.distancias : "",
    "Inscrições: " + (ev.inscricoes_abertas ? "abertas" : "encerradas"),
    "Valor atual: " + (precoAtual(ev) > 0 ? dinheiro(precoAtual(ev)) : "gratuito"),
    String(ev.edital || "")
  ].filter(Boolean);

  const trechos = fatos.flatMap(f => f.split(/(?<=[.!?])\s+|\n+/)).filter(t => t.trim().length > 6);
  const melhor = trechos.map(t => {
    const palavrasDoTrecho = palavrasDaPergunta(t);
    const pontos = termos.filter(p => palavrasDoTrecho.some(pt => pt.includes(p) || p.includes(pt))).length;
    return { t: t.trim().replace(/^[-#*>\s]+/, ""), pontos };
  }).sort((a, b) => b.pontos - a.pontos)[0];

  if (melhor && melhor.pontos > 0) {
    return melhor.t;
  }

  return "Não encontrei isso nas informações públicas publicadas. Consulte o edital completo acima ou fale com a organização pelo contato no rodapé.";
}

function ligarAssistenteDoEvento(ev) {
  const form = $("#form-ajuda-evento");
  if (!form) return;
  const input = $("#pergunta-evento");
  const resposta = $("#resposta-evento");

  form.addEventListener("submit", e => {
    e.preventDefault();
    const pergunta = input ? input.value.trim() : "";
    resposta.textContent = respostaDoEvento(ev, pergunta);
  });

  document.querySelectorAll(".chip-ajuda").forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.dataset.perguntaChip || chip.textContent;
      if (input) { input.value = q; }
      resposta.textContent = respostaDoEvento(ev, q);
    });
  });
}

/* ==================================================== tela: inscrição === */

/**
 * Telefone brasileiro: DDD com dois algarismos e o número com oito (fixo) ou
 * nove (celular) — onze algarismos no máximo. Escreve sozinho os parênteses,
 * o espaço e o tracinho, e simplesmente ignora o que passar disso, para
 * ninguém digitar o número errado sem perceber.
 */
function telefoneBonito(bruto) {
  const d = String(bruto || "").replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return "(" + d;
  const corte = d.length <= 10 ? 6 : 7;
  const meio = d.slice(2, corte), fim = d.slice(corte);
  return "(" + d.slice(0, 2) + ") " + meio + (fim ? "-" + fim : "");
}

document.addEventListener("input", e => {
  const campo = e.target;
  if (campo && campo.name === "telefone") campo.value = telefoneBonito(campo.value);
});

function campoExtraHTML(c) {
  const req = c.obrigatorio ? " required" : "";
  const dica = c.obrigatorio ? "" : ' <span class="dica">opcional</span>';
  let controle;
  if (c.tipo === "opcoes") {
    const ops = String(c.opcoes || "").split(",").map(s => s.trim()).filter(Boolean);
    controle = '<select name="x_' + esc(c.id) + '"' + req + '><option value="">Escolha…</option>' +
      ops.map(o => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join("") + '</select>';
  } else if (c.tipo === "cpf") {
    controle = '<input name="x_' + esc(c.id) + '" class="mono" inputmode="numeric" maxlength="14" ' +
      'placeholder="000.000.000-00" data-cpf="1"' + req + '>';
  } else if (c.tipo === "data") {
    controle = '<input name="x_' + esc(c.id) + '" type="date"' + req + '>';
  } else {
    controle = '<input name="x_' + esc(c.id) + '"' + req +
      (c.opcoes ? ' placeholder="' + esc(c.opcoes) + '"' : "") + '>';
  }
  return '<label>' + esc(c.rotulo) + dica + controle + '</label>';
}

/* O link mágico recarrega a página, então o destino não pode viver só na
   memória: guardamos no sessionStorage para trazer a pessoa de volta ao
   mesmo evento depois que ela entra. */
function guardarDestino(vista, slug) {
  estado.destino = { vista, slug };
  try { sessionStorage.setItem("destino", JSON.stringify(estado.destino)); } catch (e) {}
}
function pegarDestino() {
  if (estado.destino) return estado.destino;
  try { return JSON.parse(sessionStorage.getItem("destino") || "null"); } catch (e) { return null; }
}
function limparDestino() {
  estado.destino = null;
  try { sessionStorage.removeItem("destino"); } catch (e) {}
}

async function telaInscricao() {
  const ev = estado.evento;
  if (!ev) return ir("eventos");
  if (!estado.sessao) { guardarDestino("inscricao", ev.slug); return ir("entrar"); }

  const perfil = await api.meuPerfil().catch(() => null);
  const lotado = semVaga(ev);
  const extras = ev.perguntas || [];

  $("#v-inscricao").innerHTML =
    '<div class="faixa"><div class="limite" style="max-width:860px">' +
    '<button class="btn fantasma pequeno" data-voltar-evento="1" style="margin-bottom:18px">← Voltar ao evento</button>' +
    '<div class="painel">' +
      '<span class="eyebrow">' + (lotado ? "Lista de espera" : "Ficha de inscrição") + '</span>' +
      '<h2 style="margin-top:4px">' + esc(ev.nome) + '</h2>' +
      (lotado
        ? '<div class="aviso info" style="margin-top:16px"><span>☷</span><span>As vagas acabaram. ' +
          'Você entra na fila sem pagar nada agora; se abrir vaga, a organização libera sua inscrição ' +
          'e o Pix aparece em <b>Minhas inscrições</b>.</span></div>'
        : '<p style="color:var(--tinta-media);font-size:.95rem;margin-top:6px">Valor da inscrição: ' +
          '<b class="mono">' + (precoAtual(ev) > 0 ? dinheiro(precoAtual(ev)) : "Gratuito") + '</b></p>') +

      '<form id="form-inscricao">' +
        '<div class="para-quem">' +
          '<label><input type="radio" name="para" value="eu" checked> Sou eu que vou participar</label>' +
          '<label><input type="radio" name="para" value="outro"> Estou inscrevendo outra pessoa</label>' +
        '</div>' +
        '<div class="campos duas">' +
          '<label>Nome completo do participante<input name="nome" required autocomplete="name" value="' +
            esc(perfil && perfil.nome || "") + '"></label>' +
          '<label>Data de nascimento<input name="nascimento" type="date" required></label>' +
          '<label>E-mail para contato<input name="email" type="email" required value="' +
            esc(estado.sessao.user.email) + '"></label>' +
          '<label>Telefone <span class="dica">com DDD</span>' +
            '<input name="telefone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="15" value="' +
            esc(telefoneBonito(perfil && perfil.telefone || "")) + '" placeholder="(83) 99999-9999"></label>' +
          extras.map(campoExtraHTML).join("") +
          '<label>Observação <span class="dica">opcional</span>' +
            '<input name="observacao" placeholder="Algo que a organização precisa saber"></label>' +
        '</div>' +
        (precoAtual(ev) > 0 && estado.taxa > 0 && !lotado
          ? '<div class="linha-dados" style="margin-top:16px;border-top:1px solid var(--borda);padding-top:14px">' +
              '<dt>Total a pagar</dt><dd class="mono">' + valorComTaxa(precoAtual(ev)) + '</dd></div>'
          : "") +
        '<div class="acoes">' +
          '<button class="btn" type="submit" id="botao-enviar">' +
            (lotado ? "Entrar na lista de espera" : precoAtual(ev) > 0 ? "Gerar meu Pix" : "Confirmar inscrição") +
          '</button>' +
          '<span style="font-size:.83rem;color:var(--tinta-fraca)">' +
            'Seus dados ficam com a organização e só você enxerga sua inscrição.</span>' +
        '</div>' +
        // Diz para que servem os dados, por quanto tempo ficam e como sair.
        // A escola é a responsável por eles, e como há menores inscritos por
        // responsáveis, isso precisa estar escrito, não combinado de boca.
        '<div class="explica" style="margin-top:14px;font-size:.83rem;line-height:1.5">' +
          '<b>Sobre os seus dados.</b> Usamos o que você preencher apenas para organizar ' +
          'este evento: confirmar a inscrição e o pagamento, emitir o número de peito, ' +
          'entregar o kit e publicar a classificação. Ficam guardados enquanto o evento ' +
          'estiver ativo e podem ser apagados a qualquer momento a seu pedido — é só falar ' +
          'com a organização. Não vendemos nem repassamos esses dados a ninguém.' +
        '</div>' +
        '<div id="erro-inscricao"></div>' +
      '</form>' +
    '</div></div></div>';

  $("#form-inscricao").addEventListener("submit", async envio => {
    envio.preventDefault();
    const f = new FormData(envio.target);
    const respostas = {};
    for (const c of extras) {
      const v = String(f.get("x_" + c.id) || "").trim();
      if (c.tipo === "cpf" && v && !validaCPF(v)) {
        $("#erro-inscricao").innerHTML = '<div class="erro">O CPF informado em “' +
          esc(c.rotulo) + '” não confere. Confira os números.</div>';
        return;
      }
      if (v) respostas[c.id] = c.tipo === "data" ? dataBR(v) : v;
    }
    const botao = $("#botao-enviar");
    botao.disabled = true;
    botao.textContent = "Enviando…";
    try {
      const ins = await api.inscrever({
        eventoId: ev.id,
        nome: String(f.get("nome") || "").trim(),
        nascimento: f.get("nascimento") || null,
        email: String(f.get("email") || "").trim(),
        telefone: String(f.get("telefone") || "").trim(),
        ehTitular: f.get("para") === "eu",
        respostas,
        observacao: String(f.get("observacao") || "").trim()
      });
      torrar(ins.status === "espera"
        ? "Você entrou na lista de espera — código " + ins.codigo
        : "Inscrição registrada — código " + ins.codigo);
      await ir("minhas");
    } catch (e) {
      $("#erro-inscricao").innerHTML = '<div class="erro">' + esc(mensagemDe(e)) + '</div>';
      botao.disabled = false;
      botao.textContent = lotado ? "Entrar na lista de espera" : "Tentar de novo";
    }
  });
}

/* =============================================== tela: minhas inscrições = */

async function telaMinhas() {
  if (!estado.sessao) { guardarDestino("minhas"); return ir("entrar"); }
  carregando("#v-minhas");
  try { estado.minhas = await api.minhasInscricoes(); }
  catch (e) { return erroNa("#v-minhas", e); }

  let html = '<div class="faixa"><div class="limite" style="max-width:900px">' +
    '<div class="cabeca-secao"><h2>Minhas inscrições</h2>' +
    '<p>Tudo que você inscreveu com este e-mail, para você e para dependentes.</p></div>';

  if (!estado.minhas.length) {
    html += '<div class="vazio"><h3>Você ainda não tem inscrições</h3>' +
      '<p>Escolha um evento na aba Eventos para começar.</p>' +
      '<div class="acoes" style="justify-content:center"><button class="btn" data-ir="eventos">Ver eventos</button></div>' +
      '</div></div></div>';
    $("#v-minhas").innerHTML = html;
    return;
  }

  for (const i of estado.minhas) {
    const ev = i.eventos || {};
    html += '<div class="painel" style="margin-bottom:18px">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">' +
        '<div><span class="eyebrow">' + esc(ev.nome || "Evento") + '</span>' +
        '<h3 style="text-transform:uppercase;margin-top:2px">' + esc(i.participante_nome) +
        (i.eh_titular ? "" : ' <span class="tag espera" style="margin-left:6px">dependente</span>') + '</h3></div>' +
        '<span class="tag ' + classeStatus(i.status) + '">' + rotuloStatus(i.status) + '</span>' +
      '</div>' +
      (i.numero != null
        ? '<div class="mini-peito-cartao">' +
            '<div><span style="font-size:.7rem;text-transform:uppercase;color:var(--tinta-fraca);display:block">Número Oficial</span>' +
            '<span class="num">' + formatarNumero(i.numero, (i.eventos || {}).numero_digitos) + '</span></div>' +
            '<div style="margin-left:auto;display:flex;gap:6px">' +
              '<button class="btn pequeno" data-peito="' + i.id + '">🖨️ Imprimir folha</button>' +
            '</div>' +
          '</div>'
        : "") +
      '<dl style="margin-top:14px">' +
        '<div class="linha-dados"><dt>Código da inscrição</dt><dd class="mono">' + esc(i.codigo) + '</dd></div>' +
        '<div class="linha-dados"><dt>Valor' + (i.lote_nome ? " · " + esc(i.lote_nome) : "") +
          '</dt><dd class="mono">' + (i.valor_centavos > 0 ? dinheiro(i.valor_centavos) : "Gratuito") + '</dd></div>' +
        (ev.data ? '<div class="linha-dados"><dt>Quando</dt><dd>' + esc(dataLonga(ev.data)) +
          (ev.hora ? " · " + hora(ev.hora) : "") + '</dd></div>' : "") +
        (ev.local ? '<div class="linha-dados"><dt>Onde</dt><dd>' + esc(ev.local) + '</dd></div>' : "") +
      '</dl>' +
      '<div id="pix-' + i.id + '"></div>' +
      '<div class="acoes">' +
        (i.status === "pendente" ? '<button class="btn" data-pix="' + i.id + '">Ver o Pix</button>' : "") +
        (ev.data ? '<button class="btn fantasma pequeno" data-calendario="' + esc(ev.slug) + '">📅 Salvar na agenda</button>' : "") +
        (i.status !== "pago" && i.status !== "cancelada"
          ? '<button class="btn perigo pequeno" data-cancelar="' + i.id + '">Cancelar inscrição</button>' : "") +
      '</div></div>';
  }
  $("#v-minhas").innerHTML = html + '</div></div>';

  vigiarPendentes();

  for (const i of estado.minhas.filter(x => x.status === "espera")) {
    api.posicaoNaFila(i.id).then(pos => {
      const alvo = $("#pix-" + i.id);
      if (alvo && pos) {
        alvo.innerHTML = '<div class="aviso info"><span>☷</span><span>Você está na ' +
          '<b>' + pos + 'ª</b> posição da fila. A organização avisa quando abrir vaga.</span></div>';
      }
    }).catch(() => {});
  }
}

/**
 * Enquanto houver inscrição pendente na tela, confere sozinho de vinte em vinte
 * segundos. Assim, quando a organização confirma o pagamento, a pessoa vê mudar
 * para "pago" sem precisar recarregar — ela costuma ficar com a tela aberta
 * esperando justamente isso. Para de conferir quando não há mais pendência,
 * quando ela sai da tela e enquanto a aba está em segundo plano.
 */
function vigiarPendentes() {
  clearInterval(minhasRelogio);
  if (!estado.minhas.some(i => i.status === "pendente")) return;

  const assinatura = () => estado.minhas.map(i => i.id + ":" + i.status).join("|");
  let antes = assinatura();

  minhasRelogio = setInterval(async () => {
    if (vista !== "minhas" || document.hidden) return;
    try { estado.minhas = await api.minhasInscricoes(); }
    catch (e) { return; }                     // sem rede: tenta de novo depois
    if (assinatura() === antes) return;
    antes = assinatura();
    if (estado.minhas.some(i => i.status === "pago")) torrar("Pagamento confirmado!");
    telaMinhas();
  }, 20000);
}

async function mostrarPix(id) {
  const alvo = $("#pix-" + id);
  if (!alvo) return;
  clearInterval(pixValidadeRelogio);
  alvo.innerHTML = '<p class="carregando">Gerando a cobrança…</p>';
  let dados;
  try { dados = await api.cobranca(id); }
  catch (e) { alvo.innerHTML = '<div class="erro">' + esc(mensagemDe(e)) + '</div>'; return; }
  if (!dados) {
    alvo.innerHTML = '<div class="aviso"><span>⚑</span><span>A organização ainda não cadastrou a chave Pix. ' +
      'Sua inscrição está registrada; procure a organização para combinar o pagamento.</span></div>';
    return;
  }

  // A cobrança pode vir de duas origens:
  //  - gateway automático (Mercado Pago): já traz o "copia e cola" pronto em
  //    payload_pix e um prazo de validade em expira_em; o pagamento é
  //    confirmado sozinho pelo webhook, sem ninguém conferir extrato.
  //  - função cobranca() do banco (reserva): traz os dados da chave e o código
  //    é montado aqui; nesse caso a confirmação ainda é manual.
  const automatico = typeof dados.payload_pix === "string" && dados.payload_pix.length > 0;
  const payload = automatico ? dados.payload_pix : Pix.brcode(dados);

  let qr = "";
  try { qr = QR.svg(payload, 3); } catch (e) { qr = ""; }
  if (!qr && automatico && dados.qrCodeImageBase64)
    qr = '<img alt="QR Code do Pix" src="data:image/png;base64,' + esc(dados.qrCodeImageBase64) + '">';

  const expiraEm = automatico && dados.expira_em ? new Date(dados.expira_em).getTime() : 0;
  const idContador = "pix-conta-" + id;

  const rodape = automatico
    ? '<p style="font-size:.82rem;color:var(--tinta-fraca)">Depois de pagar, <b>não precisa ' +
      'fazer mais nada</b>: a confirmação é automática e costuma levar menos de um minuto. ' +
      'Esta tela muda sozinha para <b>paga</b> — pode deixá-la aberta.' +
      (expiraEm ? ' <span id="' + idContador + '"></span>' : "") + '</p>'
    : '<p style="font-size:.82rem;color:var(--tinta-fraca)">Depois de pagar, <b>não precisa ' +
      'fazer mais nada</b>: a organização confere o recebimento e confirma em até 24 horas. ' +
      'Quando isso acontecer, esta tela muda sozinha para <b>paga</b> — pode deixá-la aberta, ' +
      'ou voltar aqui depois pelo menu Minhas inscrições.</p>';

  alvo.innerHTML =
    '<div class="pagamento" style="margin-top:18px">' +
      (qr ? '<div class="qr-caixa">' + qr + '</div>' : "") +
      '<div style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
        '<div><span class="eyebrow">Pix copia e cola</span>' +
        '<p style="font-size:.88rem;color:var(--tinta-media);margin-top:4px">' +
        'Abra o app do banco, escolha Pix › Pagar com QR Code e aponte a câmera — ou copie o código.</p></div>' +
        '<div class="copia mono">' + esc(payload) + '</div>' +
        '<div><button class="btn" data-copiar="' + esc(payload) + '">Copiar código Pix</button></div>' +
        rodape +
      '</div>' +
    '</div>';

  if (automatico && expiraEm) vigiarValidadePix(id, expiraEm, idContador);
}

/**
 * O QR Code dinâmico do Mercado Pago vale por cerca de meia hora. Enquanto o
 * quadro do Pix está aberto, mostra quanto ainda falta; quando vence, troca o
 * texto por um botão que gera outro. Só olha o relógio — não consulta nada.
 */
function vigiarValidadePix(id, expiraEm, idContador) {
  clearInterval(pixValidadeRelogio);
  const tick = () => {
    const span = document.getElementById(idContador);
    if (!span) { clearInterval(pixValidadeRelogio); return; }
    const resta = Math.round((expiraEm - Date.now()) / 1000);
    if (resta > 0) {
      const m = Math.floor(resta / 60), s = resta % 60;
      span.textContent = " Este código vale por mais " + m + " min " +
        String(s).padStart(2, "0") + " s.";
      return;
    }
    clearInterval(pixValidadeRelogio);
    span.innerHTML = ' Este código expirou. ' +
      '<button class="btn pequeno" data-pix="' + id + '">Gerar novo Pix</button>';
  };
  tick();
  pixValidadeRelogio = setInterval(tick, 1000);
}

/* =================================================== tela: resultados === */

async function telaResultados(slug) {
  carregando("#v-resultados");
  if (slug) {
    try {
      const ev = await api.eventoPublico(slug);
      if (!ev) throw new Error("Evento não encontrado.");
      estado.resultados.evento = ev;
      estado.resultados.linhas = await api.resultadosDoEvento(ev.id);
    } catch (e) { return erroNa("#v-resultados", e); }
    return desenharClassificacao();
  }
  estado.resultados.evento = null;
  try { estado.resultados.lista = await api.eventosComResultado(); }
  catch (e) { return erroNa("#v-resultados", e); }

  const lista = estado.resultados.lista;
  $("#v-resultados").innerHTML =
    '<div class="faixa"><div class="limite">' +
    '<div class="cabeca-secao"><h2>Resultados</h2>' +
    '<p>Classificação das provas já realizadas.</p></div>' +
    (lista.length
      ? '<div class="grade">' + lista.map(ev => {
          const { dia, mes } = dataCurta(ev.data);
          const iniciais = (ev.nome || "?").split(/\s+/).slice(0, 2).map(p => p[0] || "").join("").toUpperCase();
          return '<article class="cartao"><div class="capa">' +
            (ev.imagem_url ? '<img src="' + esc(ev.imagem_url) + '" alt="" loading="lazy">'
              : '<div class="sem-foto">' + esc(iniciais) + '</div>') +
            '<div class="data-selo"><span class="mes">' + mes + '</span><span class="dia">' + dia + '</span></div>' +
            '<span class="modalidade">Resultado</span></div>' +
            '<div class="cartao-corpo"><h3>' + esc(ev.nome) + '</h3>' +
            '<div class="linhas">' +
              (cidadeUF(ev) ? '<span><i>⌖</i>' + esc(cidadeUF(ev)) + '</span>' : "") +
              '<span><i>≡</i>' + ev.total + ' classificados</span>' +
            '</div>' +
            '<div style="margin-top:auto;padding-top:12px">' +
            '<button class="btn largo" data-resultado="' + esc(ev.slug) + '">Ver classificação</button></div>' +
            '</div></article>';
        }).join("") + '</div>'
      : '<div class="vazio"><h3>Nenhum resultado publicado</h3>' +
        '<p>Assim que uma prova for apurada, a classificação aparece aqui.</p></div>') +
    '</div></div>';
}

function desenharClassificacao() {
  const ev = estado.resultados.evento;
  const linhas = estado.resultados.linhas;
  const temEquipe = linhas.some(l => l.equipe);
  const temPercurso = linhas.some(l => l.percurso);
  const temCategoria = linhas.some(l => l.categoria);

  $("#v-resultados").innerHTML =
    '<div class="faixa"><div class="limite">' +
    '<button class="btn fantasma pequeno" data-ir="resultados" style="margin-bottom:18px">← Todos os resultados</button>' +
    '<div class="cabeca-secao"><h2>' + esc(ev.nome) + '</h2>' +
      '<div class="ao-lado"><span class="contagem">' + linhas.length + ' classificados</span></div>' +
      '<p>' + esc(dataLonga(ev.data)) + (cidadeUF(ev) ? " · " + esc(cidadeUF(ev)) : "") + '</p></div>' +
    (linhas.length
      ? '<div class="painel"><div class="rolagem"><table><thead><tr>' +
        '<th style="width:70px">Pos.</th><th>Atleta</th>' +
        (temEquipe ? '<th>Equipe</th>' : "") +
        (temCategoria ? '<th>Categoria</th>' : "") +
        (temPercurso ? '<th>Percurso</th>' : "") +
        '<th style="text-align:right">Tempo</th>' +
        '<th style="text-align:right">Certificado</th></tr></thead><tbody>' +
        linhas.map(l => '<tr>' +
          '<td><span class="pos' + (l.posicao && l.posicao <= 3 ? " podio" : "") + '">' +
            (l.posicao != null ? l.posicao + "º" : "—") + '</span></td>' +
          '<td class="nome">' + esc(l.atleta) + '</td>' +
          (temEquipe ? '<td>' + esc(l.equipe || "—") + '</td>' : "") +
          (temCategoria ? '<td>' + esc(l.categoria || "—") + '</td>' : "") +
          (temPercurso ? '<td>' + esc(l.percurso || "—") + '</td>' : "") +
          '<td class="mono" style="text-align:right">' + esc(l.tempo || "—") + '</td>' +
          '<td style="text-align:right"><button class="btn fantasma micro" data-certificado="' + esc(l.id || l.atleta) + '">Certificado</button></td>' +
        '</tr>').join("") + '</tbody></table></div>' +
        '<div class="acoes"><button class="btn fantasma pequeno" data-imprimir="1">Imprimir ou salvar em PDF</button></div>' +
        '</div>'
      : '<div class="vazio"><h3>Classificação ainda vazia</h3><p>A apuração deste evento não foi importada.</p></div>') +
    '</div></div>';
}

/* ==================================================== tela: entrar ====== */

// CAPTCHA opcional (Cloudflare Turnstile) da tela de Entrar. Só entra em cena
// quando CONFIG.turnstileSiteKey está preenchida — a "Site Key" é pública e
// pode ficar no config.js. Vazia, nada disto roda: a tela fica igual a hoje.
// O Supabase valida o token nativamente (Authentication › Attack Protection),
// então basta passar o token adiante em signInWithOtp; não há endpoint próprio.
const TURNSTILE_SITE_KEY = String((CONFIG && CONFIG.turnstileSiteKey) || "").trim();
let turnstilePronto = null;   // Promise, criada só na primeira vez que precisar.

function carregarTurnstile() {
  if (turnstilePronto) return turnstilePronto;
  turnstilePronto = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    // <script> criado por JS, uma única vez. Não mexe no index.html.
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.defer = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => reject(new Error("Não foi possível carregar a verificação de segurança."));
    document.head.appendChild(s);
  });
  return turnstilePronto;
}

function telaEntrar() {
  const usaCaptcha = !!TURNSTILE_SITE_KEY;

  $("#v-entrar").innerHTML =
    '<div class="faixa"><div class="entrar-caixa"><div class="painel">' +
      '<span class="eyebrow">Sua conta</span><h2 style="margin-top:4px">Entrar</h2>' +
      '<p style="color:var(--tinta-media);font-size:.93rem;margin-top:8px">' +
        'Digite seu e-mail e enviamos um link de acesso. Não existe senha para criar nem para lembrar — ' +
        'e é esse e-mail que garante que só você enxerga as suas inscrições.</p>' +
      '<form id="form-entrar"><div class="campos">' +
        '<label>Seu nome<input name="nome" placeholder="Como devemos te chamar"></label>' +
        '<label>E-mail<input name="email" type="email" required placeholder="voce@exemplo.com" autocomplete="email"></label>' +
      '</div>' +
      (usaCaptcha ? '<div id="turnstile-entrar" style="margin-top:14px"></div>' : '') +
      '<div class="acoes"><button class="btn" type="submit" id="botao-entrar">Enviar link de acesso</button></div>' +
      '<div id="aviso-entrar"></div></form>' +
    '</div></div></div>';

  // Token do Turnstile: chega pelo callback quando a verificação passa, e cada
  // token só vale um envio. Sem captcha, fica sempre "" e nada muda.
  let tokenCaptcha = "";
  let widgetCaptcha = null;

  if (usaCaptcha) {
    carregarTurnstile().then(ts => {
      const alvo = $("#turnstile-entrar");
      if (!ts || !alvo) return;   // a pessoa saiu da tela antes de carregar
      widgetCaptcha = ts.render(alvo, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: t => { tokenCaptcha = t || ""; },
        "expired-callback": () => { tokenCaptcha = ""; },
        "error-callback": () => { tokenCaptcha = ""; }
      });
    }).catch(err => {
      const aviso = $("#aviso-entrar");
      if (aviso) aviso.innerHTML = '<div class="erro">' + esc(mensagemDe(err)) + '</div>';
    });
  }

  $("#form-entrar").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const botao = $("#botao-entrar");

    if (usaCaptcha && !tokenCaptcha) {
      $("#aviso-entrar").innerHTML = '<div class="aviso info" style="margin-top:16px"><span>⏳</span><span>' +
        'Aguarde a verificação de segurança terminar — leva alguns segundos — e envie de novo.</span></div>';
      return;
    }

    botao.disabled = true; botao.textContent = "Enviando…";
    try {
      await api.entrarPorEmail(
        String(f.get("email")).trim(),
        String(f.get("nome") || "").trim(),
        tokenCaptcha || undefined
      );
      $("#aviso-entrar").innerHTML = '<div class="aviso info" style="margin-top:16px"><span>✉</span><span>' +
        'Link enviado. Abra seu e-mail e clique no link para entrar — pode levar um minuto, ' +
        'e vale conferir a caixa de spam.</span></div>';
      botao.textContent = "Link enviado";
    } catch (err) {
      $("#aviso-entrar").innerHTML = '<div class="erro">' + esc(mensagemDe(err)) + '</div>';
      botao.disabled = false; botao.textContent = "Tentar de novo";
      // O token queimou nesta tentativa: reinicia o widget para a próxima.
      if (usaCaptcha && window.turnstile && widgetCaptcha != null) {
        try { window.turnstile.reset(widgetCaptcha); } catch (_) {}
        tokenCaptcha = "";
      }
    }
  });
}

/**
 * Como o valor aparece para quem vai pagar. A taxa de serviço é somada ao preço
 * do lote e precisa estar visível ANTES do pagamento — é o que o termo de uso
 * promete, e é a diferença entre uma taxa combinada e uma surpresa no Pix.
 * Evento gratuito não tem taxa, então mostra só "Gratuito".
 */
function valorComTaxa(preco) {
  if (!(preco > 0)) return "Gratuito";
  if (!(estado.taxa > 0)) return dinheiro(preco);
  return dinheiro(preco + estado.taxa) +
    ' <span class="dica" style="text-transform:none;letter-spacing:0">(' +
    dinheiro(preco) + " + " + dinheiro(estado.taxa) + " de taxa de serviço)</span>";
}

/* ==================================================== tela: painel ====== */

let edLotes = [], edPerguntas = [], edEventoId = null, edCapa = "";
let edPeitoLogo = "", edPeitoFundo = "", edPeitoPronto = "";

async function telaPainel() {
  if (!estado.sessao) { guardarDestino("painel"); return ir("entrar"); }
  carregando("#v-painel");
  // Best-effort: devolve as vagas presas em pendências vencidas antes de
  // mostrar os números. Se a função ainda não foi instalada (supabase/0013),
  // segue sem barulho.
  try { await api.expirarPendencias(); } catch (e) { /* 0013 ainda não rodou */ }
  try {
    const [cfg, evs, ins] = await Promise.all([
      api.configuracao(), api.eventosDoPainel(), api.inscritosDoPainel()
    ]);
    estado.painel = { config: cfg, eventos: evs, inscritos: ins };
  } catch (e) { return erroNa("#v-painel", e); }

  const { config, eventos, inscritos } = estado.painel;
  // Deixa a migração também pronta para ser gravada pelo próximo salvamento
  // da identidade, sem alterar outros dados da organização.
  if (config.nome_site === "Balcão" && (config.sigla === "B" || !config.sigla)) {
    config.nome_site = "Alta-Pista";
    config.sigla = "AP";
  }
  const pagos = inscritos.filter(i => i.status === "pago");
  const arrecadado = pagos.reduce((s, i) => s + i.valor_centavos, 0);

  // A lista pública traz "ocupadas" pronta do banco; a do painel não, então
  // conta aqui pelo mesmo critério (pendente + pago) para a barra de ocupação.
  const ocupadasPorEvento = {};
  for (const i of inscritos)
    if (i.status === "pendente" || i.status === "pago")
      ocupadasPorEvento[i.evento_id] = (ocupadasPorEvento[i.evento_id] || 0) + 1;
  eventos.forEach(ev => { ev.ocupadas = ocupadasPorEvento[ev.id] || 0; });

  // Resumo inteligente de tamanhos de camisas e percursos para fornecedores
  const rotulos = rotulosDasPerguntas();
  const resumoCamisas = {};
  const resumoPercursos = {};
  let kitsEntregues = 0;
  for (const ins of inscritos) {
    if (ins.kit_retirado) kitsEntregues++;
    const cam = respostaSobre(ins.respostas, ["camisa", "camiseta", "tamanho", "blusa"], rotulos);
    if (cam) resumoCamisas[cam] = (resumoCamisas[cam] || 0) + (ins.status === "pago" ? 1 : 0);
    const perc = respostaSobre(ins.respostas, ["percurso", "distancia", "distância", "prova", "km"], rotulos);
    if (perc) resumoPercursos[perc] = (resumoPercursos[perc] || 0) + (ins.status === "pago" ? 1 : 0);
  }
  const temCamisas = Object.keys(resumoCamisas).length > 0;
  const temPercursos = Object.keys(resumoPercursos).length > 0;

  let html = '<div class="faixa"><div class="limite">' +
    '<div class="cabeca-secao"><h2>Painel da organização</h2>' +
    '<p>Configure o Pix, publique eventos com edital, importe resultados e confirme pagamentos.</p></div>' +
    '<div class="numeros">' +
      numero(inscritos.length, "Inscrições") +
      numero(pagos.length, "Pagas") +
      numero(inscritos.filter(i => i.status === "pendente").length, "Pendentes") +
      numero(inscritos.filter(i => i.status === "espera").length, "Na fila") +
      numero(dinheiro(arrecadado), "Confirmado") +
    '</div>';

  if (inscritos.length && (temCamisas || temPercursos || pagos.length)) {
    html += '<div class="resumo-camisas">' +
      (temCamisas ? '<div><h4>👕 Pedido de Camisas (Inscrições Pagas)</h4><div class="chips-resumo">' +
        Object.entries(resumoCamisas).map(([tam, qtd]) =>
          '<span class="chip-resumo"><span>' + esc(tam) + '</span><strong>' + qtd + '</strong></span>').join("") +
        '</div></div>' : '') +
      (temPercursos ? '<div><h4>🏃 Percursos Escolhidos</h4><div class="chips-resumo">' +
        Object.entries(resumoPercursos).map(([perc, qtd]) =>
          '<span class="chip-resumo"><span>' + esc(perc) + '</span><strong>' + qtd + '</strong></span>').join("") +
        '</div></div>' : '') +
      '<div><h4>📦 Entrega de Kits</h4><div class="chips-resumo">' +
        '<span class="chip-resumo"><span>Entregues</span><strong>' + kitsEntregues + ' de ' + pagos.length + ' (' +
        (pagos.length ? Math.round((kitsEntregues / pagos.length) * 100) : 0) + '%)</strong></span>' +
      '</div></div>' +
    '</div>';
  }

  // Só a administração da plataforma: identidade do site, chave da casa e
  // equipe são globais, não pertencem a quem publica um evento.
  if (estado.organizador) html += '<div class="painel"><span class="eyebrow">Marca</span><h3 style="margin-top:4px">Identidade do site</h3>' +
    '<p style="color:var(--tinta-media);font-size:.9rem;margin-top:6px">' +
      'O selo do topo, o nome, a cor e os textos do rodapé. Vale para todo mundo assim que salvar.</p>' +
    '<form id="form-identidade"><div class="campos duas">' +
      campo("sigla", "Iniciais do selo", config.sigla, "1 a 3 letras", "", 3) +
      campo("nome_site", "Nome do site", config.nome_site, "aparece grande no topo") +
      campo("subtitulo", "Linha de apoio", config.subtitulo, "usada quando não há nome da organização") +
      '<label>Cor de acento <span class="dica">botões, selos e destaques</span>' +
        '<span style="display:flex;gap:8px;align-items:center">' +
        '<input type="color" name="cor_acento" value="' + esc(config.cor_acento || "#C6F24E") +
          '" style="width:52px;height:40px;padding:3px" id="cor-acento">' +
        '<input name="cor_acento_texto" class="mono" value="' + esc(config.cor_acento || "#C6F24E") +
          '" maxlength="7" id="cor-acento-texto"></span></label>' +
      campo("contato", "Contato no rodapé", config.contato, "e-mail ou telefone") +
      campo("whatsapp", "WhatsApp", config.whatsapp, "com DDD, só números") +
      campo("instagram", "Instagram", config.instagram, "sem o @") +
    '</div>' +
    '<div class="campos"><label>Texto sobre a organização <span class="dica">rodapé</span>' +
      '<textarea name="sobre" rows="3">' + esc(config.sobre || "") + '</textarea></label></div>' +
    '<div class="sub"><h4>Logotipo <span class="dica" style="text-transform:none">opcional</span></h4>' +
      '<p class="explica">Se você enviar uma imagem, ela substitui as iniciais no selo redondo. ' +
      'Use uma imagem quadrada; o corte é circular.</p>' +
      '<div class="campos" style="margin-top:10px">' +
        '<label>Enviar arquivo<input type="file" id="arquivo-logo" accept="image/*"></label></div>' +
      '<div id="previa-logo" style="margin-top:10px"></div>' +
    '</div>' +
    '<div class="acoes"><button class="btn" type="submit">Salvar identidade</button></div></form></div>';

  // Só a administração da plataforma: identidade do site, chave da casa e
  // equipe são globais, não pertencem a quem publica um evento.
  if (estado.organizador) html += '<div class="painel"><span class="eyebrow">Recebimento</span><h3 style="margin-top:4px">Dados do Pix</h3>' +
    '<p style="color:var(--tinta-media);font-size:.9rem;margin-top:6px">' +
      'A chave fica guardada no banco e não é exposta no site: só é usada para montar a cobrança ' +
      'de quem já tem inscrição pendente. Nome e cidade seguem o limite do padrão do Banco Central.</p>' +
    '<form id="form-config"><div class="campos duas">' +
      campo("organizacao", "Nome da organização", config.organizacao) +
      campo("chave_pix", "Chave Pix", config.chave_pix, "CPF, CNPJ, e-mail, telefone ou chave aleatória", "mono") +
      campo("beneficiario", "Nome do recebedor", config.beneficiario, "como está na conta", "", 25) +
      campo("cidade", "Cidade do recebedor", config.cidade, "máx. 15 caracteres", "", 15) +
    '</div><div class="acoes"><button class="btn" type="submit">Salvar dados do Pix</button></div></form></div>';

  html += '<div class="painel">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div><span class="eyebrow">Programação</span><h3 style="margin-top:4px">Eventos</h3></div>' +
      '<button class="btn" id="novo-evento">Novo evento</button></div>' +
    '<div style="margin-top:12px">' +
      (eventos.length ? eventos.map(linhaEvento).join("")
        : '<p style="color:var(--tinta-media);font-size:.9rem;padding:10px 0">Nenhum evento ainda.</p>') +
    '</div><div id="editor-evento"></div></div>';

  html += '<div class="painel">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div><span class="eyebrow">Lista</span><h3 style="margin-top:4px">Inscritos</h3></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (pagos.some(i => i.numero != null)
        ? '<button class="btn fantasma" data-peitos="1">Imprimir números de peito</button>' : "") +
      (inscritos.length ? '<button class="btn fantasma" id="exportar">Baixar planilha</button>' : "") +
      '</div>' +
    '</div>' + tabelaInscritos(inscritos) + '</div>';

  html += '<div class="painel"><span class="eyebrow">Prestação de contas</span>' +
    '<h3 style="margin-top:4px">Taxa de serviço</h3>' +
    '<p style="color:var(--tinta-media);font-size:.9rem;margin-top:6px">' +
      'Conta só inscrição paga — cancelada, pendente ou reembolsada não gera taxa. ' +
      'O dinheiro cai direto na conta do evento; a taxa é repassada à parte. ' +
      '<a href="/termos.html" target="_blank" rel="noopener">Ver os termos</a>.</p>' +
    '<div id="lista-extrato" style="margin-top:14px"><p class="carregando">Carregando…</p></div></div>';

  // Só a administração da plataforma: identidade do site, chave da casa e
  // equipe são globais, não pertencem a quem publica um evento.
  if (estado.organizador) html += '<div class="painel"><span class="eyebrow">Acesso</span>' +
    '<h3 style="margin-top:4px">Equipe da organização</h3>' +
    '<p style="color:var(--tinta-media);font-size:.9rem;margin-top:6px">' +
      'Quem está nesta lista enxerga o Painel e pode publicar eventos, ver os inscritos e ' +
      'confirmar pagamentos. Todo o resto do mundo vê só os eventos e as próprias inscrições.</p>' +
    '<div id="lista-equipe" style="margin-top:14px"><p class="carregando">Carregando…</p></div>' +
    '<form id="form-equipe"><div class="campos duas">' +
      '<label>E-mail de quem vai ajudar<input name="email" type="email" required ' +
        'placeholder="coordenador@exemplo.com"></label>' +
      '<div style="display:flex;align-items:flex-end"><button class="btn" type="submit">Dar acesso</button></div>' +
    '</div></form>' +
    '<p style="font-size:.83rem;color:var(--tinta-fraca);margin-top:10px">' +
      'A pessoa precisa ter entrado no site pelo menos uma vez, com esse mesmo e-mail — ' +
      'é só assim que a conta dela passa a existir.</p>' +
    '<div id="erro-equipe"></div></div>';

  $("#v-painel").innerHTML = html + '</div></div>';
  ligarPainel();
}

const numero = (v, r) => '<div class="numero"><b>' + esc(v) + '</b><span>' + r + '</span></div>';
function campo(nome, rotulo, valor, dica, classe, max) {
  return '<label>' + rotulo + (dica ? ' <span class="dica">' + dica + '</span>' : "") +
    '<input name="' + nome + '" value="' + esc(valor || "") + '"' +
    (classe ? ' class="' + classe + '"' : "") + (max ? ' maxlength="' + max + '"' : "") + '></label>';
}

function linhaEvento(ev) {
  const lotes = (ev.lotes || []).slice().sort((a, b) => a.ordem - b.ordem);
  const preco = lotes.length ? lotes[0].preco_centavos : 0;
  const percOcupacao = ev.vagas ? Math.min(100, Math.round(((ev.ocupadas || 0) / ev.vagas) * 100)) : null;

  return '<div class="linha-item"><div class="quem">' +
    '<b>' + esc(ev.nome) + (ev.publicado ? "" : ' <span class="tag pendente" style="margin-left:6px">rascunho</span>') +
      (ev.destaque ? ' <span class="tag espera">destaque</span>' : "") + '</b>' +
    '<small>' + esc(ev.categoria || "—") + " · " + esc(dataLonga(ev.data)) +
      (ev.hora ? " · " + hora(ev.hora) : "") + (cidadeUF(ev) ? " · " + esc(cidadeUF(ev)) : "") +
      " · a partir de " + (preco > 0 ? dinheiro(preco) : "gratuito") +
      " · " + lotes.length + " lote(s)" +
      (String(ev.edital || "").trim() ? " · com edital" : "") +
      (ev.resultados_publicados ? " · resultado publicado" : "") +
      (ev.vagas ? " · " + (ev.ocupadas || 0) + "/" + ev.vagas + " vagas (" + percOcupacao + "%)" : "") + '</small>' +
      (ev.vagas ? '<div class="barra-progresso"><div class="barra-progresso-fill" style="width:' + percOcupacao + '%"></div></div>' : '') +
    '</div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn fantasma pequeno" data-editar="' + ev.id + '">Editar</button>' +
      '<button class="btn fantasma pequeno" data-resultados-de="' + ev.id + '">Resultados</button>' +
      '<button class="btn fantasma pequeno" data-publicar="' + ev.id + '">' +
        (ev.publicado ? "Despublicar" : "Publicar") + '</button>' +
      '<button class="btn fantasma pequeno" data-abrir-fechar="' + ev.id + '">' +
        (ev.inscricoes_abertas ? "Encerrar inscrições" : "Reabrir") + '</button>' +
      '<button class="btn perigo pequeno" data-apagar="' + ev.id + '">Apagar</button>' +
    '</div></div>';
}

function tabelaInscritos(lista) {
  if (!lista.length)
    return '<div class="vazio" style="margin-top:14px"><h3>Ninguém se inscreveu ainda</h3>' +
      '<p>Publique um evento e divulgue o link do site.</p></div>';
  return '<div class="busca-tabela-caixa">' +
      '<input id="busca-inscritos" class="busca-tabela" placeholder="🔍 Filtrar por nome, número de peito, código, situação ou e-mail...">' +
    '</div>' +
    '<div class="rolagem" style="margin-top:6px"><table><thead><tr>' +
    '<th>Participante</th><th>Evento</th><th>Nº</th><th>Código</th><th>Valor</th><th>Situação</th><th>Kit</th><th></th>' +
    '</tr></thead><tbody id="tabela-inscritos-corpo">' + lista.map(i => {
      const ev = i.eventos || {};
      const respostas = Object.values(i.respostas || {}).join(" · ");
      return '<tr>' +
        '<td><span class="nome">' + esc(i.participante_nome) + '</span>' +
          (i.eh_titular ? "" : ' <span class="tag espera">dependente</span>') +
          '<br><span class="contato">' + esc(i.participante_email) +
          (i.participante_telefone ? " · " + esc(i.participante_telefone) : "") + '</span>' +
          (respostas ? '<br><span class="respostas">' + esc(respostas) + '</span>' : "") +
          (i.observacao ? '<br><span class="contato">“' + esc(i.observacao) + '”</span>' : "") + '</td>' +
        '<td>' + esc(ev.nome || "—") + '</td>' +
        '<td class="mono"><b style="font-size:1.15em">' +
          (i.numero == null ? "—"
            : formatarNumero(i.numero, (i.eventos || {}).numero_digitos)) + '</b></td>' +
        '<td class="mono">' + esc(i.codigo) + '</td>' +
        '<td class="mono">' + (i.valor_centavos > 0 ? dinheiro(i.valor_centavos) : "—") + '</td>' +
        '<td><span class="tag ' + classeStatus(i.status) + '">' + rotuloStatus(i.status) + '</span></td>' +
        '<td style="white-space:nowrap">' +
          (i.status !== "pago" ? '<span class="contato">—</span>'
            : i.kit_retirado
              ? '<span class="tag pago">entregue</span> ' +
                '<button class="btn fantasma pequeno" data-kit="' + i.id + '|nao">desfazer</button>'
              : '<button class="btn pequeno" data-kit="' + i.id + '|sim">Entregar kit</button>') +
        '</td>' +
        '<td style="white-space:nowrap">' +
          (i.numero != null && (i.eventos || {}).peito_ativo !== false
            ? '<button class="btn fantasma pequeno" data-peito="' + i.id + '">Nº de peito</button> ' : "") +
          (i.status === "espera" ? '<button class="btn pequeno" data-status="' + i.id + '|pendente">Chamar da fila</button> ' : "") +
          (i.status !== "pago" && i.status !== "espera" ? '<button class="btn fantasma pequeno" data-status="' + i.id + '|pago">Marcar pago</button> ' : "") +
          (i.status !== "cancelada" ? '<button class="btn perigo pequeno" data-status="' + i.id + '|cancelada">Cancelar</button>' : "") +
          (i.status === "cancelada" ? '<button class="btn fantasma pequeno" data-status="' + i.id + '|pendente">Reabrir</button> ' : "") +
          '<button class="btn perigo pequeno" data-apagar-inscricao="' + i.id + '" ' +
            'title="Tira do banco de vez. Cancelar apenas marca como cancelada.">Apagar</button>' +
        '</td></tr>';
    }).join("") + '</tbody></table></div>';
}

let edLogo = "";

/**
 * O botão que abre um editor fica no alto do painel, mas o editor é desenhado
 * depois da lista inteira — fora da tela. Sem isto, quem clica não vê nada
 * acontecer e conclui que o botão não funciona. Traz o formulário para a vista
 * e põe o cursor no primeiro campo.
 */
function trazerParaAVista(caixa, seletorFoco) {
  caixa.scrollIntoView({ behavior: "smooth", block: "start" });
  const primeiro = seletorFoco && caixa.querySelector(seletorFoco);
  if (primeiro) primeiro.focus({ preventScroll: true });
}

function ligarPainel() {
  edLogo = estado.painel.config.logo_url || "";
  const previaLogo = () => {
    const caixaLogo = $("#previa-logo");
    if (!caixaLogo) return;
    caixaLogo.innerHTML = edLogo
      ? '<img src="' + esc(edLogo) + '" alt="Prévia do logotipo" ' +
        'style="width:72px;height:72px;object-fit:cover;border-radius:50%;border:1px solid var(--borda)">' +
        '<div class="acoes" style="margin-top:8px"><button type="button" class="btn perigo pequeno" id="tirar-logo">Voltar às iniciais</button></div>'
      : '<p class="mini-vazio">Sem logotipo: o selo mostra as iniciais.</p>';
  };
  previaLogo();

  const caixaPreviaLogo = $("#previa-logo");
  if (caixaPreviaLogo) caixaPreviaLogo.addEventListener("click", e => {
    if (e.target.id === "tirar-logo") { edLogo = ""; previaLogo(); }
  });
  const arquivoLogo = $("#arquivo-logo");
  if (arquivoLogo) arquivoLogo.addEventListener("change", async e => {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    if (arq.size > 2 * 1024 * 1024) { torrar("Imagem grande demais — use até 2 MB"); return; }
    $("#previa-logo").innerHTML = '<p class="carregando">Enviando…</p>';
    try { edLogo = await api.enviarCapa(arq); torrar("Logotipo enviado"); }
    catch (err) { torrar(mensagemDe(err)); }
    previaLogo();
  });

  // os dois campos de cor andam juntos
  const cor = $("#cor-acento"), corTexto = $("#cor-acento-texto");
  const valida = v => /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(v);
  cor.addEventListener("input", () => {
    corTexto.value = cor.value.toUpperCase();
    document.documentElement.style.setProperty("--acento", cor.value);
    document.documentElement.style.setProperty("--sobre-acento", tintaSobre(cor.value));
  });
  corTexto.addEventListener("input", () => {
    if (!valida(corTexto.value)) return;
    cor.value = corTexto.value;
    document.documentElement.style.setProperty("--acento", corTexto.value);
    document.documentElement.style.setProperty("--sobre-acento", tintaSobre(corTexto.value));
  });

  const formIdentidade = $("#form-identidade");
  if (formIdentidade) formIdentidade.addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const corEscolhida = String(f.get("cor_acento_texto") || f.get("cor_acento") || "").trim().toUpperCase();
    if (!valida(corEscolhida)) { torrar("Cor inválida — use o formato #RRGGBB"); return; }
    try {
      await api.salvarConfiguracao({
        sigla: String(f.get("sigla") || "AP").trim().toUpperCase().slice(0, 3) || "AP",
        nome_site: String(f.get("nome_site") || "").trim() || "Alta-Pista",
        subtitulo: String(f.get("subtitulo") || "").trim(),
        cor_acento: corEscolhida,
        contato: String(f.get("contato") || "").trim(),
        whatsapp: String(f.get("whatsapp") || "").trim(),
        instagram: String(f.get("instagram") || "").trim().replace(/^@/, ""),
        sobre: String(f.get("sobre") || "").trim(),
        logo_url: edLogo
      });
      aplicarIdentidade(await api.identidade());
      torrar("Identidade salva");
      await telaPainel();
    } catch (err) { torrar(mensagemDe(err)); }
  });

  const formConfig = $("#form-config");
  if (formConfig) formConfig.addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api.salvarConfiguracao({
        organizacao: String(f.get("organizacao") || "").trim(),
        chave_pix: String(f.get("chave_pix") || "").trim(),
        beneficiario: String(f.get("beneficiario") || "").trim(),
        cidade: String(f.get("cidade") || "").trim()
      });
      aplicarIdentidade(await api.identidade());
      torrar("Dados do Pix salvos");
      await telaPainel();
    } catch (err) { torrar(mensagemDe(err)); }
  });
  $("#novo-evento").addEventListener("click", () => editorEvento(null));
  const bx = $("#exportar");
  if (bx) bx.addEventListener("click", exportar);
  desenharExtrato();
  ligarEquipe();
}

async function desenharExtrato() {
  const alvo = $("#lista-extrato");
  if (!alvo) return;
  let linhas = [];
  try { linhas = await api.extratoTaxas(); }
  catch (e) { alvo.innerHTML = '<div class="erro">' + esc(mensagemDe(e)) + '</div>'; return; }

  if (!linhas.length) {
    alvo.innerHTML = '<p style="color:var(--tinta-fraca);font-size:.9rem">' +
      'Nada ainda. Assim que a primeira inscrição for confirmada, ela aparece aqui.</p>';
    return;
  }

  const soma = campo => linhas.reduce((t, l) => t + (Number(l[campo]) || 0), 0);
  const totalPagas = linhas.reduce((t, l) => t + (Number(l.pagas) || 0), 0);

  alvo.innerHTML =
    '<div class="rolagem"><table><thead><tr>' +
      '<th>Evento</th><th>Pagas</th><th>Arrecadado</th><th>Taxa devida</th><th>Fica com você</th>' +
    '</tr></thead><tbody>' +
    linhas.map(l =>
      '<tr><td>' + esc(l.nome) + (l.data ? ' <small>' + esc(dataBR(String(l.data))) + '</small>' : "") + '</td>' +
        '<td class="mono">' + (l.pagas || 0) + '</td>' +
        '<td class="mono">' + dinheiro(l.arrecadado || 0) + '</td>' +
        '<td class="mono">' + dinheiro(l.taxa_devida || 0) + '</td>' +
        '<td class="mono">' + dinheiro(l.liquido || 0) + '</td></tr>').join("") +
    '</tbody><tfoot><tr>' +
      '<td><b>Total</b></td>' +
      '<td class="mono"><b>' + totalPagas + '</b></td>' +
      '<td class="mono"><b>' + dinheiro(soma("arrecadado")) + '</b></td>' +
      '<td class="mono"><b>' + dinheiro(soma("taxa_devida")) + '</b></td>' +
      '<td class="mono"><b>' + dinheiro(soma("liquido")) + '</b></td>' +
    '</tr></tfoot></table></div>';
}

async function desenharEquipe() {
  const alvo = $("#lista-equipe");
  if (!alvo) return;
  let equipe = [];
  try { equipe = await api.listarOrganizadores(); }
  catch (e) { alvo.innerHTML = '<div class="erro">' + esc(mensagemDe(e)) + '</div>'; return; }

  alvo.innerHTML = equipe.map(p =>
    '<div class="linha-item"><div class="quem">' +
      '<b>' + esc(p.nome || p.email) + (p.sou_eu ? ' <span class="tag pago">você</span>' : "") + '</b>' +
      '<small>' + esc(p.email) + ' · desde ' + dataBR(String(p.desde).slice(0, 10)) + '</small>' +
    '</div>' +
    (p.sou_eu ? '' : '<button class="btn perigo pequeno" data-tirar-acesso="' + esc(p.user_id) +
      '" data-quem="' + esc(p.email) + '">Tirar acesso</button>') +
    '</div>').join("");
}

function ligarEquipe() {
  desenharEquipe();
  const f = $("#form-equipe");
  if (!f) return;
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const email = String(new FormData(e.target).get("email") || "").trim();
    const botao = e.target.querySelector("button[type=submit]");
    botao.disabled = true; botao.textContent = "Dando acesso…";
    try {
      await api.promoverOrganizador(email);
      torrar(email + " agora tem acesso ao Painel");
      e.target.reset();
      $("#erro-equipe").innerHTML = "";
      await desenharEquipe();
    } catch (err) {
      $("#erro-equipe").innerHTML = '<div class="erro">' + esc(mensagemDe(err)) + '</div>';
    }
    botao.disabled = false; botao.textContent = "Dar acesso";
  });
}

/* ------------------------------------------------- editor de evento ---- */

function linhaLoteHTML(l, i) {
  return '<div class="mini-linha lote">' +
    '<label>Nome do lote<input data-lote="' + i + '" data-k="nome" value="' + esc(l.nome || "") + '" placeholder="1º lote"></label>' +
    '<label>Valor R$<input data-lote="' + i + '" data-k="preco_centavos" type="number" min="0" step="0.01" value="' +
      ((l.preco_centavos || 0) / 100).toFixed(2) + '"></label>' +
    '<label>Vende até <span class="dica">opcional</span><input data-lote="' + i + '" data-k="vende_ate" type="date" value="' +
      esc(l.vende_ate || "") + '"></label>' +
    '<label>Quantidade <span class="dica">0 = livre</span><input data-lote="' + i + '" data-k="quantidade" type="number" min="0" step="1" value="' +
      (l.quantidade || 0) + '"></label>' +
    '<button type="button" class="btn perigo pequeno" data-del-lote="' + i + '">Remover</button></div>';
}
function linhaPerguntaHTML(c, i) {
  const tipos = [["texto", "Texto livre"], ["opcoes", "Lista de opções"], ["cpf", "CPF"], ["data", "Data"]];
  return '<div class="mini-linha campo">' +
    '<label>Pergunta<input data-pergunta="' + i + '" data-k="rotulo" value="' + esc(c.rotulo || "") + '" placeholder="Tamanho da camiseta"></label>' +
    '<label>Tipo<select data-pergunta="' + i + '" data-k="tipo">' +
      tipos.map(t => '<option value="' + t[0] + '"' + (c.tipo === t[0] ? " selected" : "") + '>' + t[1] + '</option>').join("") +
    '</select></label>' +
    '<label>' + (c.tipo === "opcoes" ? "Opções separadas por vírgula" : "Texto de exemplo") +
      '<input data-pergunta="' + i + '" data-k="opcoes" value="' + esc(c.opcoes || "") + '" placeholder="' +
      (c.tipo === "opcoes" ? "P, M, G, GG" : "opcional") + '"></label>' +
    '<label class="caixinha"><input type="checkbox" data-pergunta="' + i + '" data-k="obrigatorio"' +
      (c.obrigatorio ? " checked" : "") + '>Obrigatório</label>' +
    '<button type="button" class="btn perigo pequeno" data-del-pergunta="' + i + '">Remover</button></div>';
}
const desenharLotes = () => {
  $("#lista-lotes").innerHTML = edLotes.length ? edLotes.map(linhaLoteHTML).join("")
    : '<p class="mini-vazio">Adicione ao menos um lote para definir o preço.</p>';
};
const desenharPerguntas = () => {
  $("#lista-perguntas").innerHTML = edPerguntas.length ? edPerguntas.map(linhaPerguntaHTML).join("")
    : '<p class="mini-vazio">Nenhuma pergunta extra além de nome, nascimento, e-mail e telefone.</p>';
};
/**
 * Prévia ao vivo do número de peito, com um corredor inventado. Redesenha
 * a cada tecla, para o organizador ver a cor e os algarismos sem precisar
 * salvar o evento e imprimir para descobrir que ficou torto.
 */
const desenharPreviaPeito = () => {
  const alvo = $("#previa-peito");
  if (!alvo) return;
  const f = $("#form-evento");
  const ler = n => (f && f.elements[n] ? f.elements[n].value : "");
  const cor = String(ler("peito_cor") || "").trim();
  alvo.innerHTML = folhaDePeito({
    numero: 7,
    digitos: parseInt(ler("numero_digitos"), 10) || 0,
    nome: "Nome do participante",
    codigo: "ABC-123",
    evento: ler("nome") || "Nome do evento",
    data: ler("data") ? dataLonga(ler("data")) : "",
    local: [ler("cidade"), ler("uf")].filter(Boolean).join("/"),
    distancia: String(ler("distancias") || "").split(",")[0].trim(),
    camisa: "G",
    sigla: (estado.identidade || {}).sigla || "",
    marca: (estado.identidade || {}).nome_site || "",
    cor: /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : ((estado.identidade || {}).cor_acento || "#0B1B2B"),
    logoUrl: edPeitoLogo,
    fundoUrl: edPeitoFundo
  });
  const svg = alvo.querySelector("svg");
  if (svg) { svg.style.width = "100%"; svg.style.height = "auto"; svg.style.background = "#fff"; }
};

const desenharCapa = () => {
  $("#previa-capa").innerHTML = edCapa
    ? '<img class="previa-capa" src="' + esc(edCapa) + '" alt="Prévia da capa">' +
      '<div class="acoes" style="margin-top:8px"><button type="button" class="btn perigo pequeno" id="tirar-capa">Remover capa</button></div>'
    : '<p class="mini-vazio">Sem capa: o cartão mostra as iniciais do evento sobre um fundo azul-noite.</p>';
};

/** addEventListener que não explode quando o elemento não existe. */
function aoEvento(seletor, tipo, fn, opcoes) {
  const alvo = typeof seletor === "string" ? $(seletor) : seletor;
  if (alvo) alvo.addEventListener(tipo, fn, opcoes);
  return alvo;
}

function editorEvento(id) {
  const ev = id ? estado.painel.eventos.find(e => e.id === id) : null;
  const v = ev || {
    nome: "", descricao: "", edital: "", data: "", hora: "07:00", local: "",
    categoria: "Corrida de rua", cidade: "", uf: "", distancias: "", imagem_url: "",
    vagas: 0, numero_inicial: 1, numero_digitos: 4, peito_cor: "",
    peito_logo_url: "", peito_fundo_url: "", peito_pronto_url: "", peito_ativo: true,
    espera_ativa: true, inscricoes_abertas: true,
    publicado: false, destaque: false,
    chave_pix: "", recebedor_nome: "", recebedor_cidade: ""
  };
  edEventoId = id;
  edCapa = v.imagem_url || "";
  edPeitoLogo = v.peito_logo_url || "";
  edPeitoFundo = v.peito_fundo_url || "";
  edPeitoPronto = v.peito_pronto_url || "";
  edLotes = (ev ? (ev.lotes || []).slice().sort((a, b) => a.ordem - b.ordem) : [])
    .map(l => Object.assign({}, l));
  if (!edLotes.length) edLotes = [{ nome: "Lote único", preco_centavos: 0, vende_ate: "", quantidade: 0 }];
  edPerguntas = (ev ? (ev.perguntas || []).slice().sort((a, b) => a.ordem - b.ordem) : [])
    .map(p => Object.assign({}, p));

  const antigo = $("#editor-evento");
  antigo.replaceWith(antigo.cloneNode(false));
  const caixa = $("#editor-evento");

  caixa.innerHTML =
    '<form id="form-evento" novalidate ' +
      'style="margin-top:20px;border-top:1px solid var(--borda);padding-top:20px">' +
      '<h3>' + (ev ? "Editar evento" : "Novo evento") + '</h3>' +
      '<div class="campos duas">' +
        '<label>Nome do evento<input name="nome" required value="' + esc(v.nome) + '"></label>' +
        '<label>Modalidade<select name="categoria">' +
          MODALIDADES.map(m => '<option' + (v.categoria === m ? " selected" : "") + '>' + m + '</option>').join("") +
        '</select></label>' +
        '<label>Local<input name="local" value="' + esc(v.local) + '" placeholder="Ponto de largada, endereço"></label>' +
        '<label>Percursos <span class="dica">separados por vírgula</span>' +
          '<input name="distancias" value="' + esc(v.distancias) + '" placeholder="3 km, 5 km, 10 km"></label>' +
        '<label>Cidade<input name="cidade" value="' + esc(v.cidade) + '"></label>' +
        '<label>UF<input name="uf" value="' + esc(v.uf) + '" maxlength="2" placeholder="PB"></label>' +
        '<label>Data<input name="data" type="date" value="' + esc(v.data || "") + '"></label>' +
        '<label>Horário<input name="hora" type="time" value="' + esc(hora(v.hora) || "") + '"></label>' +
        '<label>Vagas <span class="dica">0 para ilimitado</span>' +
          '<input name="vagas" type="number" inputmode="numeric" step="1" value="' + (v.vagas || 0) + '"></label>' +
        '<label>Numeração começa em <span class="dica">o nº de peito do primeiro pagante</span>' +
          '<input name="numero_inicial" type="number" inputmode="numeric" step="1" value="' +
          (v.numero_inicial || 1) + '"></label>' +
        '<div style="display:flex;flex-direction:column;gap:8px;justify-content:flex-end;padding-bottom:4px">' +
          '<label class="caixinha"><input type="checkbox" name="espera_ativa"' +
            (v.espera_ativa ? " checked" : "") + '>Abrir lista de espera quando lotar</label>' +
          '<label class="caixinha"><input type="checkbox" name="destaque"' +
            (v.destaque ? " checked" : "") + '>Mostrar em destaque na abertura</label>' +
        '</div>' +
      '</div>' +

      '<div class="sub"><h4>Imagem de capa</h4>' +
        '<p class="explica">Aparece no cartão e na faixa de destaque. Use uma foto larga (16:9), ' +
        'até uns 2 MB. Ela fica pública, como a capa de qualquer evento.</p>' +
        '<div class="campos" style="margin-top:10px">' +
          '<label>Enviar arquivo<input type="file" id="arquivo-capa" accept="image/*"></label>' +
        '</div>' +
        '<div id="previa-capa" style="margin-top:10px"></div>' +
      '</div>' +

      '<div class="sub"><h4>Número de peito</h4>' +
        '<label class="caixinha"><input type="checkbox" name="peito_ativo" id="usa-peito"' +
          (v.peito_ativo === false ? "" : " checked") + '>Este evento usa número de peito</label>' +
        '<p class="explica">Desmarque para eventos sem numeração — caminhada, aula aberta, ' +
        'passeio. Sem ela o site não desenha a folha, não oferece a impressão e não mostra ' +
        'número na lista de inscritos.</p>' +

        '<div id="bloco-peito">' +
        '<p class="explica" style="margin-top:14px">É a folha que o corredor prende na camisa, ' +
        'em A5 deitado. Deixe a cor em branco para usar a do site. A arte de fundo cobre a folha ' +
        'inteira e recebe um véu claro por cima, para o número continuar legível de longe.</p>' +
        '<div class="campos duas" style="margin-top:10px">' +
          '<label>Algarismos <span class="dica">4 faz o corredor 7 virar 0007; 0 mostra o número cru</span>' +
            '<input name="numero_digitos" type="number" inputmode="numeric" step="1" value="' +
            (v.numero_digitos == null ? 4 : v.numero_digitos) + '"></label>' +
          '<label>Cor do evento <span class="dica">vazio = a cor do site</span>' +
            '<input name="peito_cor" type="text" value="' + esc(v.peito_cor || "") + '" ' +
            'placeholder="#C6F24E" class="mono" maxlength="7"></label>' +
          '<label>Logotipo do evento<input type="file" id="arquivo-peito-logo" accept="image/*"></label>' +
          '<label>Arte de fundo<input type="file" id="arquivo-peito-fundo" accept="image/*"></label>' +
        '</div>' +
        '<div class="acoes" style="margin-top:8px">' +
          '<button type="button" class="btn fantasma pequeno" id="tirar-peito-logo">Remover logotipo</button> ' +
          '<button type="button" class="btn fantasma pequeno" id="tirar-peito-fundo">Remover arte</button>' +
        '</div>' +
        '<div id="previa-peito" style="margin-top:12px;max-width:560px"></div>' +

        '<div style="margin-top:18px;border-top:1px solid var(--borda);padding-top:14px">' +
          '<h4 style="font-size:.95rem">Ou use um peito já pronto</h4>' +
          '<p class="explica">Se a arte do peito já vem fechada da gráfica ou do patrocinador, ' +
          'envie-a aqui: a impressão passa a usar essa imagem inteira, no lugar do desenho acima. ' +
          'Use A5 deitado (proporção 3 por 2) para não sair esticada.</p>' +
          '<div class="campos" style="margin-top:10px">' +
            '<label>Enviar a arte pronta<input type="file" id="arquivo-peito-pronto" accept="image/*"></label>' +
          '</div>' +
          '<div id="previa-peito-pronto" style="margin-top:10px"></div>' +
        '</div>' +
        '</div>' +
      '</div>' +

      '<div class="campos"><label>Resumo curto<textarea name="descricao" placeholder="Uma linha que aparece no cartão do evento">' +
        esc(v.descricao) + '</textarea></label></div>' +
      '<div class="campos"><label>Edital do evento ' +
        '<span class="dica">use ## para títulos, - para listas e **negrito**</span>' +
        '<textarea name="edital" rows="12" placeholder="## Percurso&#10;- 3 km, 5 km e 10 km&#10;&#10;## Categorias&#10;...">' +
        esc(v.edital) + '</textarea></label></div>' +

      '<div class="sub"><h4>Lotes de preço</h4>' +
        '<p class="explica">Vale o primeiro lote que ainda não venceu nem esgotou. ' +
        'Quem decide isso na hora da inscrição é o banco, não o navegador.</p>' +
        '<div class="mini-lista" id="lista-lotes"></div>' +
        '<div class="acoes" style="margin-top:12px"><button type="button" class="btn fantasma pequeno" id="add-lote">Adicionar lote</button></div>' +
      '</div>' +

      '<div class="sub"><h4>Recebimento deste evento</h4>' +
        '<p class="explica">O Pix cai <b>direto na sua conta</b> — a plataforma não ' +
        'toca no dinheiro em momento nenhum. Deixando em branco, o evento usa a chave ' +
        'geral do site.' +
        (estado.taxa > 0
          ? ' Sobre cada inscrição paga, o participante paga <b>' + dinheiro(estado.taxa) +
            '</b> a mais de taxa de serviço, que entra na sua conta junto e você ' +
            'repassa à plataforma. Evento gratuito não tem taxa.'
          : '') +
        ' <a href="/termos.html" target="_blank" rel="noopener">Ver os termos</a>.</p>' +
        '<div class="campos duas" style="margin-top:12px">' +
          '<label>Chave Pix<input name="chave_pix" class="mono" value="' + esc(v.chave_pix || "") +
            '" placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"></label>' +
          '<label>Nome do recebedor <span class="dica">como está na conta</span>' +
            '<input name="recebedor_nome" maxlength="25" value="' + esc(v.recebedor_nome || "") + '"></label>' +
          '<label>Cidade do recebedor <span class="dica">máx. 15 caracteres</span>' +
            '<input name="recebedor_cidade" maxlength="15" value="' + esc(v.recebedor_cidade || "") + '"></label>' +
        '</div>' +
      '</div>' +

      '<div class="sub"><h4>Perguntas do formulário</h4>' +
        '<p class="explica">O CPF é conferido pelo dígito verificador. Peça só o que a prova realmente precisa.</p>' +
        '<div class="mini-lista" id="lista-perguntas"></div>' +
        '<div class="acoes" style="margin-top:12px">' +
          '<button type="button" class="btn fantasma pequeno" id="add-pergunta">Adicionar pergunta</button>' +
          '<button type="button" class="btn fantasma pequeno" id="perguntas-corrida">Usar o conjunto de corrida</button>' +
        '</div>' +
      '</div>' +

      '<div class="acoes">' +
        '<button class="btn" type="submit">' + (ev ? "Salvar alterações" : "Criar evento") + '</button>' +
        '<button class="btn fantasma" type="button" id="cancelar-evento">Cancelar</button>' +
        (ev ? "" : '<span style="font-size:.83rem;color:var(--tinta-fraca)">' +
          'O evento nasce como rascunho: só aparece no site depois que você publicar.</span>') +
      '</div><div id="erro-evento"></div>' +
    '</form>';

  desenharLotes();
  desenharPerguntas();
  desenharCapa();
  desenharPreviaPeito();
  caixa.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const sincronizar = e => {
    const t = e.target, k = t.dataset.k;
    if (!k) return;
    if (t.dataset.lote != null) {
      const l = edLotes[+t.dataset.lote];
      if (!l) return;
      l[k] = k === "preco_centavos" ? Math.round(parseFloat(t.value || "0") * 100) || 0
        : k === "quantidade" ? parseInt(t.value || "0", 10) || 0 : t.value;
    }
    if (t.dataset.pergunta != null) {
      const p = edPerguntas[+t.dataset.pergunta];
      if (!p) return;
      p[k] = k === "obrigatorio" ? t.checked : t.value;
      if (k === "tipo") desenharPerguntas();
    }
  };
  caixa.addEventListener("input", sincronizar);
  caixa.addEventListener("change", sincronizar);
  caixa.addEventListener("input", desenharPreviaPeito);
  caixa.addEventListener("change", desenharPreviaPeito);

  caixa.addEventListener("click", e => {
    const b = e.target.closest("[data-del-lote],[data-del-pergunta],#tirar-capa," +
      "#tirar-peito-logo,#tirar-peito-fundo");
    if (!b) return;
    if (b.id === "tirar-capa") { edCapa = ""; return desenharCapa(); }
    if (b.id === "tirar-peito-logo") { edPeitoLogo = ""; return desenharPreviaPeito(); }
    if (b.id === "tirar-peito-fundo") { edPeitoFundo = ""; return desenharPreviaPeito(); }
    if (b.dataset.delLote != null) { edLotes.splice(+b.dataset.delLote, 1); desenharLotes(); }
    else { edPerguntas.splice(+b.dataset.delPergunta, 1); desenharPerguntas(); }
  });

  const enviarImagemDoPeito = async (input, guardar) => {
    const arq = input.files && input.files[0];
    if (!arq) return;
    if (arq.size > 5 * 1024 * 1024) { torrar("Imagem grande demais — use até 5 MB"); return; }
    try { guardar(await api.enviarCapa(arq)); torrar("Imagem enviada"); }
    catch (err) { torrar(mensagemDe(err)); }
    desenharPreviaPeito();
  };
  aoEvento("#arquivo-peito-logo", "change", e =>
    enviarImagemDoPeito(e.target, u => { edPeitoLogo = u; }));
  aoEvento("#arquivo-peito-fundo", "change", e =>
    enviarImagemDoPeito(e.target, u => { edPeitoFundo = u; }));

  const previaPeitoPronto = () => {
    const alvo = $("#previa-peito-pronto");
    if (!alvo) return;
    alvo.innerHTML = edPeitoPronto
      ? '<img src="' + esc(edPeitoPronto) + '" alt="Prévia do peito pronto" ' +
        'style="max-width:100%;border:1px solid var(--borda);border-radius:var(--r)">' +
        '<div class="acoes" style="margin-top:8px">' +
        '<button type="button" class="btn perigo pequeno" id="tirar-peito-pronto">Remover a arte pronta</button>' +
        '</div>'
      : '';
  };
  previaPeitoPronto();

  aoEvento("#arquivo-peito-pronto", "change", e =>
    enviarImagemDoPeito(e.target, u => { edPeitoPronto = u; previaPeitoPronto(); }));

  aoEvento("#previa-peito-pronto", "click", e => {
    if (e.target.id !== "tirar-peito-pronto") return;
    edPeitoPronto = "";
    previaPeitoPronto();
  });

  // Desligar o número de peito esconde tudo o que só serve a ele — inclusive
  // a arte pronta, que sem numeração não tem para onde ir.
  const usaPeito = $("#usa-peito");
  const blocoPeito = $("#bloco-peito");
  const sincronizarPeito = () => { if (blocoPeito) blocoPeito.hidden = !usaPeito.checked; };
  if (usaPeito && blocoPeito) {
    sincronizarPeito();
    usaPeito.addEventListener("change", sincronizarPeito);
  }

  aoEvento("#arquivo-capa", "change", async e => {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    if (arq.size > 5 * 1024 * 1024) { torrar("Imagem grande demais — use até 5 MB"); return; }
    $("#previa-capa").innerHTML = '<p class="carregando">Enviando imagem…</p>';
    try { edCapa = await api.enviarCapa(arq); torrar("Capa enviada"); }
    catch (err) { torrar(mensagemDe(err)); }
    desenharCapa();
  });

  $("#add-lote").addEventListener("click", () => {
    const ult = edLotes[edLotes.length - 1];
    edLotes.push({
      nome: (edLotes.length + 1) + "º lote",
      preco_centavos: ult ? ult.preco_centavos : 0, vende_ate: "", quantidade: 0
    });
    desenharLotes();
  });
  $("#add-pergunta").addEventListener("click", () => {
    edPerguntas.push({ rotulo: "", tipo: "texto", opcoes: "", obrigatorio: false });
    desenharPerguntas();
  });
  $("#perguntas-corrida").addEventListener("click", () => {
    const tem = r => edPerguntas.some(p => (p.rotulo || "").toLowerCase() === r.toLowerCase());
    for (const s of [
      { rotulo: "Percurso", tipo: "opcoes", opcoes: "3 km, 5 km, 10 km", obrigatorio: true },
      { rotulo: "Tamanho da camiseta", tipo: "opcoes", opcoes: "PP, P, M, G, GG", obrigatorio: true },
      { rotulo: "Sexo (para a categoria)", tipo: "opcoes", opcoes: "Feminino, Masculino", obrigatorio: true },
      { rotulo: "Equipe ou assessoria", tipo: "texto", opcoes: "deixe em branco se corre sozinho", obrigatorio: false },
      { rotulo: "Contato de emergência", tipo: "texto", opcoes: "Nome e telefone", obrigatorio: true },
      { rotulo: "Vínculo com a escola", tipo: "opcoes", opcoes: "Aluno, Responsável, Servidor, Comunidade", obrigatorio: false }
    ]) if (!tem(s.rotulo)) edPerguntas.push(s);
    desenharPerguntas();
    torrar("Perguntas de corrida adicionadas");
  });

  $("#cancelar-evento").addEventListener("click", () => { caixa.innerHTML = ""; });

  aoEvento("#form-evento", "submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const lotes = edLotes.filter(l => String(l.nome || "").trim());
    if (!lotes.length) {
      $("#erro-evento").innerHTML = '<div class="erro">Defina pelo menos um lote de preço.</div>';
      return;
    }
    const nome = String(f.get("nome") || "").trim();
    if (!nome) {
      $("#erro-evento").innerHTML = '<div class="erro">Dê um nome ao evento.</div>';
      const campoNome = e.target.querySelector('[name="nome"]');
      if (campoNome) { campoNome.scrollIntoView({ block: "center" }); campoNome.focus(); }
      return;
    }
    try {
      await api.salvarEvento({
        id: edEventoId || undefined,
        slug: ev ? ev.slug : gerarSlug(nome),
        nome,
        categoria: String(f.get("categoria") || "").trim(),
        local: String(f.get("local") || "").trim(),
        cidade: String(f.get("cidade") || "").trim(),
        uf: String(f.get("uf") || "").trim().toUpperCase(),
        distancias: String(f.get("distancias") || "").trim(),
        imagem_url: edCapa,
        data: f.get("data") || null,
        hora: f.get("hora") || null,
        vagas: parseInt(f.get("vagas") || "0", 10) || 0,
        numero_inicial: Math.max(1, parseInt(f.get("numero_inicial") || "1", 10) || 1),
        numero_digitos: Math.min(6, Math.max(0, parseInt(f.get("numero_digitos") || "0", 10) || 0)),
        peito_cor: (() => {
          const c = String(f.get("peito_cor") || "").trim();
          return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : "";
        })(),
        peito_logo_url: edPeitoLogo,
        peito_fundo_url: edPeitoFundo,
        peito_pronto_url: edPeitoPronto,
        peito_ativo: !!f.get("peito_ativo"),
        espera_ativa: f.get("espera_ativa") === "on",
        destaque: f.get("destaque") === "on",
        descricao: String(f.get("descricao") || "").trim(),
        edital: String(f.get("edital") || "").trim(),
        chave_pix: String(f.get("chave_pix") || "").trim(),
        recebedor_nome: String(f.get("recebedor_nome") || "").trim(),
        recebedor_cidade: String(f.get("recebedor_cidade") || "").trim(),
        lotes,
        perguntas: edPerguntas.filter(p => String(p.rotulo || "").trim())
      });
      torrar(ev ? "Evento atualizado" : "Evento criado como rascunho");
      await telaPainel();
    } catch (err) {
      $("#erro-evento").innerHTML = '<div class="erro">' + esc(mensagemDe(err)) + '</div>';
    }
  });

  /* O navegador recusa o envio de um formulário inválido sem dizer nada útil:
     ele desenha um balãozinho no campo e para por aí. Se o campo estiver fora
     da tela — e neste formulário, longo, quase sempre está — quem clicou em
     salvar conclui que o botão não funciona. Aqui o erro vira texto em
     português, junto do botão, e a tela desce até o campo. */
  aoEvento("#form-evento", "invalid", evento => {
    const campo = evento.target;
    const rotulo = campo.closest("label");
    const nome = rotulo
      ? (rotulo.childNodes[0].textContent || "").trim().replace(/\s+/g, " ")
      : (campo.name || "este campo");
    $("#erro-evento").innerHTML = '<div class="erro">Confira <b>' + esc(nome) + '</b>: ' +
      esc(campo.validationMessage || "valor inválido") + '</div>';
    campo.scrollIntoView({ behavior: "smooth", block: "center" });
    try { campo.focus({ preventScroll: true }); } catch (e) { /* campo escondido */ }
  }, true);   // captura: o evento "invalid" não sobe pela árvore

  trazerParaAVista(caixa, 'input[name="nome"]');
}

/* ---------------------------------------------- resultados no painel --- */

async function editorResultados(eventoId) {
  const ev = estado.painel.eventos.find(e => e.id === eventoId);
  if (!ev) return;
  let atuais = [];
  try { atuais = await api.resultadosDoEvento(eventoId); } catch (e) { atuais = []; }

  const antigo = $("#editor-evento");
  antigo.replaceWith(antigo.cloneNode(false));
  const caixa = $("#editor-evento");

  caixa.innerHTML =
    '<div style="margin-top:20px;border-top:1px solid var(--borda);padding-top:20px">' +
      '<h3>Resultados · ' + esc(ev.nome) + '</h3>' +
      '<p class="explica" style="margin-top:6px">Cole a apuração, uma linha por atleta, com os campos ' +
      'separados por <b>ponto e vírgula</b> ou <b>tabulação</b> — é o que sai da planilha da cronometragem. ' +
      'A ordem das colunas é: posição; atleta; equipe; categoria; percurso; tempo. ' +
      'Colunas do fim podem faltar.</p>' +
      '<div class="campos" style="margin-top:12px"><label>Classificação' +
        '<textarea id="texto-resultados" rows="12" placeholder="1;Maria Souza;Equipe Alfa;F30-34;10 km;00:42:11&#10;2;João Lima;;M35-39;10 km;00:43:05">' +
        atuais.map(l => [l.posicao, l.atleta, l.equipe, l.categoria, l.percurso, l.tempo]
          .join(";").replace(/;+$/, "")).join("\n") + '</textarea></label></div>' +
      '<div id="previa-resultados"></div>' +
      '<div class="acoes">' +
        '<button class="btn" id="salvar-resultados">Salvar classificação</button>' +
        '<label class="caixinha"><input type="checkbox" id="publicar-resultados"' +
          (ev.resultados_publicados ? " checked" : "") + '>Publicar no site</label>' +
        '<button class="btn fantasma" id="fechar-resultados">Fechar</button>' +
      '</div>' +
      (atuais.length ? '<p style="font-size:.82rem;color:var(--tinta-fraca);margin-top:8px">' +
        atuais.length + ' linhas já salvas. Salvar substitui a classificação inteira.</p>' : "") +
    '</div>';

  caixa.scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("#fechar-resultados").addEventListener("click", () => { caixa.innerHTML = ""; });

  $("#salvar-resultados").addEventListener("click", async () => {
    const linhas = analisarResultados($("#texto-resultados").value);
    if (!linhas.length && !confirm("Nenhuma linha reconhecida. Apagar a classificação atual?")) return;
    const botao = $("#salvar-resultados");
    botao.disabled = true; botao.textContent = "Salvando…";
    try {
      await api.substituirResultados(eventoId, linhas);
      await api.salvarEvento({
        id: eventoId,
        resultados_publicados: $("#publicar-resultados").checked,
        lotes: (ev.lotes || []).slice().sort((a, b) => a.ordem - b.ordem),
        perguntas: (ev.perguntas || []).slice().sort((a, b) => a.ordem - b.ordem)
      });
      torrar(linhas.length + " classificados salvos");
      await telaPainel();
    } catch (err) {
      $("#previa-resultados").innerHTML = '<div class="erro">' + esc(mensagemDe(err)) + '</div>';
      botao.disabled = false; botao.textContent = "Salvar classificação";
    }
  });

  trazerParaAVista(caixa, "#texto-resultados");
}

/** Lê a colagem da planilha: posição; atleta; equipe; categoria; percurso; tempo. */
function analisarResultados(texto) {
  const linhas = [];
  for (const bruta of String(texto || "").split(/\r?\n/)) {
    const l = bruta.trim();
    if (!l) continue;
    const col = l.split(/\t|;/).map(c => c.trim());
    // pula um cabeçalho colado junto
    if (/^(pos|posi|class)/i.test(col[0]) && !/^\d+$/.test(col[0])) continue;
    const posicao = /^\d+$/.test(col[0]) ? parseInt(col[0], 10) : null;
    const deslocado = posicao == null ? 0 : 1;
    const atleta = (col[deslocado] || "").trim();
    if (!atleta) continue;
    linhas.push({
      posicao,
      atleta,
      equipe: col[deslocado + 1] || "",
      categoria: col[deslocado + 2] || "",
      percurso: col[deslocado + 3] || "",
      tempo: col[deslocado + 4] || ""
    });
  }
  return linhas;
}

function gerarSlug(nome) {
  const base = String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "evento";
  return base + "-" + Math.random().toString(36).slice(2, 6);
}

function exportar() {
  const lista = estado.painel.inscritos;
  const rotulos = [];
  for (const ev of estado.painel.eventos)
    for (const p of (ev.perguntas || []))
      if (!rotulos.some(r => r.rotulo === p.rotulo)) rotulos.push({ rotulo: p.rotulo, ids: [p.id] });
      else rotulos.find(r => r.rotulo === p.rotulo).ids.push(p.id);

  const linhas = [["Numero", "Codigo", "Participante", "Nascimento", "Titular", "Email", "Telefone",
    "Evento", "Lote", "Valor", "Situacao", "Kit retirado",
    ...rotulos.map(r => r.rotulo), "Observacao", "Inscrito em"]];
  for (const i of lista) {
    linhas.push([
      i.numero == null ? "" : i.numero,
      i.codigo, i.participante_nome, dataBR(i.participante_nascimento),
      i.eh_titular ? "sim" : "nao (dependente)",
      i.participante_email, i.participante_telefone,
      (i.eventos || {}).nome || "", i.lote_nome || "",
      (i.valor_centavos / 100).toFixed(2).replace(".", ","),
      rotuloStatus(i.status),
      i.kit_retirado ? "sim" : "nao",
      ...rotulos.map(r => r.ids.map(id => (i.respostas || {})[id]).find(Boolean) || ""),
      i.observacao || "",
      new Date(i.criado_em).toLocaleString("pt-BR")
    ]);
  }
  // Uma célula que começa com = + - @ (ou tab/quebra) é lida como fórmula pelo
  // Excel e pelo Sheets ao abrir o arquivo. Como nome, e-mail e observação vêm
  // digitados pelo participante, um `=...` ali viraria fórmula na planilha da
  // organização. O apóstrofo na frente faz a planilha tratar como texto.
  const celula = c => {
    let s = String(c == null ? "" : c);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = "﻿" + linhas.map(l => l.map(celula).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "inscricoes.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================== erros === */

function mensagemDe(e) {
  // O Supabase às vezes põe a causa no código e não no texto — é o caso de
  // "over_email_send_rate_limit". Olhar os dois evita mostrar isso cru.
  const m = ((e && e.message) || "") + " " + ((e && e.code) || "");
  if (/failed to fetch|networkerror|load failed/i.test(m))
    return "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.";
  if (/invalid api key|jwt/i.test(m))
    return "A configuração do site está incorreta. Avise a organização.";
  // O link de acesso vai por e-mail, e é aí que aparecem os tropeços que a
  // pessoa não tem como entender em inglês. Sem estas três, ela lê algo como
  // "over_email_send_rate_limit" e conclui que o site está quebrado.
  if (/rate[ _-]?limit|too many requests|429/i.test(m))
    return "Muita gente pedindo link ao mesmo tempo. Espere uns minutos e tente de novo — " +
      "se continuar assim, avise a organização.";
  if (/sending (the )?(confirmation|magic|recovery)|failed to send|smtp/i.test(m))
    return "Não conseguimos enviar o e-mail agora. Tente de novo daqui a pouco, " +
      "ou avise a organização.";
  if (/invalid email|email address.*invalid|unable to validate email/i.test(m))
    return "Confira o endereço de e-mail — parece que ficou faltando alguma coisa.";
  if (/captcha|verification process/i.test(m))
    return "A verificação de segurança falhou. Recarregue a página e tente de novo.";
  return m || "Não foi possível carregar.";
}
function erroNa(alvo, e) {
  $(alvo).innerHTML = '<div class="faixa"><div class="limite">' +
    '<div class="erro">' + esc(mensagemDe(e)) + '</div>' +
    '<div class="acoes"><button class="btn fantasma" data-recarregar="1">Tentar de novo</button></div>' +
    '</div></div>';
}

/* ======================================================= interações ===== */

document.addEventListener("input", e => {
  const t = e.target;
  if (t && t.dataset && t.dataset.cpf) {
    const fim = t.selectionStart === t.value.length;
    t.value = formataCPF(t.value);
    if (fim) t.setSelectionRange(t.value.length, t.value.length);
  }
  // Filtro ao vivo da tabela de inscritos do painel: esconde as linhas que
  // não casam com o texto, sem recarregar nem perder a rolagem.
  if (t && t.id === "busca-inscritos") {
    const termo = t.value.trim().toLowerCase();
    document.querySelectorAll("#tabela-inscritos-corpo tr").forEach(tr => {
      tr.hidden = termo && !tr.textContent.toLowerCase().includes(termo);
    });
  }
});

document.addEventListener("click", async e => {
  if (e.target.closest("#botao-tema")) return alternarTema();

  const alvo = e.target.closest("[data-ir],[data-abrir],[data-inscrever],[data-voltar-evento]," +
    "[data-copiar],[data-pix],[data-cancelar],[data-sair],[data-editar],[data-publicar]," +
    "[data-abrir-fechar],[data-apagar],[data-apagar-inscricao],[data-status],[data-imprimir],[data-recarregar],"
    + "[data-peito],[data-peitos],[data-kit],[data-compartilhar],[data-calendario],[data-certificado]," +
    "[data-resultado],[data-resultados-de],[data-limpar-filtro],[data-tirar-acesso]");
  if (!alvo) return;
  const d = alvo.dataset;
  if (alvo.tagName === "A") e.preventDefault();

  if (d.ir) return ir(d.ir);
  if (d.recarregar) return desenhar();
  if (d.imprimir) return window.print();
  if (d.abrir) return ir("evento", d.abrir);
  if (d.inscrever) return ir("inscricao");
  if (d.voltarEvento) return ir("evento");
  if (d.resultado) return ir("resultados", d.resultado);
  if (d.limparFiltro) { estado.filtro = { texto: "", categoria: "", cidade: "" }; return desenharEventos(); }
  if (d.sair) { await api.sair(); estado.sessao = null; estado.organizador = false; return ir("eventos"); }

  if (d.copiar) {
    try { await navigator.clipboard.writeText(d.copiar); torrar("Código Pix copiado"); }
    catch (err) {
      const t = document.createElement("textarea");
      t.value = d.copiar; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); torrar("Código Pix copiado"); }
      catch (e2) { torrar("Selecione o código e copie manualmente"); }
      t.remove();
    }
    return;
  }
  if (d.pix) return mostrarPix(d.pix);

  if (d.compartilhar) {
    const ev = eventoPorSlug(d.compartilhar);
    if (ev) compartilharEvento(ev);
    return;
  }
  if (d.calendario) {
    const ev = eventoPorSlug(d.calendario);
    if (!ev) return;
    // Celular normalmente abre o app de agenda direto pelo Google Calendar;
    // no computador, o arquivo .ics serve para Outlook e Apple Calendário.
    if (/Android|iPhone|iPad/i.test(navigator.userAgent))
      window.open(linkGoogleCalendar(ev), "_blank", "noopener,noreferrer");
    else gerarICS(ev);
    return;
  }
  if (d.certificado) {
    const ev = estado.resultados.evento;
    const linha = (estado.resultados.linhas || [])
      .find(l => String(l.id || l.atleta) === d.certificado);
    if (!ev || !linha) return;
    abrirCertificado({
      organizacao: estado.identidade && estado.identidade.nome_site,
      evento: ev.nome,
      atleta: linha.atleta,
      percurso: linha.percurso,
      tempo: linha.tempo,
      posicao: linha.posicao,
      data: dataLonga(ev.data),
      local: cidadeUF(ev)
    });
    return;
  }

  if (d.cancelar) {
    if (!confirm("Cancelar esta inscrição?")) return;
    try { await api.cancelarInscricao(d.cancelar); torrar("Inscrição cancelada"); await telaMinhas(); }
    catch (err) { torrar(mensagemDe(err)); }
    return;
  }

  // painel
  if (d.editar) return editorEvento(d.editar);
  if (d.resultadosDe) return editorResultados(d.resultadosDe);
  if (d.publicar || d.abrirFechar) {
    const id = d.publicar || d.abrirFechar;
    const ev = estado.painel.eventos.find(x => x.id === id);
    if (!ev) return;
    const campos = d.publicar ? { publicado: !ev.publicado } : { inscricoes_abertas: !ev.inscricoes_abertas };
    const ordenar = lista => (lista || []).slice().sort((a, b) => a.ordem - b.ordem);
    try {
      await api.salvarEvento(Object.assign(
        { id, lotes: ordenar(ev.lotes), perguntas: ordenar(ev.perguntas) }, campos));
      await telaPainel();
    } catch (err) { torrar(mensagemDe(err)); }
    return;
  }
  if (d.apagar) {
    const ev = estado.painel.eventos.find(x => x.id === d.apagar);
    if (!ev) return;
    if (!confirm("Apagar “" + ev.nome + "”? Se já houver inscrições, o banco recusa: apague as inscrições antes, na lista de Inscritos.")) return;
    try { await api.apagarEvento(d.apagar); torrar("Evento apagado"); await telaPainel(); }
    catch (err) { torrar("Este evento ainda tem inscrições. Apague-as em Inscritos, ou use “Encerrar inscrições”."); }
    return;
  }
  if (d.apagarInscricao) {
    const i = estado.painel.inscritos.find(x => x.id === d.apagarInscricao);
    if (!i) return;
    if (!confirm("Apagar a inscrição de " + i.participante_nome + "? " +
      "Isto tira do banco de vez, sem desfazer. Para apenas liberar a vaga, " +
      "use Cancelar.")) return;
    try { await api.apagarInscricao(d.apagarInscricao); torrar("Inscrição apagada"); await telaPainel(); }
    catch (err) { torrar(mensagemDe(err)); }
    return;
  }
  if (d.tirarAcesso) {
    if (!confirm("Tirar o acesso de " + d.quem + " ao Painel?")) return;
    try { await api.removerOrganizador(d.tirarAcesso); torrar("Acesso removido"); await desenharEquipe(); }
    catch (err) { torrar(mensagemDe(err)); }
    return;
  }
  if (d.peito) {
    const lista = estado.painel.inscritos.concat(estado.minhas);
    const i = lista.find(x => x.id === d.peito);
    if (i) imprimirPeitos([i], "Número " + i.numero);
    return;
  }
  if (d.peitos) {
    const pagos = estado.painel.inscritos.filter(i => i.status === "pago");
    imprimirPeitos(pagos, "Números de peito");
    return;
  }
  if (d.kit) {
    const [id, resposta] = d.kit.split("|");
    try {
      await api.definirKit(id, resposta === "sim");
      torrar(resposta === "sim" ? "Kit entregue" : "Entrega desfeita");
      await telaPainel();
    } catch (err) { torrar(mensagemDe(err)); }
    return;
  }
  if (d.status) {
    const [id, novo] = d.status.split("|");
    try { await api.definirStatus(id, novo); torrar("Situação atualizada"); await telaPainel(); }
    catch (err) { torrar(mensagemDe(err)); }
  }
});

window.addEventListener("popstate", () => {
  const dest = destinoDoEndereco();
  if (dest) {
    if (dest.vista === "evento" && dest.slug) ir(dest.vista, dest.slug, false);
    else if (dest.vista === "resultados") ir(dest.vista, dest.slug, false);
    else ir(dest.vista, null, false);
  } else {
    ir("eventos", null, false);
  }
});

/* ============================================================= partida == */

(async function iniciar() {
  iniciarTema();
  if (api.configPendente) {
    $("#v-eventos").innerHTML =
      '<div class="faixa"><div class="limite"><div class="painel">' +
      '<span class="eyebrow">Falta um passo</span>' +
      '<h2 style="margin-top:4px">Configure o Supabase</h2>' +
      '<p style="color:var(--tinta-media);margin-top:10px">O arquivo <code class="mono">site/config.js</code> ' +
      'ainda está com os valores de exemplo. Copie a <b>Project URL</b> e a <b>anon public key</b> do seu ' +
      'projeto no Supabase (Project Settings › API) para dentro dele. O passo a passo completo está no ' +
      '<b>README.md</b>.</p></div></div></div>';
    return;
  }
  try { aplicarIdentidade(await api.identidade()); }
  catch (e) { aplicarIdentidade(null); }
  try { estado.taxa = await api.taxaServico(); } catch (e) { estado.taxa = 0; }
  estado.sessao = await api.sessaoAtual();
  estado.organizador = estado.sessao ? await api.souOrganizador() : false;

  api.aoMudarSessao(async sessao => {
    const entrouAgora = !!sessao && !estado.sessao;
    estado.sessao = sessao;
    estado.organizador = sessao ? await api.souOrganizador() : false;
    if (entrouAgora) {
      api.garantirPerfil().catch(() => {});
      torrar("Você entrou como " + sessao.user.email);
      return levarAoDestino();
    }
    desenhar();
  });

  // quem já chega logado (voltou do link do e-mail) volta para onde parou
  if (estado.sessao && pegarDestino()) return levarAoDestino();
  const destinoUrl = destinoDoEndereco();
  if (destinoUrl) return ir(destinoUrl.vista, destinoUrl.slug);
  await ir("eventos");
})();

async function levarAoDestino() {
  const destino = pegarDestino();
  limparDestino();
  if (!destino) return ir("minhas");
  if (destino.vista === "inscricao" && destino.slug) {
    try {
      estado.evento = await api.eventoPublico(destino.slug);
      if (estado.evento) return ir("inscricao");
    } catch (e) { /* cai para a lista abaixo */ }
  }
  return ir(destino.vista === "inscricao" ? "eventos" : destino.vista);
}
