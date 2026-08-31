/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0013 - Devolver a vaga de quem nao pagou                    */
/*                                                              */
/*  Uma inscricao "pendente" segura uma vaga. Se a pessoa       */
/*  desistiu e nunca pagou, essa vaga fica presa. Esta funcao   */
/*  cancela as pendentes com mais de 48h e devolve a vaga para  */
/*  a fila.                                                     */
/*                                                              */
/*  Ela roda de tres formas, todas de graca:                    */
/*   - sozinha, de hora em hora, pelo pg_cron (configurado      */
/*     aqui embaixo);                                           */
/*   - toda vez que um organizador abre o Painel (o site chama  */
/*     no carregamento);                                        */
/*   - na mao, rodando  select public.expirar_pendencias();     */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run. Idempotente.*/
/* ============================================================ */


/* ==== 1. A funcao ==== */

create or replace function public.expirar_pendencias(p_horas integer default 48)
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

  update public.inscricoes
     set status = 'cancelada'
   where status = 'pendente'
     and valor_centavos > 0
     and pago_em is null
     and criado_em < now() - make_interval(hours => greatest(coalesce(p_horas, 48), 1));

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.expirar_pendencias(integer) from public;
grant execute on function public.expirar_pendencias(integer) to authenticated;


/* ==== 2. Agendamento automatico (pg_cron) ==== */
/*  Se o "create extension" falhar, ligue o pg_cron uma vez em    */
/*  Database > Extensions no painel do Supabase e rode este       */
/*  arquivo de novo. O site continua chamando a funcao ao abrir   */
/*  o Painel de qualquer forma, entao isto e so o reforco.        */

do $$
begin
  create extension if not exists pg_cron;

  if exists (select 1 from cron.job where jobname = 'balcao-expirar-pendencias') then
    perform cron.unschedule('balcao-expirar-pendencias');
  end if;

  perform cron.schedule(
    'balcao-expirar-pendencias',
    '17 * * * *',                       -- todo minuto 17 de cada hora
    $cron$ select public.expirar_pendencias(48); $cron$
  );

  raise notice 'pg_cron agendado: balcao-expirar-pendencias (de hora em hora).';
exception when others then
  raise notice 'Nao consegui agendar pelo pg_cron (%). Ligue-o em Database > Extensions e rode de novo. O site ainda chama a funcao ao abrir o Painel.', sqlerrm;
end $$;

/* ============================================================ */
/*  Para mudar o prazo de 48h, troque o numero nos dois lugares  */
/*  acima (a chamada do cron e o padrao da funcao) e rode de     */
/*  novo.                                                        */
/* ============================================================ */
