/* ============================================================ */
/*  Balcao de Inscricoes - passo final                          */
/*                                                              */
/*  1) cria o balde de imagens que faltou                       */
/*  2) torna voce organizador                                   */
/*  3) mostra um resumo do que ficou                            */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run.             */
/* ============================================================ */

insert into storage.buckets (id, name, public)
values ('capas', 'capas', true)
on conflict (id) do update set public = true;

drop policy if exists "capas: leitura publica" on storage.objects;
create policy "capas: leitura publica" on storage.objects
  for select using (bucket_id = 'capas');

drop policy if exists "capas: organizador envia" on storage.objects;
create policy "capas: organizador envia" on storage.objects
  for insert with check (bucket_id = 'capas' and public.eh_organizador());

drop policy if exists "capas: organizador troca" on storage.objects;
create policy "capas: organizador troca" on storage.objects
  for update using (bucket_id = 'capas' and public.eh_organizador())
  with check (bucket_id = 'capas' and public.eh_organizador());

drop policy if exists "capas: organizador apaga" on storage.objects;
create policy "capas: organizador apaga" on storage.objects
  for delete using (bucket_id = 'capas' and public.eh_organizador());

/* ============================================================ */
/*  Voce vira organizador. Troque o e-mail se usou outro.       */
/* ============================================================ */

insert into public.organizadores (user_id)
select id from auth.users where email = 'aldemir66383@gmail.com'
on conflict (user_id) do nothing;

/* garante que o perfil exista, caso o gatilho nao tenha rodado */
insert into public.perfis (id, nome)
select id, coalesce(raw_user_meta_data->>'nome', '')
from auth.users where email = 'aldemir66383@gmail.com'
on conflict (id) do nothing;

/* ============================================================ */
/*  Resumo: os tres numeros devem vir 1, 1 e 1                  */
/* ============================================================ */

select
  (select count(*) from auth.users where email = 'aldemir66383@gmail.com') as sua_conta,
  (select count(*) from public.organizadores)                              as organizadores,
  (select count(*) from storage.buckets where id = 'capas')                as balde_capas;
