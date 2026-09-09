/* ============================================================
   0022 - Comprovante de pagamento anexado pela pessoa

   Quando o Pix não é do gateway automático, a confirmação é
   manual: a organização procura o valor e o código no extrato.
   Isso funciona, mas escorrega justamente nos casos comuns —
   a mãe paga a inscrição do filho, o banco não mostra a
   mensagem, dois pagamentos do mesmo valor no mesmo minuto.

   Aqui a pessoa pode anexar o comprovante do banco logo depois
   de pagar. A organização abre o arquivo, confere e marca pago
   sem precisar caçar no extrato.

   O balde é PRIVADO, ao contrário do balde das capas. Um
   comprovante de Pix mostra nome completo, banco, agência,
   valor e, em muitos bancos, pedaço do CPF de quem pagou e de
   quem recebeu. Um link público disso seria um vazamento de
   dado pessoal com endereço fixo. Quem organiza abre por link
   assinado, que vence em minutos.

   Como no aceite dos termos, isto vive em tabela própria em vez
   de virar coluna em `inscricoes`: aquele caminho está em
   produção com gente se inscrevendo agora, e não há motivo
   para mexer nele.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

-- -----------------------------------------------------------------------------
-- 1. De qual inscrição é este arquivo
--    O caminho no balde é '<id da inscrição>/<arquivo>'. Ler o id direto com
--    um cast estouraria a política inteira se algum dia entrasse um caminho
--    fora do formato; aqui, caminho estranho devolve nulo e a política
--    simplesmente nega.
-- -----------------------------------------------------------------------------
create or replace function public.inscricao_do_caminho(caminho text)
returns uuid
language sql
immutable
as $$
  select case
    when caminho ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
      then substring(caminho from 1 for 36)::uuid
    else null
  end;
$$;

comment on function public.inscricao_do_caminho(text) is
  'Extrai o id da inscrição do caminho do comprovante; nulo se o caminho não começar com um uuid.';

-- -----------------------------------------------------------------------------
-- 2. O registro do anexo
-- -----------------------------------------------------------------------------
create table if not exists public.comprovantes_pagamento (
  id            uuid primary key default gen_random_uuid(),
  inscricao_id  uuid not null references public.inscricoes(id) on delete cascade,
  enviado_por   uuid not null references auth.users(id) on delete cascade,
  caminho       text not null,            -- onde o arquivo está no balde privado
  tipo          text not null default '', -- image/jpeg, application/pdf...
  tamanho       integer not null default 0,
  enviado_em    timestamptz not null default now()
);

comment on table public.comprovantes_pagamento is
  'Comprovante do banco anexado por quem se inscreveu, para a organização conferir o Pix.';
comment on column public.comprovantes_pagamento.caminho is
  'Caminho no balde privado "comprovantes". Só se abre por link assinado.';

create index if not exists comprovantes_por_inscricao
  on public.comprovantes_pagamento (inscricao_id, enviado_em desc);

alter table public.comprovantes_pagamento enable row level security;

/* Enviar: só em nome próprio e só para inscrição que é sua. Sem a segunda
   condição, qualquer pessoa logada penduraria arquivo na inscrição alheia. */
drop policy if exists "comprovantes: dono anexa" on public.comprovantes_pagamento;
create policy "comprovantes: dono anexa" on public.comprovantes_pagamento
  for insert with check (
    enviado_por = auth.uid()
    and exists (
      select 1 from public.inscricoes i
      where i.id = inscricao_id and i.titular_id = auth.uid()
    )
  );

/* Ler: a pessoa vê o que anexou; a organização vê todos, que é o motivo de
   existir. */
drop policy if exists "comprovantes: dono ou organizador le" on public.comprovantes_pagamento;
create policy "comprovantes: dono ou organizador le" on public.comprovantes_pagamento
  for select using (
    public.eh_organizador()
    or exists (
      select 1 from public.inscricoes i
      where i.id = inscricao_id and i.titular_id = auth.uid()
    )
  );

/* Apagar: enquanto a inscrição ainda está pendente, quem anexou pode tirar —
   foto errada, comprovante de outra pessoa, print que mostrava mais do que
   devia. Depois de paga, o anexo é a justificativa do "pago" e só a
   organização mexe. */
drop policy if exists "comprovantes: tira o proprio" on public.comprovantes_pagamento;
create policy "comprovantes: tira o proprio" on public.comprovantes_pagamento
  for delete using (
    public.eh_organizador()
    or exists (
      select 1 from public.inscricoes i
      where i.id = inscricao_id
        and i.titular_id = auth.uid()
        and i.status = 'pendente'
    )
  );

-- não existe policy de UPDATE: um comprovante trocado no lugar não prova nada.

grant select, insert, delete on public.comprovantes_pagamento to authenticated;

-- -----------------------------------------------------------------------------
-- 3. O balde privado
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('comprovantes', 'comprovantes', false)
on conflict (id) do update set public = false;

drop policy if exists "comprovantes: dono envia" on storage.objects;
create policy "comprovantes: dono envia" on storage.objects
  for insert with check (
    bucket_id = 'comprovantes'
    and exists (
      select 1 from public.inscricoes i
      where i.id = public.inscricao_do_caminho(name)
        and i.titular_id = auth.uid()
    )
  );

drop policy if exists "comprovantes: dono ou organizador abre" on storage.objects;
create policy "comprovantes: dono ou organizador abre" on storage.objects
  for select using (
    bucket_id = 'comprovantes'
    and (
      public.eh_organizador()
      or exists (
        select 1 from public.inscricoes i
        where i.id = public.inscricao_do_caminho(name)
          and i.titular_id = auth.uid()
      )
    )
  );

drop policy if exists "comprovantes: dono ou organizador apaga" on storage.objects;
create policy "comprovantes: dono ou organizador apaga" on storage.objects
  for delete using (
    bucket_id = 'comprovantes'
    and (
      public.eh_organizador()
      or exists (
        select 1 from public.inscricoes i
        where i.id = public.inscricao_do_caminho(name)
          and i.titular_id = auth.uid()
          and i.status = 'pendente'
      )
    )
  );

-- sem policy de UPDATE no balde: não se sobrescreve comprovante, envia-se outro.
