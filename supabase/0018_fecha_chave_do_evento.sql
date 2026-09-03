/* ============================================================
   0018 - Fecha a chave Pix do evento para quem não tem conta

   Regressão introduzida pela 0016. A chave Pix passou a morar em
   `eventos`, e essa tabela é legível pelo público quando o evento
   está publicado — a política diz "publicado or organizador or
   dono". Resultado: qualquer visitante conseguia ler a chave Pix
   e o nome do recebedor sem sequer ter conta. Quando a chave é um
   CPF, como costuma ser, isso é dado pessoal na internet aberta.

   O site público nunca precisou dessas colunas: a lista e a página
   do evento vêm das funções `eventos_publicos()` e
   `evento_publico()`, que devolvem campo a campo e nunca
   incluíram a chave. Quem monta a cobrança é `cobranca()`, que
   confere se a inscrição é de quem pediu antes de devolver
   qualquer coisa.

   Então basta tirar a permissão de leitura dessas três colunas do
   papel `anon`. Nada do que existe deixa de funcionar.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

revoke select (chave_pix, recebedor_nome, recebedor_cidade)
  on public.eventos from anon;

/* O organizador continua lendo e escrevendo pelo Painel: ele entra com conta,
   e o papel `authenticated` mantém o acesso. A política de linha continua
   valendo por cima disso. */
