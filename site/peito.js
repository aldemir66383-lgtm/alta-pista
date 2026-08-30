// Gerador do número de peito.
//
// Monta, em SVG, a folha que o participante prende na camisa no dia da
// corrida. Além do número grande, ela carrega duas partes destacáveis à
// direita — KIT e ALIMENTAÇÃO — que a organização recolhe na entrega,
// para ninguém pegar duas vezes. E um QR Code com o código da inscrição,
// para conferência rápida na retirada.
//
// Tudo é desenhado aqui, sem imagem externa: imprime igual em qualquer
// impressora e não depende da internet no dia do evento.

import { QR } from "./qr.js";

const LARGURA = 980;
const ALTURA  = 700;
const FAIXA   = 200;   // largura da coluna dos canhotos destacáveis

const esc = t => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** Preto ou branco, o que tiver mais contraste sobre a cor de fundo. */
function tintaSobre(hex) {
  const h = String(hex || "#111111").replace("#", "");
  if (h.length !== 6) return "#111111";
  const canal = i => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  return lum > 0.45 ? "#111111" : "#ffffff";
}

/**
 * O número diminui de corpo conforme cresce em dígitos, para 4 ou 5
 * algarismos não passarem das bordas.
 */
function corpoDoNumero(texto) {
  const n = texto.length;
  if (n <= 2) return 380;
  if (n === 3) return 340;
  if (n === 4) return 270;
  return 215;
}

/**
 * Aplica a quantidade de algarismos escolhida pelo evento: com 4, o
 * corredor 7 vira 0007. Zero (ou nada) mostra o número como ele é.
 */
export function formatarNumero(numero, digitos) {
  if (numero == null) return "?";
  const d = Math.min(6, Math.max(0, parseInt(digitos, 10) || 0));
  return String(numero).padStart(d, "0");
}

/** O mesmo cuidado para o número menor dos canhotos destacáveis. */
function corpoDoCanhoto(texto) {
  const n = texto.length;
  if (n <= 3) return 72;
  if (n === 4) return 56;
  return 44;
}

/** Corta o texto num limite de caracteres, sem cortar palavra pela metade. */
function encurtar(texto, limite) {
  const t = String(texto || "").trim();
  if (t.length <= limite) return t;
  const corte = t.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > limite * 0.6 ? corte.slice(0, espaco) : corte).trim() + "…";
}

/**
 * Só deixa passar endereço de imagem que aponte para a web ou para um
 * dado embutido. Sem isso, um endereço com "javascript:" viraria código
 * dentro do SVG que o navegador vai abrir para imprimir.
 */
function enderecoDeImagem(url) {
  const u = String(url || "").trim();
  return /^(https?:\/\/|data:image\/)/i.test(u) ? u : "";
}

/** O QR do código, desenhado dentro de um quadrado de lado `lado`. */
function qrEmbutido(codigo, x, y, lado) {
  const svg = QR.svg(codigo, 2);
  const interno = (svg.match(/viewBox="0 0 (\d+)/) || [])[1] || "1";
  const caminho = (svg.match(/<path d="([^"]*)"/) || [])[1] || "";
  const escala = lado / Number(interno);
  return '<g transform="translate(' + x + ',' + y + ') scale(' + escala.toFixed(4) + ')">' +
    '<rect width="' + interno + '" height="' + interno + '" fill="#ffffff"/>' +
    '<path d="' + caminho + '" fill="#000000"/></g>';
}

/**
 * Uma folha de número de peito.
 *
 * @param {object} d
 *   numero      número do peito (obrigatório)
 *   nome        nome do participante
 *   codigo      código da inscrição, vai no QR e escrito embaixo
 *   evento      nome do evento
 *   data        data já formatada, ex. "12 de outubro"
 *   local       cidade ou local da largada
 *   distancia   ex. "10 km"
 *   camisa      tamanho da camisa, ex. "G"
 *   sigla       iniciais da marca, ex. "AP"
 *   marca       nome do site, ex. "Alta Pista"
 *   cor         cor de acento em hexadecimal
 *   digitos     quantos algarismos o número sempre terá (0 = como é)
 *   logoUrl     logotipo do evento, no lugar da sigla
 *   fundoUrl    arte pronta cobrindo a folha, atrás do número
 */
export function folha(d) {
  const cor   = /^#[0-9a-fA-F]{6}$/.test(d.cor || "") ? d.cor : "#111111";
  const tinta = tintaSobre(cor);
  const num   = formatarNumero(d.numero, d.digitos);
  const meio  = (LARGURA - FAIXA) / 2;
  /* o QR ocupa o canto de baixo à esquerda; nome e distância se centram
     no que sobra, senão o nome passa por cima do QR */
  const meioTexto = (170 + (LARGURA - FAIXA)) / 2;

  const canhoto = (titulo, y, altura) =>
    '<g>' +
      '<text x="' + (LARGURA - FAIXA / 2) + '" y="' + (y + 34) + '" text-anchor="middle" ' +
        'font-size="' + (titulo.length > 6 ? 16 : 22) + '" font-weight="700" ' +
        'letter-spacing="' + (titulo.length > 6 ? 1.5 : 3) + '" fill="#666666">' + esc(titulo) + '</text>' +
      '<text x="' + (LARGURA - FAIXA / 2) + '" y="' + (y + altura / 2 + 34) + '" text-anchor="middle" ' +
        'font-size="' + corpoDoCanhoto(num) + '" font-weight="800" fill="#111111">' + esc(num) + '</text>' +
      (titulo === "KIT" && d.camisa
        ? '<text x="' + (LARGURA - FAIXA / 2) + '" y="' + (y + altura - 26) + '" text-anchor="middle" ' +
          'font-size="30" font-weight="700" fill="#111111">camisa ' + esc(d.camisa) + '</text>'
        : '') +
    '</g>';

  const linhaPontilhada = (y) =>
    '<line x1="' + (LARGURA - FAIXA + 10) + '" y1="' + y + '" x2="' + (LARGURA - 10) + '" y2="' + y +
    '" stroke="#c9c9c9" stroke-width="2" stroke-dasharray="7 7"/>';

  const fundo = enderecoDeImagem(d.fundoUrl);
  const logo  = enderecoDeImagem(d.logoUrl);
  const eu    = "p" + Math.random().toString(36).slice(2, 9);   // ids únicos por folha

  return '' +
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + LARGURA + ' ' + ALTURA + '" ' +
    'font-family="Helvetica, Arial, sans-serif" role="img" ' +
    'aria-label="Número de peito ' + esc(num) + ' de ' + esc(d.nome) + '">' +

    '<defs><clipPath id="folha-' + eu + '">' +
      '<rect x="3" y="3" width="' + (LARGURA - 6) + '" height="' + (ALTURA - 6) + '" rx="16"/>' +
    '</clipPath>' +
    (logo ? '<clipPath id="logo-' + eu + '"><circle cx="66" cy="54" r="30"/></clipPath>' : '') +
    '</defs>' +

    '<rect width="' + LARGURA + '" height="' + ALTURA + '" fill="#ffffff"/>' +

    /* a arte do evento, se houver, cobrindo a folha por baixo de tudo.
       O véu branco por cima garante que o número continue legível — sem
       ele, uma foto escura engoliria os algarismos pretos. */
    (fundo
      ? '<g clip-path="url(#folha-' + eu + ')">' +
        '<image href="' + esc(fundo) + '" x="3" y="3" ' +
          'width="' + (LARGURA - 6) + '" height="' + (ALTURA - 6) + '" ' +
          'preserveAspectRatio="xMidYMid slice"/>' +
        '<rect x="3" y="3" width="' + (LARGURA - 6) + '" height="' + (ALTURA - 6) + '" ' +
          'fill="#ffffff" opacity="0.74"/></g>'
      : '') +

    '<rect x="1.5" y="1.5" width="' + (LARGURA - 3) + '" height="' + (ALTURA - 3) + '" ' +
      'fill="none" stroke="#d6d6d6" stroke-width="3" rx="18"/>' +

    /* faixa do topo, com a marca à esquerda e o evento no centro */
    '<path d="M18,3 H' + (LARGURA - 18) + ' a15,15 0 0 1 15,15 V104 H3 V18 a15,15 0 0 1 15,-15 z" fill="' + cor + '"/>' +
    (logo
      ? '<circle cx="66" cy="54" r="30" fill="#ffffff"/>' +
        '<image href="' + esc(logo) + '" x="36" y="24" width="60" height="60" ' +
          'preserveAspectRatio="xMidYMid slice" clip-path="url(#logo-' + eu + ')"/>'
      : '<circle cx="66" cy="54" r="30" fill="' + tinta + '" opacity="0.16"/>' +
        '<text x="66" y="65" text-anchor="middle" font-size="30" font-weight="800" fill="' + tinta + '">' +
          esc((d.sigla || "").slice(0, 3).toUpperCase()) + '</text>') +
    '<text x="112" y="46" font-size="27" font-weight="700" fill="' + tinta + '">' +
      esc(encurtar(d.evento, 42)) + '</text>' +
    '<text x="112" y="78" font-size="20" fill="' + tinta + '" opacity="0.85">' +
      esc([d.data, d.local].filter(Boolean).join("  ·  ")) + '</text>' +

    /* o número, o que se enxerga de longe */
    '<text x="' + meio + '" y="' + (ALTURA / 2 + 78) + '" text-anchor="middle" ' +
      'font-size="' + corpoDoNumero(num) + '" font-weight="800" fill="#111111" ' +
      'letter-spacing="-6">' + esc(num) + '</text>' +

    /* nome e distância ficam à direita do QR, para não encavalar nele */
    '<text x="' + meioTexto + '" y="' + (ALTURA - 106) + '" text-anchor="middle" ' +
      'font-size="27" font-weight="700" fill="#222222">' +
      esc(encurtar((d.nome || "").toUpperCase(), 32)) + '</text>' +
    (d.distancia
      ? '<rect x="' + (meioTexto - 74) + '" y="' + (ALTURA - 84) + '" width="148" height="38" rx="19" fill="' + cor + '"/>' +
        '<text x="' + meioTexto + '" y="' + (ALTURA - 58) + '" text-anchor="middle" ' +
        'font-size="22" font-weight="800" fill="' + tinta + '">' + esc(encurtar(d.distancia, 14)) + '</text>'
      : '') +

    /* QR do código, no canto de baixo à esquerda */
    qrEmbutido(d.codigo || "-", 34, ALTURA - 148, 116) +
    '<text x="92" y="' + (ALTURA - 16) + '" text-anchor="middle" font-size="19" ' +
      'font-family="ui-monospace, Menlo, Consolas, monospace" fill="#555555">' +
      esc(d.codigo || "") + '</text>' +

    /* coluna destacável: KIT em cima, ALIMENTAÇÃO embaixo */
    '<line x1="' + (LARGURA - FAIXA) + '" y1="104" x2="' + (LARGURA - FAIXA) + '" y2="' + (ALTURA - 3) + '" ' +
      'stroke="#c9c9c9" stroke-width="2" stroke-dasharray="7 7"/>' +
    (fundo ? '<rect x="' + (LARGURA - FAIXA) + '" y="104" width="' + (FAIXA - 3) + '" ' +
             'height="' + (ALTURA - 107) + '" fill="#ffffff" opacity="0.82"/>' : '') +
    canhoto("KIT", 130, 250) +
    linhaPontilhada(410) +
    canhoto("ALIMENTAÇÃO", 430, 220) +
    '<text x="' + (LARGURA - FAIXA / 2) + '" y="' + (ALTURA - 18) + '" text-anchor="middle" ' +
      'font-size="16" fill="#999999">' + esc(d.marca || "") + '</text>' +

  '</svg>';
}

/**
 * Uma página pronta para imprimir, com uma folha por página.
 * Serve tanto para o participante (uma só) quanto para a organização
 * (todas as inscrições pagas de uma vez).
 */
export function paginaParaImprimir(folhas, titulo) {
  const fim = "<" + "/script>";
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(titulo || "Números de peito") + '</title><style>' +
    '@page { size: A4 landscape; margin: 10mm; }' +
    'html,body { margin:0; padding:0; background:#f2f2f2; }' +
    '.folha { page-break-after: always; break-after: page; padding:14px; }' +
    '.folha:last-child { page-break-after: auto; break-after: auto; }' +
    '.folha svg { width:100%; height:auto; display:block; background:#fff; }' +
    '.aviso { font:15px/1.5 Helvetica,Arial,sans-serif; color:#444; padding:18px 20px; ' +
      'background:#fff; border-bottom:1px solid #ddd; }' +
    '@media print { .aviso { display:none; } body { background:#fff; } }' +
    '</style></head><body>' +
    '<div class="aviso">Use <b>Imprimir</b> no seu navegador. ' +
    'Escolha papel A4 deitado, uma folha por página. ' +
    'Este aviso não sai na impressão.</div>' +
    folhas.map(s => '<div class="folha">' + s + '</div>').join("") +
    '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});' + fim +
    '</body></html>';
}
