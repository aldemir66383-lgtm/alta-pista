/* ============================================================
   0024 - Pendente vira cancelada em 24 horas

   O prazo era de 48 horas. Passa a ser 24: a vaga presa por
   quem desistiu é vaga que a fila não recebe.

   Mas com uma trava nova, e ela é o ponto importante deste
   arquivo: **inscrição com comprovante anexado não é
   cancelada pelo relógio**.

   Sem isso, os dois recursos brigariam entre si. Alguém paga
   às 23h, anexa o comprovante, e a organização só abre o
   Painel no dia seguinte à tarde — o relógio cancelaria uma
   inscrição paga, com a prova do pagamento anexada e visível
   na tela. Quando existe comprovante, quem decide é uma
   pessoa olhando, não o cron.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

create or replace function public.expirar_pendencias(p_horas integer default 24)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  -- Quem chama: ou o pg_cron / SQL Editor (sem usuario, auth.uid() nulo),
  -- ou um organizador logado. Um usuario comum nao.
  if auth.uid() is not null and not public.eh_organizador() then
    raise exception 'Apenas a organizacao pode rodar isto.' using errcode = '42501';
  end if;

  update public.inscricoes i
     set status = 'cancelada'
   where i.status = 'pendente'
     and i.valor_centavos > 0
     and i.pago_em is null
     and i.criado_em < now() - make_interval(hours => greatest(coalesce(p_horas, 24), 1))
     -- Quem anexou comprovante sai da mão do relógio. Ver o cabeçalho.
     and not exists (
       select 1 from public.comprovantes_pagamento c where c.inscricao_id = i.id
     );

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.expirar_pendencias(integer) from public;
grant execute on function public.expirar_pendencias(integer) to authenticated;

/* O agendamento de hora em hora continua igual; só o número muda. */
do $$
begin
  create extension if not exists pg_cron;

  if exists (select 1 from cron.job where jobname = 'balcao-expirar-pendencias') then
    perform cron.unschedule('balcao-expirar-pendencias');
  end if;

  perform cron.schedule(
    'balcao-expirar-pendencias',
    '17 * * * *',                       -- todo minuto 17 de cada hora
    $cron$ select public.expirar_pendencias(24); $cron$
  );

  raise notice 'pg_cron reagendado: agora com 24 horas.';
exception when others then
  raise notice 'Nao consegui reagendar pelo pg_cron (%). Ligue-o em Database > Extensions e rode de novo. O site ainda chama a funcao ao abrir o Painel.', sqlerrm;
end $$;
