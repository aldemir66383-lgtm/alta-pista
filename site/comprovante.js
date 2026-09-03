// Comprovante de inscrição.
//
// É a folha que o participante imprime e leva na retirada do kit. Toda corrida
// pede uma: a pessoa chega com o papel, a equipe confere o nome, bipa ou lê o
// código, entrega o kit e colhe a assinatura. Sem ela, a retirada vira procura
// em lista impressa — que é lento e erra.
//
// Vai em A4 retrato, porque é o papel que qualquer casa e qualquer escola tem,
// e sai legível em impressora simples: preto no branco, sem fundo colorido que
// gasta tinta. A única imagem é a capa do evento, numa faixa baixa no topo —
// e, se ela faltar ou não carregar, a folha continua inteira e legível.
//
// O QR carrega o código da inscrição, o mesmo do número de peito. Quem estiver
// na retirada pode bipar em vez de digitar.

import { QR } from "./qr.js";

const esc = t => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const linha = (rotulo, valor) => valor
  ? '<tr><th>' + esc(rotulo) + '</th><td>' + esc(valor) + '</td></tr>'
  : "";

/**
 * Monta o comprovante de uma inscrição.
 *
 * `d` reúne o que a folha mostra: os dados do evento, os do participante e a
 * situação do pagamento. Campos vazios simplesmente não aparecem — um evento
 * sem número de peito não deixa uma linha "Número: —" na folha.
 */
export function folhaComprovante(d) {
  let qr = "";
  try { qr = d.codigo ? QR.svg(d.codigo, 4) : ""; } catch (e) { qr = ""; }

  const pago = String(d.status || "") === "pago";
  const selo = pago
    ? '<span class="selo pago">PAGAMENTO CONFIRMADO</span>'
    : '<span class="selo pendente">PAGAMENTO PENDENTE</span>';

  return '<div class="comprovante">' +

    /* A capa do evento no topo. Não é enfeite: é o que faz a pessoa reconhecer
       de longe qual papel é qual quando leva três inscrições da família, e o
       que dá cara de evento àquele documento na mesa da retirada. Em faixa
       baixa, para não devorar tinta nem empurrar os dados para a página 2. */
    (d.imagemUrl
      ? '<div class="capa"><img src="' + esc(d.imagemUrl) + '" alt=""></div>'
      : "") +

    '<div class="cabeca">' +
      '<div>' +
        '<div class="org">' + esc(d.organizacao || "") + '</div>' +
        '<h1>' + esc(d.evento || "Evento") + '</h1>' +
        '<div class="quando">' + esc(d.quando || "") + '</div>' +
        (d.local ? '<div class="quando">' + esc(d.local) + '</div>' : "") +
      '</div>' +
      (qr ? '<div class="qr">' + qr + '<div class="codigo">' + esc(d.codigo) + '</div></div>' : "") +
    '</div>' +

    '<h2>Comprovante de inscrição</h2>' +
    '<table class="dados">' +
      linha("Participante", d.participante) +
      linha("Nascimento", d.nascimento) +
      linha("Número de peito", d.numero) +
      linha("Percurso", d.percurso) +
      linha("Categoria", d.categoria) +
      linha("Camiseta", d.camisa) +
      linha("Inscrito por", d.titular) +
      linha("Contato", d.contato) +
      linha("Lote", d.lote) +
      linha("Valor", d.valor) +
    '</table>' +

    '<div class="situacao">' + selo + '</div>' +

    (d.avisos ? '<div class="avisos">' + esc(d.avisos) + '</div>' : "") +

    '<div class="retirada">' +
      '<h3>Retirada do kit</h3>' +
      '<p>Apresente este comprovante e um documento com foto. Se outra pessoa ' +
      'for retirar por você, ela precisa levar este comprovante e a autorização ' +
      'que a organização exigir.</p>' +
      '<div class="assinaturas">' +
        '<div><span></span>Assinatura de quem retirou</div>' +
        '<div><span></span>Conferido pela organização</div>' +
      '</div>' +
    '</div>' +

  '</div>';
}

/** A página pronta para imprimir, com uma ou várias folhas. */
export function paginaDeComprovantes(folhas, titulo) {
  // Sem <script> aqui dentro: quem manda imprimir é a janela que abriu esta
  // página. Assim a política de segurança do site pode proibir script embutido
  // sem quebrar a impressão.
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(titulo || "Comprovante de inscrição") + '</title><style>' +
    '@page { size: A4 portrait; margin: 14mm; }' +
    'html,body{margin:0;padding:0;background:#f2f2f2;' +
      'font:13px/1.5 Helvetica,Arial,sans-serif;color:#111}' +
    '.aviso{padding:16px 20px;background:#fff;border-bottom:1px solid #ddd;color:#444}' +
    '.comprovante{background:#fff;padding:26px 28px;page-break-after:always;break-after:page}' +
    '.comprovante:last-child{page-break-after:auto;break-after:auto}' +
    '.capa{margin:-26px -28px 18px;height:112px;overflow:hidden;background:#eee}' +
    '.capa img{width:100%;height:112px;object-fit:cover;display:block}' +
    '@media print{.capa{margin:0 0 16px;height:96px}.capa img{height:96px}}' +
    '.cabeca{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;' +
      'border-bottom:2px solid #111;padding-bottom:14px}' +
    '.org{text-transform:uppercase;letter-spacing:.12em;font-size:10px;color:#555}' +
    '.cabeca h1{font-size:21px;margin:4px 0 6px;text-transform:uppercase}' +
    '.quando{font-size:12px;color:#333}' +
    '.qr{text-align:center;flex:0 0 auto}' +
    '.qr svg{width:104px;height:104px;display:block}' +
    '.codigo{font-family:"Courier New",monospace;font-size:14px;font-weight:bold;' +
      'letter-spacing:.06em;margin-top:4px}' +
    'h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:#555;' +
      'margin:20px 0 8px}' +
    'table.dados{width:100%;border-collapse:collapse}' +
    'table.dados th{text-align:left;width:170px;padding:7px 0;font-size:11px;' +
      'text-transform:uppercase;letter-spacing:.06em;color:#666;' +
      'border-bottom:1px solid #e6e6e6;vertical-align:top}' +
    'table.dados td{padding:7px 0;border-bottom:1px solid #e6e6e6;font-size:14px}' +
    '.situacao{margin:18px 0}' +
    '.selo{display:inline-block;border:2px solid #111;padding:7px 14px;' +
      'font-weight:bold;letter-spacing:.08em;font-size:12px}' +
    '.selo.pendente{border-style:dashed;color:#7a4a00;border-color:#7a4a00}' +
    '.avisos{white-space:pre-wrap;font-size:12px;color:#333;background:#f7f7f7;' +
      'border-left:3px solid #bbb;padding:10px 12px;margin:14px 0}' +
    '.retirada{margin-top:22px;border-top:1px dashed #999;padding-top:14px}' +
    '.retirada h3{font-size:12px;text-transform:uppercase;letter-spacing:.1em;' +
      'color:#555;margin:0 0 6px}' +
    '.retirada p{margin:0;font-size:12px;color:#333}' +
    '.assinaturas{display:flex;gap:26px;margin-top:34px}' +
    '.assinaturas div{flex:1;font-size:11px;color:#555;text-align:center}' +
    '.assinaturas span{display:block;border-top:1px solid #111;margin-bottom:5px}' +
    '@media print{.aviso{display:none}body{background:#fff}' +
      '.comprovante{padding:0}}' +
    '</style></head><body>' +
    '<div class="aviso">Use <b>Imprimir</b> no seu navegador, em papel A4. ' +
    'Este aviso não sai na impressão.</div>' +
    folhas.join("") +
    '</body></html>';
}
