// Gera o QR Code do site em SVG (para impressão) e PNG (para WhatsApp).
// Usa o mesmo codificador que o site usa para o Pix — sem biblioteca externa.
//
//   node gerar-qr.mjs                        usa o endereço publicado
//   node gerar-qr.mjs https://outro.site     usa outro endereço

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { QR } from "./site/qr.js";

const destino = process.argv[2] || "https://alta-pista.vercel.app";
const TITULO = "ALTA PISTA";
const CHAMADA = "Inscrições e resultados";
const AMARELO = "#FFE01B";
const GRAFITE = "#212529";

const m = QR.matriz(destino);
const n = m.length;

/* ----------------------------------------------------------------- SVG -- */

const BORDA = 4;                       // zona de silêncio exigida pelo padrão
const lado = n + BORDA * 2;
const ESCALA = 12;
const larguraQR = lado * ESCALA;
const TOPO = 132;                      // faixa da marca
const RODAPE = 96;                     // endereço embaixo
const L = larguraQR;
const A = TOPO + larguraQR + RODAPE;

let caminho = "";
for (let r = 0; r < n; r++) {
  let c = 0;
  while (c < n) {
    if (!m[r][c]) { c++; continue; }
    let fim = c;
    while (fim + 1 < n && m[r][fim + 1]) fim++;
    const x = (c + BORDA) * ESCALA, y = (r + BORDA) * ESCALA;
    caminho += `M${x},${y}h${(fim - c + 1) * ESCALA}v${ESCALA}h-${(fim - c + 1) * ESCALA}z`;
    c = fim + 1;
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}" viewBox="0 0 ${L} ${A}">
  <rect width="${L}" height="${A}" fill="#FFFFFF"/>
  <rect width="${L}" height="${TOPO}" fill="${GRAFITE}"/>
  <rect y="${TOPO - 8}" width="${L}" height="8" fill="${AMARELO}"/>
  <circle cx="76" cy="60" r="30" fill="${AMARELO}"/>
  <text x="76" y="72" font-family="Titillium Web, Segoe UI, sans-serif" font-size="30"
        font-weight="900" fill="${GRAFITE}" text-anchor="middle">AP</text>
  <text x="124" y="54" font-family="Titillium Web, Segoe UI, sans-serif" font-size="34"
        font-weight="900" fill="#FFFFFF" letter-spacing="2">${TITULO}</text>
  <text x="124" y="84" font-family="Titillium Web, Segoe UI, sans-serif" font-size="18"
        font-weight="600" fill="#A8B0B8" letter-spacing="1">${CHAMADA}</text>
  <g transform="translate(0,${TOPO})"><path d="${caminho}" fill="#000000"/></g>
  <text x="${L / 2}" y="${TOPO + larguraQR + 40}" font-family="Titillium Web, Segoe UI, sans-serif"
        font-size="26" font-weight="700" fill="${GRAFITE}" text-anchor="middle">Aponte a câmera do celular</text>
  <text x="${L / 2}" y="${TOPO + larguraQR + 72}" font-family="IBM Plex Mono, monospace"
        font-size="21" fill="#5B646D" text-anchor="middle">${destino.replace(/^https?:\/\//, "")}</text>
</svg>`;

writeFileSync("qr-alta-pista.svg", svg);

/* ----------------------------------------------------------------- PNG -- */
/* QR é preto e branco, então o PNG sai pequeno mesmo sem nenhuma dependência:
   escrevemos as linhas cruas e deixamos o zlib do próprio Node comprimir.   */

function png(matriz, escala, borda) {
  const nn = matriz.length;
  const dim = (nn + borda * 2) * escala;
  const linhas = Buffer.alloc((dim * 3 + 1) * dim);
  let p = 0;
  for (let y = 0; y < dim; y++) {
    linhas[p++] = 0;                                   // filtro "nenhum"
    const linhaQR = Math.floor(y / escala) - borda;
    for (let x = 0; x < dim; x++) {
      const colQR = Math.floor(x / escala) - borda;
      const escuro = linhaQR >= 0 && linhaQR < nn && colQR >= 0 && colQR < nn && matriz[linhaQR][colQR];
      const v = escuro ? 0 : 255;
      linhas[p++] = v; linhas[p++] = v; linhas[p++] = v;
    }
  }

  const crcTabela = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  const crc = b => {
    let c = -1;
    for (const x of b) c = crcTabela[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const pedaco = (tipo, dados) => {
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const soma = Buffer.alloc(4); soma.writeUInt32BE(crc(corpo));
    return Buffer.concat([tam, corpo, soma]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0); ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pedaco("IHDR", ihdr),
    pedaco("IDAT", deflateSync(linhas, { level: 9 })),
    pedaco("IEND", Buffer.alloc(0))
  ]);
}

const imagem = png(m, 16, 4);
writeFileSync("qr-alta-pista.png", imagem);

console.log("endereço  :", destino);
console.log("módulos   :", n, "x", n, "(versão " + ((n - 17) / 4) + ")");
console.log("SVG       : qr-alta-pista.svg  (" + Math.round(svg.length / 1024) + " KB, vetorial)");
console.log("PNG       : qr-alta-pista.png  (" + ((n + 8) * 16) + "px, " + Math.round(imagem.length / 1024) + " KB)");
