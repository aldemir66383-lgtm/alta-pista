/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0011 - Quatro algarismos como padrao                        */
/*                                                              */
/*  O numero de peito passa a sair como 0007, nao como 7.        */
/*  E o formato usado em corrida: alinha na folha, ocupa sempre  */
/*  a mesma largura, e numero de um algarismo sozinho fica       */
/*  pequeno demais na foto de chegada.                           */
/*                                                              */
/*  Cole no SQL Editor e clique em Run.                          */
/* ============================================================ */

alter table public.eventos
  alter column numero_digitos set default 4;

/*  Alcanca so quem estava no zero, que era o padrao antigo.     */
/*  Se voce ja escolheu outra quantidade em algum evento, ela e  */
/*  preservada.                                                   */
update public.eventos
   set numero_digitos = 4
 where numero_digitos = 0;

/* ============================================================ */
