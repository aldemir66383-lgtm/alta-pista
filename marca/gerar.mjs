// Gera a marca da Alta Pista: os SVG e os PNG, em todos os tamanhos.
//
//   node marca/gerar.mjs
//
// O monograma é geometria pura — nenhuma tipografia, nenhuma biblioteca.
// O mesmo desenho serve ao SVG e ao rasterizador daqui de baixo, então os
// dois nunca saem diferentes um do outro.

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI    = dirname(fileURLToPath(import.meta.url));
const ACENTO  = "#C6F24E";
const BASE    = "#0B1B2B";
const BRANCO  = "#FFFFFF";

/* ====================================================== o desenho ==== */

/* Inclinação para a frente: é o gesto de quem corre, e é o que separa a
   marca de um monograma parado qualquer. */
const INCLINACAO = -7 * Math.PI / 180;
const DESLOCA    = 11;
/* O desenho nasce ocupando a caixa inteira. Encolher e recentrar deixa a
   margem que separa um logotipo de um adesivo. */
const ESCALA     = 0.82;
const CENTRO     = 50;

/* O A e o P dividem a mesma haste vertical, em uma caixa de 100 por 100. */
const DIAGONAL  = [[8, 79], [24, 79], [52, 21], [36, 21]];
const HASTE     = [50, 21, 16, 58];                 // x, y, largura, altura
const TRAVESSAO = [[22, 57], [52, 57], [52, 69], [16, 69]];
const BOJO      = { x0: 63, x1: 76, y0: 21, y1: 53, cx: 76, cy: 37, r: 16 };
const OLHO      = { x0: 66, x1: 75, y0: 32, y1: 42, cx: 75, cy: 37, r: 5 };

export function monogramaSVG(tinta) {
  const pol = p => p.map((c, i) => (i ? "L" : "M") + c[0] + "," + c[1]).join(" ") + " Z";
  return `<g transform="translate(${CENTRO},${CENTRO}) scale(${ESCALA}) translate(${-CENTRO},${-CENTRO})">` +
    `<g transform="translate(${DESLOCA},0) skewX(-7)">` +
    `<path fill="${tinta}" d="${pol(DIAGONAL)}"/>` +
    `<rect x="${HASTE[0]}" y="${HASTE[1]}" width="${HASTE[2]}" height="${HASTE[3]}" fill="${tinta}"/>` +
    `<path fill="${tinta}" d="${pol(TRAVESSAO)}"/>` +
    `<path fill="${tinta}" fill-rule="evenodd" d="` +
      `M${BOJO.x0},${BOJO.y0} H${BOJO.x1} A${BOJO.r},${BOJO.r} 0 0 1 ${BOJO.x1},${BOJO.y1} H${BOJO.x0} Z ` +
      `M${OLHO.x0},${OLHO.y0} H${OLHO.x1} A${OLHO.r},${OLHO.r} 0 0 1 ${OLHO.x1},${OLHO.y1} H${OLHO.x0} Z"/>` +
  `</g></g>`;
}

/* ------- o mesmo desenho, agora como pergunta: este ponto é tinta? ---- */

function dentroDoPoligono(pontos, x, y) {
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const [xi, yi] = pontos[i], [xj, yj] = pontos[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

const dentroDaCaixa = (c, x, y) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1;
const dentroDaMeiaLua = (c, x, y) =>
  x > c.x1 && (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2;

/** Verdadeiro se o ponto (x,y), já na caixa de 100 por 100, é tinta. */
export function ehTinta(xc, yc) {
  // desfaz a escala e depois a inclinação: o desenho é inclinado e
  // encolhido, a pergunta não precisa ser
  const x = (xc - CENTRO) / ESCALA + CENTRO;
  const y = (yc - CENTRO) / ESCALA + CENTRO;
  const px = x - DESLOCA - y * Math.tan(INCLINACAO);
  const py = y;

  if (dentroDoPoligono(DIAGONAL, px, py)) return true;
  if (px >= HASTE[0] && px <= HASTE[0] + HASTE[2] &&
      py >= HASTE[1] && py <= HASTE[1] + HASTE[3]) return true;
  if (dentroDoPoligono(TRAVESSAO, px, py)) return true;

  const noBojo = dentroDaCaixa(BOJO, px, py) || dentroDaMeiaLua(BOJO, px, py);
  if (noBojo) {
    const noOlho = dentroDaCaixa(OLHO, px, py) || dentroDaMeiaLua(OLHO, px, py);
    return !noOlho;
  }
  return false;
}

/** Verdadeiro se o ponto está dentro do selo (quadrado de cantos redondos). */
export function dentroDoSelo(x, y, raio, redondo) {
  if (redondo) return (x - 50) ** 2 + (y - 50) ** 2 <= 50 ** 2;
  const dx = Math.max(raio - x, 0, x - (100 - raio));
  const dy = Math.max(raio - y, 0, y - (100 - raio));
  if (dx === 0 || dy === 0) return x >= 0 && x <= 100 && y >= 0 && y <= 100;
  return dx * dx + dy * dy <= raio * raio;
}

/* ==================================================== o PNG cru ====== */

const tabelaCRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(b) {
  let c = 0xffffffff;
  for (const x of b) c = tabelaCRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const t = Buffer.from(tipo, "ascii");
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
  return Buffer.concat([tam, t, dados, c]);
}

/** PNG de 8 bits com canal alfa, a partir de uma função (x,y) -> [r,g,b,a]. */
export function png(lado, cor) {
  const linhas = [];
  for (let y = 0; y < lado; y++) {
    const linha = Buffer.alloc(1 + lado * 4);
    for (let x = 0; x < lado; x++) {
      const [r, g, b, a] = cor(x, y);
      const i = 1 + x * 4;
      linha[i] = r; linha[i + 1] = g; linha[i + 2] = b; linha[i + 3] = a;
    }
    linhas.push(linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 bits por canal, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(Buffer.concat(linhas), { level: 9 })),
    bloco("IEND", Buffer.alloc(0))
  ]);
}

export const hexPara = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/**
 * Desenha o selo em PNG. Cada pixel é olhado em 16 pontos (4 por 4) e a
 * média vira a cor: é assim que a borda sai lisa em vez de serrilhada.
 */
export function seloPNG(lado, fundo, tinta, { redondo = false, raio = 22 } = {}) {
  const AMOSTRAS = 4;
  const cFundo = fundo ? hexPara(fundo) : null;
  const cTinta = hexPara(tinta);
  return png(lado, (px, py) => {
    let nFundo = 0, nTinta = 0;
    for (let sy = 0; sy < AMOSTRAS; sy++) {
      for (let sx = 0; sx < AMOSTRAS; sx++) {
        const x = ((px + (sx + 0.5) / AMOSTRAS) / lado) * 100;
        const y = ((py + (sy + 0.5) / AMOSTRAS) / lado) * 100;
        const noSelo = dentroDoSelo(x, y, raio, redondo);
        if (!noSelo) continue;
        if (ehTinta(x, y)) nTinta++; else nFundo++;
      }
    }
    const total = AMOSTRAS * AMOSTRAS;
    const aTinta = nTinta / total;
    const aFundo = nFundo / total;
    if (!cFundo) {
      // sem fundo: só a tinta, o resto transparente
      return [...cTinta, Math.round(aTinta * 255)];
    }
    const alfa = aTinta + aFundo;
    if (alfa === 0) return [0, 0, 0, 0];
    const mistura = i => Math.round((cTinta[i] * aTinta + cFundo[i] * aFundo) / alfa);
    return [mistura(0), mistura(1), mistura(2), Math.round(alfa * 255)];
  });
}

/* ================================================== os arquivos ====== */

export function seloSVG(fundo, tinta, { redondo = false, raio = 22 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ` +
    `role="img" aria-label="Alta Pista">` +
    (fundo
      ? (redondo
          ? `<circle cx="50" cy="50" r="50" fill="${fundo}"/>`
          : `<rect width="100" height="100" rx="${raio}" fill="${fundo}"/>`)
      : "") +
    monogramaSVG(tinta) + `</svg>`;
}

export function assinaturaSVG(tintaTexto) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 430 110" ` +
    `role="img" aria-label="Alta Pista">` +
    `<g transform="translate(5,5)"><rect width="100" height="100" rx="22" fill="${ACENTO}"/>` +
    monogramaSVG(BASE) + `</g>` +
    `<text x="124" y="58" font-family="Titillium Web, Segoe UI, Helvetica, Arial, sans-serif" ` +
      `font-size="42" font-weight="900" letter-spacing="-0.5" fill="${tintaTexto}">ALTA PISTA</text>` +
    `<text x="126" y="84" font-family="Titillium Web, Segoe UI, Helvetica, Arial, sans-serif" ` +
      `font-size="14" font-weight="600" letter-spacing="5.4" fill="${tintaTexto}" opacity="0.62">` +
      `INSCRIÇÕES ESPORTIVAS</text></svg>`;
}

/* So escreve os arquivos quando chamado direto pela linha de comando.
   Assim outro script pode importar o desenho sem gerar nada. */
if (pathToFileURL(process.argv[1] || "").href === import.meta.url) {
  mkdirSync(AQUI, { recursive: true });
  const gravar = (nome, dados) => {
    writeFileSync(join(AQUI, nome), dados);
    return nome;
  };

  const feitos = [];

  feitos.push(gravar("selo-lima.svg",  seloSVG(ACENTO, BASE) + "\n"));
  feitos.push(gravar("selo-base.svg",  seloSVG(BASE, ACENTO) + "\n"));
  feitos.push(gravar("selo-preto.svg",    seloSVG("", BASE) + "\n"));
  feitos.push(gravar("selo-branco.svg",   seloSVG("", BRANCO) + "\n"));
  feitos.push(gravar("selo-redondo.svg",  seloSVG(ACENTO, BASE, { redondo: true }) + "\n"));
  feitos.push(gravar("assinatura-clara.svg",  assinaturaSVG(BASE) + "\n"));
  feitos.push(gravar("assinatura-escura.svg", assinaturaSVG(BRANCO) + "\n"));

  for (const lado of [512, 256, 128, 64, 32]) {
    feitos.push(gravar(`selo-lima-${lado}.png`, seloPNG(lado, ACENTO, BASE)));
  }
  feitos.push(gravar("selo-redondo-512.png", seloPNG(512, ACENTO, BASE, { redondo: true })));
  feitos.push(gravar("selo-base-512.png", seloPNG(512, BASE, ACENTO)));
  feitos.push(gravar("selo-transparente-512.png", seloPNG(512, "", BASE)));

  console.log("marca: " + feitos.length + " arquivos");
  console.log(feitos.join("\n"));
}
