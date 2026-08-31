// Gera o cartão de compartilhamento: a imagem que aparece quando alguém joga
// o endereço do site num grupo de WhatsApp.
//
//   node marca/gerar-cartao.mjs
//
// Sem tipografia de propósito. O título e a descrição quem escreve são as
// tags do próprio index.html — o WhatsApp mostra os dois ao lado da imagem.
// Assim a imagem nunca fica desmentindo o texto, e não depende de fonte
// instalada nem de biblioteca nenhuma.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { png, ehTinta, hexPara } from "./gerar.mjs";

const AQUI   = dirname(fileURLToPath(import.meta.url));
const ACENTO = hexPara("#C6F24E");
const BASE   = hexPara("#0B1B2B");

const LARGURA = 1200;   // medida que o WhatsApp, o Facebook e o
const ALTURA  =  630;   // Telegram esperam para o cartão grande
const AMOSTRAS = 3;     // 3x3 pontos por pixel: borda lisa, sem serrilhado

/* O monograma ocupa a altura confortável e fica no centro: se algum
   aplicativo cortar a imagem em quadrado, o desenho continua inteiro. */
const LADO_SELO = 300;
const ESQ = (LARGURA - LADO_SELO) / 2;
const TOPO = (ALTURA - LADO_SELO) / 2 - 14;
const FAIXA = 12;       // filete de acento na base, como o do cabeçalho

const cartao = png(LARGURA, (px, py) => {
  if (py >= ALTURA - FAIXA) return [...ACENTO, 255];

  let dentro = 0;
  for (let sy = 0; sy < AMOSTRAS; sy++) {
    for (let sx = 0; sx < AMOSTRAS; sx++) {
      const x = ((px + (sx + 0.5) / AMOSTRAS) - ESQ) / LADO_SELO * 100;
      const y = ((py + (sy + 0.5) / AMOSTRAS) - TOPO) / LADO_SELO * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) continue;
      if (ehTinta(x, y)) dentro++;
    }
  }
  const a = dentro / (AMOSTRAS * AMOSTRAS);
  if (a === 0) return [...BASE, 255];
  const mistura = i => Math.round(ACENTO[i] * a + BASE[i] * (1 - a));
  return [mistura(0), mistura(1), mistura(2), 255];
}, ALTURA);

const destino = join(AQUI, "..", "site", "cartao.png");
writeFileSync(destino, cartao);
console.log("cartao.png  " + LARGURA + "x" + ALTURA + "  " +
  (cartao.length / 1024).toFixed(1) + " kB");
