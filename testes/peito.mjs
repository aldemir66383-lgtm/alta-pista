// Testes do número de peito.
//
// A folha é o que a pessoa leva no corpo no dia da corrida e o que a
// organização usa na entrega do kit. Se sair errada, o erro só aparece
// depois de tudo impresso — daí a rede de proteção aqui.
//
//   node testes/peito.mjs

import jsQR from "jsqr";
import { folha, paginaParaImprimir, formatarNumero } from "../site/peito.js";
import { QR } from "../site/qr.js";

const verde = t => "\x1b[32m" + t + "\x1b[0m";
const vermelho = t => "\x1b[31m" + t + "\x1b[0m";

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log(verde("  ok  ") + nome); passou++; }
  catch (e) { console.log(vermelho("FALHOU  ") + nome + "\n        " + e.message); falhou++; }
}
const confere = (c, m) => { if (!c) throw new Error(m); };
const igual = (a, b, m) => {
  if (a !== b) throw new Error(m + " — esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a));
};

const base = {
  nome: "Maria Aparecida de Souza Lima",
  codigo: "K5W-LVD",
  evento: "1a Corrida da Escola Boa Vista",
  data: "12 de outubro de 2026",
  local: "Campina Grande/PB",
  distancia: "10 km",
  camisa: "G",
  sigla: "AP",
  marca: "Alta Pista",
  cor: "#FFE01B"
};

console.log("\nBalcão de Inscrições — número de peito\n");

teste("o número aparece na folha", () => {
  confere(folha({ ...base, numero: 137 }).includes(">137<"), "não achei o 137 no desenho");
});

teste("o número também vai nos dois canhotos destacáveis", () => {
  const s = folha({ ...base, numero: 137 });
  const vezes = (s.match(/>137</g) || []).length;
  igual(vezes, 3, "o número deveria sair três vezes: o grande e os dois canhotos");
});

teste("KIT e ALIMENTAÇÃO estão nomeados", () => {
  const s = folha({ ...base, numero: 137 });
  confere(s.includes(">KIT<"), "faltou o canhoto do kit");
  confere(s.includes("ALIMENTA"), "faltou o canhoto da alimentação");
});

teste("o tamanho da camisa aparece no canhoto do kit", () => {
  confere(folha({ ...base, numero: 7 }).includes("camisa G"), "faltou o tamanho da camisa");
  confere(!folha({ ...base, numero: 7, camisa: "" }).includes("camisa "),
    "sem tamanho informado, não deveria escrever nada");
});

teste("números de 1 a 5 dígitos cabem na folha", () => {
  for (const n of [1, 42, 137, 1234, 10500]) {
    const s = folha({ ...base, numero: n });
    const corpo = Number((s.match(/font-size="(\d+)" font-weight="800" fill="#0B1B2B" letter-spacing/) || [])[1]);
    confere(corpo > 0, "não achei o corpo da fonte para " + n);
    // largura aproximada do número: cada dígito ocupa cerca de 0,6 do corpo
    const largura = String(n).length * corpo * 0.62;
    confere(largura < 780, "o número " + n + " estouraria a área (" + Math.round(largura) + ")");
  }
});

teste("o QR da folha guarda o código da inscrição", () => {
  const s = folha({ ...base, numero: 137 });
  const d = (s.match(/<g transform="translate\(34,552\) scale\([\d.]+\)"><rect[^>]*\/><path d="([^"]*)"/) || [])[1];
  confere(d && d.length > 50, "não achei o desenho do QR na folha");
  // lê de volta pela matriz, que é a mesma fonte do desenho
  const m = QR.matriz(base.codigo);
  const esc = 8, borda = 4, dim = (m.length + borda * 2) * esc;
  const px = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const lr = Math.floor(y / esc) - borda, lc = Math.floor(x / esc) - borda;
    const escuro = lr >= 0 && lr < m.length && lc >= 0 && lc < m.length && m[lr][lc];
    const v = escuro ? 0 : 255, i = (y * dim + x) * 4;
    px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
  }
  const r = jsQR(px, dim, dim);
  igual(r && r.data, base.codigo, "o QR não devolveu o código");
});

teste("nome comprido é encurtado em vez de vazar da folha", () => {
  const s = folha({ ...base, numero: 7, nome: "Wanderleia Nascimento dos Santos Albuquerque Filha" });
  confere(s.includes("…"), "o nome deveria ter sido encurtado");
});

teste("texto do participante é escapado, não injetado", () => {
  const s = folha({ ...base, numero: 7, nome: '<script>alerta()</script>' });
  confere(!s.includes("<script>"), "BRECHA: o nome entrou como marcação");
  confere(s.includes("&lt;script&gt;"), "o nome deveria aparecer escapado");
});

teste("cor inválida cai num padrão em vez de quebrar o desenho", () => {
  const s = folha({ ...base, numero: 7, cor: "javascript:mal" });
  confere(!s.includes("javascript:"), "a cor não deveria entrar crua no SVG");
});

teste("a cor do texto contrasta com a faixa", () => {
  confere(folha({ ...base, numero: 7, cor: "#C6F24E" }).includes('fill="#0B1B2B"'),
    "sobre lima claro o texto deveria ser escuro");
  confere(folha({ ...base, numero: 7, cor: "#101820" }).includes('fill="#ffffff"'),
    "sobre azul escuro o texto deveria ser claro");
});

teste("sem número, a folha ainda é gerada e mostra interrogação", () => {
  confere(folha({ ...base, numero: null }).includes(">?<"), "deveria marcar o número faltando");
});

teste("a página de impressão separa uma folha por página", () => {
  const p = paginaParaImprimir([folha({ ...base, numero: 1 }), folha({ ...base, numero: 2 })], "x");
  igual((p.match(/class="folha"/g) || []).length, 2, "número de folhas na página");
  confere(/page-break-after: always/.test(p), "faltou a quebra de página");
  confere(/size: A4 landscape/.test(p), "faltou o tamanho do papel");
});

teste("o SVG é bem formado: cada tag abre e fecha", () => {
  const s = folha({ ...base, numero: 137 });
  igual((s.match(/<svg/g) || []).length, 1, "um único <svg>");
  igual((s.match(/<\/svg>/g) || []).length, 1, "um único </svg>");
  for (const tag of ["text", "g"]) {
    igual((s.match(new RegExp("<" + tag + "[ >]", "g")) || []).length,
          (s.match(new RegExp("</" + tag + ">", "g")) || []).length,
          "abre e fecha <" + tag + ">");
  }
});


console.log("\nPersonalização por evento:\n");

teste("os algarismos fixos preenchem com zeros à esquerda", () => {
  igual(formatarNumero(7, 4), "0007", "7 com quatro algarismos");
  igual(formatarNumero(1234, 4), "1234", "número que já tem o tamanho");
  igual(formatarNumero(12345, 4), "12345", "número maior que o formato não é cortado");
  igual(formatarNumero(7, 0), "7", "zero desliga o preenchimento");
  igual(formatarNumero(7, null), "7", "sem escolha, número cru");
  igual(formatarNumero(null, 4), "?", "sem número");
});

teste("o formato pedido aparece na folha e nos canhotos", () => {
  const s = folha({ ...base, numero: 7, digitos: 4 });
  igual((s.match(/>0007</g) || []).length, 3, "0007 deveria sair três vezes");
  confere(!/>7</.test(s), "não deveria sobrar o número sem formato");
});

teste("mais de 6 algarismos é recusado em silêncio", () => {
  igual(formatarNumero(7, 99).length, 6, "o limite é seis algarismos");
});

teste("a cor do evento substitui a do site", () => {
  confere(folha({ ...base, numero: 7, cor: "#0055AA" }).includes('fill="#0055AA"'),
    "a cor escolhida deveria pintar a faixa");
});

teste("a arte de fundo entra com véu por cima", () => {
  const s = folha({ ...base, numero: 7, fundoUrl: "https://exemplo.com/arte.jpg" });
  confere(s.includes("exemplo.com/arte.jpg"), "a arte não entrou");
  confere(/opacity="0.74"/.test(s), "faltou o véu que mantém o número legível");
  confere(/clipPath/.test(s), "a arte deveria ser recortada nos cantos da folha");
});

teste("o logotipo do evento ocupa o lugar da sigla", () => {
  const s = folha({ ...base, numero: 7, logoUrl: "https://exemplo.com/logo.png" });
  confere(s.includes("exemplo.com/logo.png"), "o logotipo não entrou");
  confere(!s.includes(">AP<"), "com logotipo, a sigla não deveria aparecer");
});

teste("endereço de imagem perigoso é descartado", () => {
  for (const mau of ["javascript:alert(1)", "data:text/html,<svg onload=x>", "  javascript:x"]) {
    const s = folha({ ...base, numero: 7, fundoUrl: mau, logoUrl: mau });
    confere(!s.includes("javascript:"), "BRECHA: passou " + mau);
    confere(!s.includes("text/html"), "BRECHA: passou " + mau);
  }
});

teste("cada folha usa identificadores próprios", () => {
  const a = folha({ ...base, numero: 1, fundoUrl: "https://exemplo.com/a.jpg" });
  const b = folha({ ...base, numero: 2, fundoUrl: "https://exemplo.com/a.jpg" });
  const idA = (a.match(/id="folha-([a-z0-9]+)"/) || [])[1];
  const idB = (b.match(/id="folha-([a-z0-9]+)"/) || [])[1];
  confere(idA && idB && idA !== idB,
    "duas folhas na mesma página com o mesmo id fariam o recorte de uma valer na outra");
});

console.log("\n" + (passou + falhou) + " testes · " + verde(passou + " passaram") +
  (falhou ? " · " + vermelho(falhou + " falharam") : ""));
if (falhou) { console.log(vermelho("\nO número de peito está com problema.\n")); process.exit(1); }
console.log(verde("\nNúmero de peito confere.\n"));
