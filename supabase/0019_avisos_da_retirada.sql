/* ============================================================
   0019 - Avisos da retirada do kit, por evento

   O comprovante de inscricao e a folha que a pessoa imprime e
   leva na retirada do kit. Cada evento tem as proprias regras -
   onde retirar, em que horario, o que levar, se terceiro pode
   retirar - e esse texto precisa sair impresso junto, senao a
   organizacao repete a mesma explicacao no WhatsApp cem vezes.

   Uma coluna de texto livre resolve: o que o organizador
   escrever aqui aparece no comprovante daquele evento.

   Idempotente: pode rodar de novo a vontade.
   ============================================================ */

alter table public.eventos
  add column if not exists retirada_avisos text not null default '';

comment on column public.eventos.retirada_avisos is
  'Texto livre impresso no comprovante: onde e quando retirar o kit, o que levar.';
