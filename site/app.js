// Balcão de Inscrições — aplicação do site.
//
// Nenhuma regra de dinheiro ou de vaga é decidida aqui. O preço, o lote e o
// status saem da função inscrever() no banco; esta tela só mostra e pergunta.

import * as api from "./api.js";
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
    fundoUrl: e.peito_fundo_url || ""
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
}

/* ============================================================== estado === */

/* =========================================================== identidade == */

const IDENTIDADE_PADRAO = {
  organizacao: "", sigla: "B", nome_site: "Balcão",
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

function aplicarIdentidade(id) {
  const i = Object.assign({}, IDENTIDADE_PADRAO, id || {});
  estado.identidade = i;
  estado.organizacao = i.organizacao || "";

  const raiz = document.documentElement.style;
  raiz.setProperty("--acento", i.cor_acento);
  raiz.setProperty("--sobre-acento", tintaSobre(i.cor_acento));
  raiz.setProperty("--acento-escuro", escurecer(i.cor_acento, 0.12));

  const selo = $(".marca .selo");
  selo.innerHTML = i.logo_url
    ? '<img src="' + esc(i.logo_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'
    : esc((i.sigla || "B").slice(0, 3).toUpperCase());
  selo.classList.toggle("com-logo", !!i.logo_url);
  $(".marca b").textContent = i.nome_site || "Balcão";
  $("#marca-org").textContent = i.organizacao || i.subtitulo || "Inscrições esportivas";
  document.title = (i.nome_site || "Balcão") + (i.organizacao ? " · " + i.organizacao : "");

  if (i.sobre) $("#rodape-sobre").textContent = i.sobre;
  const contato = [];
  if (i.contato) contato.push("<li><span>" + esc(i.contato) + "</span></li>");
  if (i.whatsapp) contato.push('<li><a href="https://wa.me/' +
    esc(i.whatsapp.replace(/\D/g, "")) + '" target="_blank" rel="noopener">WhatsApp ' + esc(i.whatsapp) + "</a></li>");
  if (i.instagram) contato.push('<li><a href="https://instagram.com/' +
    esc(i.instagram.replace(/^@/, "")) + '" target="_blank" rel="noopener">@' +
    esc(i.instagram.replace(/^@/, "")) + "</a></li>");
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
  destino: null
};
let vista = "eventos";

/* =============================================================== rotas === */

function ir(nome, ctx) {
  vista = nome;
  if (nome !== "eventos") clearInterval(carrosselRelogio); // não roda escondido
  if (nome !== "minhas") clearInterval(minhasRelogio);     // idem
  document.querySelectorAll(".secao").forEach(s => s.classList.remove("ativa"));
  $("#v-" + nome).classList.add("ativa");
  document.querySelectorAll("#menu button").forEach(b => {
    const marca = b.dataset.ir === nome ||
      (b.dataset.ir === "eventos" && ["evento", "inscricao"].includes(nome));
    if (marca) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  return desenhar(ctx);
}

async function desenhar(ctx) {
  $("#rodape-assinatura").textContent =
    (estado.organizacao || estado.identidade.nome_site || "Balcão") + " · " + new Date().getFullYear();
  $("#menu button[data-ir='painel']").hidden = !estado.organizador;
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

function heroSlide(ev, ativo) {
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
        '<button class="btn clara" data-abrir="' + esc(ev.slug) + '">Detalhes</button>' +
        (ev.inscricoes_abertas
          ? '<button class="btn" data-abrir="' + esc(ev.slug) + '">' +
            (lotado ? "Lista de espera" : "Inscreva-se") + '</button>'
          : '<span class="tag cancelado">Inscrições encerradas</span>') +
      '</div>' +
    '</div></div>';
}

/** Faixa de abertura. Com mais de um evento vira carrossel. */
function heroHTML(lista) {
  const evs = Array.isArray(lista) ? lista : [lista];
  if (!evs.length) return "";
  const varios = evs.length > 1;
  return '<section class="hero"' + (varios ? ' id="carrossel"' : "") + '>' +
    evs.map((ev, i) => heroSlide(ev, i === 0)).join("") +
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
    heroHTML([ev]) +
    '<div class="faixa"><div class="limite">' +
    '<button class="btn fantasma pequeno" data-ir="eventos" style="margin-bottom:18px">← Todos os eventos</button>' +
    '<div class="painel">' +
      '<span class="eyebrow">' + (lotado && !fechado ? "Lista de espera" : "Inscrições") + '</span>' +
      '<h2 style="margin-top:4px">' + esc(ev.nome) + '</h2>' +
      (ev.descricao ? '<p style="margin-top:10px;color:var(--tinta-media)">' + esc(ev.descricao) + '</p>' : "") +
      '<dl style="margin-top:18px">' +
        '<div class="linha-dados"><dt>Quando</dt><dd>' + esc(dataLonga(ev.data)) +
          (ev.hora ? " · " + hora(ev.hora) : "") + '</dd></div>' +
        '<div class="linha-dados"><dt>Onde</dt><dd>' + esc(ev.local || "A definir") +
          (cidadeUF(ev) ? " — " + esc(cidadeUF(ev)) : "") + '</dd></div>' +
        (ev.distancias ? '<div class="linha-dados"><dt>Percursos</dt><dd>' + esc(ev.distancias) + '</dd></div>' : "") +
        '<div class="linha-dados"><dt>Valor' + (lote && ev.lotes.length > 1 ? " · " + esc(lote.nome) : "") +
          '</dt><dd class="mono">' + (precoAtual(ev) > 0 ? dinheiro(precoAtual(ev)) : "Gratuito") + '</dd></div>' +
        (rest != null ? '<div class="linha-dados"><dt>Vagas restantes</dt><dd class="mono">' + rest + '</dd></div>' : "") +
        (ev.na_fila ? '<div class="linha-dados"><dt>Na lista de espera</dt><dd class="mono">' + ev.na_fila + '</dd></div>' : "") +
      '</dl>' + tabelaLotes +
      (String(ev.edital || "").trim()
        ? '<div class="edital"><h2 style="font-size:1.1rem;margin-bottom:14px">Edital do evento</h2>' +
          renderEdital(ev.edital) + '</div>' +
          '<div class="acoes"><button class="btn fantasma pequeno" data-imprimir="1">Imprimir ou salvar em PDF</button></div>'
        : "") +
      '<div class="acoes">' +
        (fechado
          ? '<span class="tag cancelado">Inscrições encerradas</span>'
          : '<button class="btn" data-inscrever="1">' +
            (lotado ? "Entrar na lista de espera" : "Fazer inscrição") + '</button>') +
        (ev.resultados_publicados
          ? '<button class="btn fantasma" data-resultado="' + esc(ev.slug) + '">Ver resultados</button>' : "") +
      '</div>' +
    '</div></div></div>';
}

/* ==================================================== tela: inscrição === */

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
          '<label>Telefone<input name="telefone" autocomplete="tel" value="' +
            esc(perfil && perfil.telefone || "") + '" placeholder="(00) 00000-0000"></label>' +
          extras.map(campoExtraHTML).join("") +
          '<label>Observação <span class="dica">opcional</span>' +
            '<input name="observacao" placeholder="Algo que a organização precisa saber"></label>' +
        '</div>' +
        '<div class="acoes">' +
          '<button class="btn" type="submit" id="botao-enviar">' +
            (lotado ? "Entrar na lista de espera" : precoAtual(ev) > 0 ? "Gerar meu Pix" : "Confirmar inscrição") +
          '</button>' +
          '<span style="font-size:.83rem;color:var(--tinta-fraca)">' +
            'Seus dados ficam com a organização e só você enxerga sua inscrição.</span>' +
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
      '<dl style="margin-top:14px">' +
        (i.numero != null
          ? '<div class="linha-dados"><dt>Número de peito</dt><dd class="mono">' +
            '<b style="font-size:1.5em">' +
            formatarNumero(i.numero, (i.eventos || {}).numero_digitos) + '</b></dd></div>' : "") +
        '<div class="linha-dados"><dt>Código</dt><dd class="mono">' + esc(i.codigo) + '</dd></div>' +
        '<div class="linha-dados"><dt>Valor' + (i.lote_nome ? " · " + esc(i.lote_nome) : "") +
          '</dt><dd class="mono">' + (i.valor_centavos > 0 ? dinheiro(i.valor_centavos) : "Gratuito") + '</dd></div>' +
        (ev.data ? '<div class="linha-dados"><dt>Quando</dt><dd>' + esc(dataLonga(ev.data)) +
          (ev.hora ? " · " + hora(ev.hora) : "") + '</dd></div>' : "") +
        (ev.local ? '<div class="linha-dados"><dt>Onde</dt><dd>' + esc(ev.local) + '</dd></div>' : "") +
      '</dl>' +
      '<div id="pix-' + i.id + '"></div>' +
      '<div class="acoes">' +
        (i.status === "pendente" ? '<button class="btn" data-pix="' + i.id + '">Ver o Pix</button>' : "") +
        (i.numero != null ? '<button class="btn" data-peito="' + i.id + '">Imprimir meu número</button>' : "") +
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
  alvo.innerHTML = '<p class="carregando">Gerando a cobrança…</p>';
  let dados;
  try { dados = await api.cobranca(id); }
  catch (e) { alvo.innerHTML = '<div class="erro">' + esc(mensagemDe(e)) + '</div>'; return; }
  if (!dados) {
    alvo.innerHTML = '<div class="aviso"><span>⚑</span><span>A organização ainda não cadastrou a chave Pix. ' +
      'Sua inscrição está registrada; procure a organização para combinar o pagamento.</span></div>';
    return;
  }
  const payload = Pix.brcode(dados);
  let qr = "";
  try { qr = QR.svg(payload, 3); } catch (e) { qr = ""; }
  alvo.innerHTML =
    '<div class="pagamento" style="margin-top:18px">' +
      (qr ? '<div class="qr-caixa">' + qr + '</div>' : "") +
      '<div style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
        '<div><span class="eyebrow">Pix copia e cola</span>' +
        '<p style="font-size:.88rem;color:var(--tinta-media);margin-top:4px">' +
        'Abra o app do banco, escolha Pix › Pagar com QR Code e aponte a câmera — ou copie o código.</p></div>' +
        '<div class="copia mono">' + esc(payload) + '</div>' +
        '<div><button class="btn" data-copiar="' + esc(payload) + '">Copiar código Pix</button></div>' +
        '<p style="font-size:.82rem;color:var(--tinta-fraca)">Depois de pagar, a organização confere o ' +
        'recebimento e sua inscrição passa a constar como paga.</p>' +
      '</div>' +
    '</div>';
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
        '<th style="text-align:right">Tempo</th></tr></thead><tbody>' +
        linhas.map(l => '<tr>' +
          '<td><span class="pos' + (l.posicao && l.posicao <= 3 ? " podio" : "") + '">' +
            (l.posicao != null ? l.posicao + "º" : "—") + '</span></td>' +
          '<td class="nome">' + esc(l.atleta) + '</td>' +
          (temEquipe ? '<td>' + esc(l.equipe || "—") + '</td>' : "") +
          (temCategoria ? '<td>' + esc(l.categoria || "—") + '</td>' : "") +
          (temPercurso ? '<td>' + esc(l.percurso || "—") + '</td>' : "") +
          '<td class="mono" style="text-align:right">' + esc(l.tempo || "—") + '</td>' +
        '</tr>').join("") + '</tbody></table></div>' +
        '<div class="acoes"><button class="btn fantasma pequeno" data-imprimir="1">Imprimir ou salvar em PDF</button></div>' +
        '</div>'
      : '<div class="vazio"><h3>Classificação ainda vazia</h3><p>A apuração deste evento não foi importada.</p></div>') +
    '</div></div>';
}

/* ==================================================== tela: entrar ====== */

function telaEntrar() {
  $("#v-entrar").innerHTML =
    '<div class="faixa"><div class="entrar-caixa"><div class="painel">' +
      '<span class="eyebrow">Sua conta</span><h2 style="margin-top:4px">Entrar</h2>' +
      '<p style="color:var(--tinta-media);font-size:.93rem;margin-top:8px">' +
        'Digite seu e-mail e enviamos um link de acesso. Não existe senha para criar nem para lembrar — ' +
        'e é esse e-mail que garante que só você enxerga as suas inscrições.</p>' +
      '<form id="form-entrar"><div class="campos">' +
        '<label>Seu nome<input name="nome" placeholder="Como devemos te chamar"></label>' +
        '<label>E-mail<input name="email" type="email" required placeholder="voce@exemplo.com" autocomplete="email"></label>' +
      '</div><div class="acoes"><button class="btn" type="submit" id="botao-entrar">Enviar link de acesso</button></div>' +
      '<div id="aviso-entrar"></div></form>' +
    '</div></div></div>';

  $("#form-entrar").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const botao = $("#botao-entrar");
    botao.disabled = true; botao.textContent = "Enviando…";
    try {
      await api.entrarPorEmail(String(f.get("email")).trim(), String(f.get("nome") || "").trim());
      $("#aviso-entrar").innerHTML = '<div class="aviso info" style="margin-top:16px"><span>✉</span><span>' +
        'Link enviado. Abra seu e-mail e clique no link para entrar — pode levar um minuto, ' +
        'e vale conferir a caixa de spam.</span></div>';
      botao.textContent = "Link enviado";
    } catch (err) {
      $("#aviso-entrar").innerHTML = '<div class="erro">' + esc(mensagemDe(err)) + '</div>';
      botao.disabled = false; botao.textContent = "Tentar de novo";
    }
  });
}

/* ==================================================== tela: painel ====== */

let edLotes = [], edPerguntas = [], edEventoId = null, edCapa = "";
let edPeitoLogo = "", edPeitoFundo = "";

async function telaPainel() {
  if (!estado.organizador) { torrar("Área restrita à organização"); return ir("eventos"); }
  carregando("#v-painel");
  try {
    const [cfg, evs, ins] = await Promise.all([
      api.configuracao(), api.eventosDoPainel(), api.inscritosDoPainel()
    ]);
    estado.painel = { config: cfg, eventos: evs, inscritos: ins };
  } catch (e) { return erroNa("#v-painel", e); }

  const { config, eventos, inscritos } = estado.painel;
  const pagos = inscritos.filter(i => i.status === "pago");
  const arrecadado = pagos.reduce((s, i) => s + i.valor_centavos, 0);

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

  html += '<div class="painel"><span class="eyebrow">Marca</span><h3 style="margin-top:4px">Identidade do site</h3>' +
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

  html += '<div class="painel"><span class="eyebrow">Recebimento</span><h3 style="margin-top:4px">Dados do Pix</h3>' +
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

  html += '<div class="painel"><span class="eyebrow">Acesso</span>' +
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
  return '<div class="linha-item"><div class="quem">' +
    '<b>' + esc(ev.nome) + (ev.publicado ? "" : ' <span class="tag pendente" style="margin-left:6px">rascunho</span>') +
      (ev.destaque ? ' <span class="tag espera">destaque</span>' : "") + '</b>' +
    '<small>' + esc(ev.categoria || "—") + " · " + esc(dataLonga(ev.data)) +
      (ev.hora ? " · " + hora(ev.hora) : "") + (cidadeUF(ev) ? " · " + esc(cidadeUF(ev)) : "") +
      " · a partir de " + (preco > 0 ? dinheiro(preco) : "gratuito") +
      " · " + lotes.length + " lote(s)" +
      (String(ev.edital || "").trim() ? " · com edital" : "") +
      (ev.resultados_publicados ? " · resultado publicado" : "") + '</small>' +
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
  return '<div class="rolagem" style="margin-top:14px"><table><thead><tr>' +
    '<th>Participante</th><th>Evento</th><th>Nº</th><th>Código</th><th>Valor</th><th>Situação</th><th>Kit</th><th></th>' +
    '</tr></thead><tbody>' + lista.map(i => {
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
          (i.numero != null ? '<button class="btn fantasma pequeno" data-peito="' + i.id + '">Nº de peito</button> ' : "") +
          (i.status === "espera" ? '<button class="btn pequeno" data-status="' + i.id + '|pendente">Chamar da fila</button> ' : "") +
          (i.status !== "pago" && i.status !== "espera" ? '<button class="btn fantasma pequeno" data-status="' + i.id + '|pago">Marcar pago</button> ' : "") +
          (i.status !== "cancelada" ? '<button class="btn perigo pequeno" data-status="' + i.id + '|cancelada">Cancelar</button>' : "") +
          (i.status === "cancelada" ? '<button class="btn fantasma pequeno" data-status="' + i.id + '|pendente">Reabrir</button>' : "") +
        '</td></tr>';
    }).join("") + '</tbody></table></div>';
}

let edLogo = "";

function ligarPainel() {
  edLogo = estado.painel.config.logo_url || "";
  const previaLogo = () => {
    $("#previa-logo").innerHTML = edLogo
      ? '<img src="' + esc(edLogo) + '" alt="Prévia do logotipo" ' +
        'style="width:72px;height:72px;object-fit:cover;border-radius:50%;border:1px solid var(--borda)">' +
        '<div class="acoes" style="margin-top:8px"><button type="button" class="btn perigo pequeno" id="tirar-logo">Voltar às iniciais</button></div>'
      : '<p class="mini-vazio">Sem logotipo: o selo mostra as iniciais.</p>';
  };
  previaLogo();

  $("#previa-logo").addEventListener("click", e => {
    if (e.target.id === "tirar-logo") { edLogo = ""; previaLogo(); }
  });
  $("#arquivo-logo").addEventListener("change", async e => {
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

  $("#form-identidade").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const corEscolhida = String(f.get("cor_acento_texto") || f.get("cor_acento") || "").trim().toUpperCase();
    if (!valida(corEscolhida)) { torrar("Cor inválida — use o formato #RRGGBB"); return; }
    try {
      await api.salvarConfiguracao({
        sigla: String(f.get("sigla") || "B").trim().toUpperCase().slice(0, 3) || "B",
        nome_site: String(f.get("nome_site") || "").trim() || "Balcão",
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

  $("#form-config").addEventListener("submit", async e => {
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
  ligarEquipe();
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

function editorEvento(id) {
  const ev = id ? estado.painel.eventos.find(e => e.id === id) : null;
  const v = ev || {
    nome: "", descricao: "", edital: "", data: "", hora: "07:00", local: "",
    categoria: "Corrida de rua", cidade: "", uf: "", distancias: "", imagem_url: "",
    vagas: 0, numero_inicial: 1, numero_digitos: 4, peito_cor: "",
    peito_logo_url: "", peito_fundo_url: "",
    espera_ativa: true, inscricoes_abertas: true,
    publicado: false, destaque: false
  };
  edEventoId = id;
  edCapa = v.imagem_url || "";
  edPeitoLogo = v.peito_logo_url || "";
  edPeitoFundo = v.peito_fundo_url || "";
  edLotes = (ev ? (ev.lotes || []).slice().sort((a, b) => a.ordem - b.ordem) : [])
    .map(l => Object.assign({}, l));
  if (!edLotes.length) edLotes = [{ nome: "Lote único", preco_centavos: 0, vende_ate: "", quantidade: 0 }];
  edPerguntas = (ev ? (ev.perguntas || []).slice().sort((a, b) => a.ordem - b.ordem) : [])
    .map(p => Object.assign({}, p));

  const antigo = $("#editor-evento");
  antigo.replaceWith(antigo.cloneNode(false));
  const caixa = $("#editor-evento");

  caixa.innerHTML =
    '<form id="form-evento" style="margin-top:20px;border-top:1px solid var(--borda);padding-top:20px">' +
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
          '<input name="vagas" type="number" min="0" step="1" value="' + (v.vagas || 0) + '"></label>' +
        '<label>Numeração começa em <span class="dica">o nº de peito do primeiro pagante</span>' +
          '<input name="numero_inicial" type="number" min="1" step="1" value="' +
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

      '<div class="sub"><h4>Aparência do número de peito</h4>' +
        '<p class="explica">É a folha que o corredor prende na camisa. ' +
        'Deixe a cor em branco para usar a do site. A arte de fundo cobre a folha inteira ' +
        'e recebe um véu claro por cima, para o número continuar legível de longe.</p>' +
        '<div class="campos duas" style="margin-top:10px">' +
          '<label>Algarismos <span class="dica">4 faz o corredor 7 virar 0007; 0 mostra o número cru</span>' +
            '<input name="numero_digitos" type="number" min="0" max="6" step="1" value="' +
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
  $("#arquivo-peito-logo").addEventListener("change", e =>
    enviarImagemDoPeito(e.target, u => { edPeitoLogo = u; }));
  $("#arquivo-peito-fundo").addEventListener("change", e =>
    enviarImagemDoPeito(e.target, u => { edPeitoFundo = u; }));

  $("#arquivo-capa").addEventListener("change", async e => {
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

  $("#form-evento").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const lotes = edLotes.filter(l => String(l.nome || "").trim());
    if (!lotes.length) {
      $("#erro-evento").innerHTML = '<div class="erro">Defina pelo menos um lote de preço.</div>';
      return;
    }
    const nome = String(f.get("nome") || "").trim();
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
        espera_ativa: f.get("espera_ativa") === "on",
        destaque: f.get("destaque") === "on",
        descricao: String(f.get("descricao") || "").trim(),
        edital: String(f.get("edital") || "").trim(),
        lotes,
        perguntas: edPerguntas.filter(p => String(p.rotulo || "").trim())
      });
      torrar(ev ? "Evento atualizado" : "Evento criado como rascunho");
      await telaPainel();
    } catch (err) {
      $("#erro-evento").innerHTML = '<div class="erro">' + esc(mensagemDe(err)) + '</div>';
    }
  });
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
  const csv = "﻿" + linhas.map(l =>
    l.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "inscricoes.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================== erros === */

function mensagemDe(e) {
  const m = (e && e.message) || "";
  if (/failed to fetch|networkerror|load failed/i.test(m))
    return "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.";
  if (/invalid api key|jwt/i.test(m))
    return "A configuração do site está incorreta. Avise a organização.";
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
});

document.addEventListener("click", async e => {
  const alvo = e.target.closest("[data-ir],[data-abrir],[data-inscrever],[data-voltar-evento]," +
    "[data-copiar],[data-pix],[data-cancelar],[data-sair],[data-editar],[data-publicar]," +
    "[data-abrir-fechar],[data-apagar],[data-status],[data-imprimir],[data-recarregar],"
    + "[data-peito],[data-peitos],[data-kit]," +
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
    if (!confirm("Apagar “" + ev.nome + "”? Se já houver inscrições, o banco recusa — encerre o evento em vez de apagar.")) return;
    try { await api.apagarEvento(d.apagar); torrar("Evento apagado"); await telaPainel(); }
    catch (err) { torrar("Não dá para apagar um evento que já tem inscrições. Use “Encerrar inscrições”."); }
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

/* ============================================================= partida == */

(async function iniciar() {
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
