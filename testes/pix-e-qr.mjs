// Testes do gerador de Pix e do gerador de QR Code.
//
// Estes dois são o caminho do dinheiro: se o código sair errado, a pessoa não
// consegue pagar, ou paga para a conta errada. São também os dois pedaços
// escritos do zero, sem biblioteca — então precisam de rede de proteção.
//
//   node testes/pix-e-qr.mjs
//
// Não toca no banco nem na internet. Roda em qualquer lugar, inclusive no CI.

import jsQR from "jsqr";
import { Pix } from "../site/pix.js";
import { QR } from "../site/qr.js";

const verde = t => "\x1b[32m" + t + "\x1b[0m";
const vermelho = t => "\x1b[31m" + t + "\x1b[0m";
const cinza = t => "\x1b[90m" + t + "\x1b[0m";

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log(verde("  ok  ") + nome); passou++; }
  catch (e) { console.log(vermelho("FALHOU  ") + nome + "\n        " + e.message); falhou++; }
}
const confere = (c, m) => { if (!c) throw new Error(m); };
const igual = (a, b, m) => { if (a !== b) throw new Error(m + " — esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a)); };

/** Quebra o BR Code em campos: cada um é id(2) + tamanho(2) + valor. */
function lerCampos(texto) {
  const campos = {};
  let i = 0;
  while (i < texto.length) {
    const id = texto.slice(i, i + 2);
    const tam = parseInt(texto.slice(i + 2, i + 4), 10);
    if (Number.isNaN(tam)) throw new Error("tamanho inválido no campo " + id);
    campos[id] = texto.slice(i + 4, i + 4 + tam);
    i += 4 + tam;
  }
  return campos;
}

console.log("\nBalcão de Inscrições — Pix e QR Code\n");
console.log("CRC-16, o dígito que valida o código inteiro:\n");

teste("bate com o vetor de referência do padrão CCITT-FALSE", () => {
  // "123456789" é o vetor canônico usado para conferir implementações
  igual(Pix.crc16("123456789"), "29B1", "CRC do vetor de referência");
});

teste("muda quando o conteúdo muda", () => {
  confere(Pix.crc16("ABC") !== Pix.crc16("ABD"), "dois textos diferentes deram o mesmo CRC");
});

console.log("\nO código Pix montado:\n");

const cobranca = {
  chave: "corrida@escola.edu.br",
  beneficiario: "ASSOC PAIS E MESTRES",
  cidade: "CAMPINA GRANDE",
  centavos: 3500,
  txid: "K5WLVD"
};
const codigo = Pix.brcode(cobranca);

teste("o CRC no fim confere com o resto do código", () => {
  igual(Pix.crc16(codigo.slice(0, -4)), codigo.slice(-4), "CRC do código gerado");
});

teste("tem a estrutura de campos do Banco Central", () => {
  const c = lerCampos(codigo);
  igual(c["00"], "01", "versão do formato");
  igual(c["52"], "0000", "código de categoria");
  igual(c["53"], "986", "moeda (986 = real)");
  igual(c["58"], "BR", "país");
});

teste("carrega a chave Pix dentro do campo do arranjo", () => {
  const c = lerCampos(codigo);
  const dentro = lerCampos(c["26"]);
  igual(dentro["00"], "br.gov.bcb.pix", "identificador do arranjo");
  igual(dentro["01"], cobranca.chave, "chave Pix");
});

teste("o valor vai em reais com duas casas", () => {
  igual(lerCampos(codigo)["54"], "35.00", "valor");
});

teste("o identificador da inscrição viaja no código", () => {
  igual(lerCampos(lerCampos(codigo)["62"])["05"], "K5WLVD", "txid");
});

teste("evento gratuito não leva campo de valor", () => {
  const g = Pix.brcode({ ...cobranca, centavos: 0 });
  confere(!("54" in lerCampos(g)), "código gratuito não deveria ter o campo 54");
  igual(Pix.crc16(g.slice(0, -4)), g.slice(-4), "CRC do código gratuito");
});

teste("nome e cidade respeitam o limite do padrão", () => {
  const c = lerCampos(Pix.brcode({
    ...cobranca,
    beneficiario: "ASSOCIACAO DE PAIS E MESTRES DA ESCOLA MUNICIPAL",
    cidade: "SAO JOSE DOS CAMPOS DO NORTE"
  }));
  confere(c["59"].length <= 25, "nome do recebedor passou de 25: " + c["59"].length);
  confere(c["60"].length <= 15, "cidade passou de 15: " + c["60"].length);
});

teste("acentos e símbolos são removidos do nome", () => {
  const c = lerCampos(Pix.brcode({ ...cobranca, beneficiario: "Associação São João & Cia" }));
  confere(/^[A-Z0-9 .\-]*$/.test(c["59"]), "sobrou caractere fora do permitido: " + c["59"]);
  confere(/ASSOCIACAO/.test(c["59"]), "o nome deveria continuar reconhecível: " + c["59"]);
});

teste("campo vazio não quebra a montagem", () => {
  const v = Pix.brcode({ chave: "x@y.com", beneficiario: "", cidade: "", centavos: 100, txid: "" });
  igual(Pix.crc16(v.slice(0, -4)), v.slice(-4), "CRC com campos vazios");
  const c = lerCampos(v);
  confere(c["59"].length > 0, "deveria cair num nome padrão");
  confere(c["60"].length > 0, "deveria cair numa cidade padrão");
});

console.log("\nO QR Code, lido de volta por biblioteca independente:\n");

function leituraDeVolta(texto, escala = 8, borda = 4) {
  const m = QR.matriz(texto);
  const n = m.length, dim = (n + borda * 2) * escala;
  const px = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const lr = Math.floor(y / escala) - borda, lc = Math.floor(x / escala) - borda;
    const escuro = lr >= 0 && lr < n && lc >= 0 && lc < n && m[lr][lc];
    const v = escuro ? 0 : 255, i = (y * dim + x) * 4;
    px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
  }
  const r = jsQR(px, dim, dim);
  return r ? r.data : null;
}

const casos = [
  ["o código Pix de uma inscrição real", codigo],
  ["o endereço do site", "https://alta-pista.netlify.app"],
  ["texto curtíssimo", "A"],
  ["acentos e pontuação", "Corrida da Escola — inscrições abertas! (5 km / 10 km)"],
  ["conteúdo longo", "x".repeat(300)],
  ["no limite do que cabe", "y".repeat(412)]
];
for (const [nome, texto] of casos) {
  teste(nome, () => igual(leituraDeVolta(texto), texto, "o que foi lido não bate com o que foi gerado"));
}

teste("recusa conteúdo grande demais em vez de gerar lixo", () => {
  let recusou = false;
  try { QR.matriz("z".repeat(500)); } catch (e) { recusou = true; }
  confere(recusou, "deveria ter recusado, não gerado um QR ilegível");
});

teste("o desenho tem a zona de silêncio nas bordas", () => {
  const svg = QR.svg("teste", 4);
  const vb = (svg.match(/viewBox="0 0 (\d+) /) || [])[1];
  const lado = QR.matriz("teste").length;
  igual(Number(vb), lado + 8, "a margem de 4 módulos de cada lado");
});

/* ------------------------------------------------------------- resumo --- */
console.log("\n" + (passou + falhou) + " testes · " + verde(passou + " passaram") +
  (falhou ? " · " + vermelho(falhou + " falharam") : ""));
if (falhou) {
  console.log(vermelho("\nO caminho do pagamento está com problema. Não use até resolver.\n"));
  process.exit(1);
}
console.log(verde("\nPix e QR conferem.\n"));
