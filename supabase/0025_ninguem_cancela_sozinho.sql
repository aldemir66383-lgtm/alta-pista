/* ============================================================
   0025 - Ninguém cancela sozinho

   A 0024 pôs o prazo em 24 horas e mandou o pg_cron cancelar as
   pendentes vencidas de hora em hora. Está errado, e o motivo é
   do negócio, não do código: no Pix com conferência manual
   existe sempre uma janela em que a pessoa JÁ PAGOU e o sistema
   ainda não sabe. Uma rotina que cancela sozinha dentro dessa
   janela cancela a inscrição de alguém que pagou — e quem paga
   uma corrida e descobre no dia que a inscrição sumiu não volta.

   A partir daqui, o prazo de 24 horas continua existindo e
   continua valendo, mas quem cancela é uma pessoa. O Painel
   mostra as vencidas em destaque, com o comprovante ao lado
   quando existe, e a organização decide uma a uma — ou todas de
   uma vez, depois de conferir.

   A função continua aqui, intacta: ela deixa de ser um relógio
   e passa a ser um botão.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

/* ==== 1. Desligar o relógio ==== */
do $$
begin
  if exists (select 1 from cron.job where jobname = 'balcao-expirar-pendencias') then
    perform cron.unschedule('balcao-expirar-pendencias');
    raise notice 'Pronto: o cancelamento automatico foi desligado.';
  else
    raise notice 'Nada a desligar: o cancelamento automatico ja nao estava agendado.';
  end if;
exception when others then
  raise notice 'Nao consegui mexer no agendamento (%). Se o pg_cron nem esta ligado, nao ha relogio nenhum rodando — que e justamente o que queremos.', sqlerrm;
end $$;

/* ==== 2. Deixar registrado para quem ler isto depois ==== */
comment on function public.expirar_pendencias(integer) is
  'Cancela as inscricoes pendentes vencidas. NAO roda sozinha: e chamada pelo '
  'botao do Painel, depois de a organizacao conferir. Ver 0025.';
