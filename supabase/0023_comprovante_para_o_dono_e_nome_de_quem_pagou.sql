/* ============================================================
   0023 - O comprovante que o coordenador vê, e o nome de
          quem pagou

   Duas correções em cima da 0022.

   1) A 0022 liberou o comprovante só para `eh_organizador()`,
      isto é, para a administração da plataforma. Mas a lista de
      inscritos já é liberada também para o DONO do evento
      (0016): o coordenador enxergava a inscrição e não
      enxergava o comprovante dela — justamente quem precisa
      conferir o pagamento. Aqui as políticas passam a seguir a
      mesma régua da inscrição.

   2) Print cortado não serve de comprovante. Teve gente que
      mandou uma foto sem os dados do Pix, e aí não dá para
      saber quem pagou. Agora o site pede, por escrito, o nome
      de quem fez o Pix — que é o que a organização compara com
      o extrato quando a imagem não ajuda.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

-- -----------------------------------------------------------------------------
-- 1. O nome de quem fez o Pix
--    Vai como texto, além da imagem: a imagem pode vir cortada, tremida ou
--    recortada só no "Pagamento concluído". O nome digitado sempre dá para ler.
-- -----------------------------------------------------------------------------
alter table public.comprovantes_pagamento
  add column if not exists pagador_nome text not null default '';

comment on column public.comprovantes_pagamento.pagador_nome is
  'Nome de quem fez o Pix, como aparece no banco. É o que a organização compara com o extrato.';

-- -----------------------------------------------------------------------------
-- 2. Quem enxerga o comprovante é quem enxerga a inscrição
--    A regra é escrita por extenso, e não deixada por conta da política da
--    tabela `inscricoes`: uma política que depende de outra política funciona,
--    mas quem lê daqui a um ano não tem como saber quem entra. Por extenso é
--    a mesma régua da 0016 — titular, dono do evento, ou administração.
-- -----------------------------------------------------------------------------
drop policy if exists "comprovantes: dono ou organizador le" on public.comprovantes_pagamento;
create policy "comprovantes: quem ve a inscricao ve o comprovante"
  on public.comprovantes_pagamento
  for select using (
    exists (
      select 1 from public.inscricoes i
      where i.id = inscricao_id
        and (i.titular_id = auth.uid() or public.manda_no_evento(i.evento_id))
    )
  );

/* Apagar: a organização do evento a qualquer momento; quem anexou, só enquanto
   a inscrição está pendente. Depois de paga, o comprovante é a justificativa
   do "pago". */
drop policy if exists "comprovantes: tira o proprio" on public.comprovantes_pagamento;
create policy "comprovantes: tira o proprio" on public.comprovantes_pagamento
  for delete using (
    exists (
      select 1 from public.inscricoes i
      where i.id = inscricao_id
        and (
          public.manda_no_evento(i.evento_id)
          or (i.titular_id = auth.uid() and i.status = 'pendente')
        )
    )
  );

-- -----------------------------------------------------------------------------
-- 3. O mesmo no cofre dos arquivos
-- -----------------------------------------------------------------------------
drop policy if exists "comprovantes: dono ou organizador abre" on storage.objects;
create policy "comprovantes: quem ve a inscricao abre" on storage.objects
  for select using (
    bucket_id = 'comprovantes'
    and exists (
      select 1 from public.inscricoes i
      where i.id = public.inscricao_do_caminho(name)
        and (i.titular_id = auth.uid() or public.manda_no_evento(i.evento_id))
    )
  );

drop policy if exists "comprovantes: dono ou organizador apaga" on storage.objects;
create policy "comprovantes: dono ou organizador apaga" on storage.objects
  for delete using (
    bucket_id = 'comprovantes'
    and exists (
      select 1 from public.inscricoes i
      where i.id = public.inscricao_do_caminho(name)
        and (
          public.manda_no_evento(i.evento_id)
          or (i.titular_id = auth.uid() and i.status = 'pendente')
        )
    )
  );
