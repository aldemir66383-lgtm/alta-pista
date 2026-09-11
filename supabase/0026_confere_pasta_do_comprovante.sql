/* ============================================================
   0026 - O comprovante fica na pasta da própria inscrição

   Um arquivo de comprovante é salvo como:

     <id da inscrição>/<nome aleatório>.<extensão>

   A política do Storage já protege essa pasta. Esta regra fecha
   também a outra ponta: impede que alguém registre no banco um
   caminho de arquivo que pertença a outra inscrição.

   Não lê o conteúdo do comprovante, não exige código Pix e não
   altera comprovantes existentes. A regra é NOT VALID de propósito:
   ela vale imediatamente para anexos novos, sem rejeitar um dado
   histórico caso alguma versão antiga tenha guardado caminho fora
   do formato atual.

   Idempotente: pode rodar mais de uma vez.
   ============================================================ */

alter table public.comprovantes_pagamento
  drop constraint if exists comprovante_na_pasta_da_inscricao;

alter table public.comprovantes_pagamento
  add constraint comprovante_na_pasta_da_inscricao
  check (
    coalesce(public.inscricao_do_caminho(caminho) = inscricao_id, false)
  ) not valid;

comment on constraint comprovante_na_pasta_da_inscricao
  on public.comprovantes_pagamento is
  'Anexos novos devem ficar na pasta cujo UUID é o da própria inscrição. Não valida o conteúdo do comprovante.';
