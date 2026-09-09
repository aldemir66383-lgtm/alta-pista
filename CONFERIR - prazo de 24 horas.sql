/* Conferência do prazo de 24 horas. Só LÊ — não muda nada.
   Cole no SQL Editor do Supabase, clique em Run e me diga o que apareceu. */

select
  case when pg_get_functiondef(p.oid) ilike '%default 24%'
       then 'SIM - prazo de 24 horas'
       else 'NAO - ainda esta no prazo antigo' end            as prazo,
  case when pg_get_functiondef(p.oid) ilike '%comprovantes_pagamento%'
       then 'SIM - quem anexou comprovante nao e cancelado'
       else 'NAO - a protecao nao entrou' end                 as protecao,
  coalesce(
    (select 'SIM - ' || j.schedule || '  ->  ' || j.command
       from cron.job j where j.jobname = 'balcao-expirar-pendencias'),
    'NAO - o agendamento automatico nao esta ligado')          as agendamento
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'expirar_pendencias';
