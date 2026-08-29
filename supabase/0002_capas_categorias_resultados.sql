-- =============================================================================
--  Balcão de Inscrições — segunda parte do esquema
--
--  Acrescenta o que o site de corrida precisa além da inscrição básica:
--  imagem de capa, modalidade, cidade/UF, evento em destaque e a publicação
--  dos resultados. Rode depois do 0001, no mesmo SQL Editor. Também é
--  idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Campos novos do evento
-- -----------------------------------------------------------------------------
alter table public.eventos add column if not exists categoria   text not null default 'Corrida de rua';
alter table public.eventos add column if not exists cidade      text not null default '';
alter table public.eventos add column if not exists uf          text not null default '';
alter table public.eventos add column if not exists imagem_url  text not null default '';
alter table public.eventos add column if not exists destaque    boolean not null default false;
alter table public.eventos add column if not exists distancias  text not null default '';

-- -----------------------------------------------------------------------------
-- 2. Resultados
--    São públicos por natureza — a classificação de uma corrida é divulgada.
--    Mesmo assim só aparecem depois que o organizador marca o evento como
--    "resultados publicados", para não vazar uma apuração pela metade.
-- -----------------------------------------------------------------------------
alter table public.eventos add column if not exists resultados_publicados boolean not null default false;

create table if not exists public.resultados (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  posicao    integer,
  atleta     text not null,
  equipe     text not null default '',
  categoria  text not null default '',
  percurso   text not null default '',
  tempo      text not null default '',
  criado_em  timestamptz not null default now()
);
alter table public.resultados enable row level security;
create index if not exists resultados_por_evento on public.resultados (evento_id, posicao);

drop policy if exists "resultados: publicos quando divulgados" on public.resultados;
create policy "resultados: publicos quando divulgados" on public.resultados
  for select using (
    public.eh_organizador()
    or exists (select 1 from public.eventos e
                where e.id = evento_id and e.publicado and e.resultados_publicados)
  );

drop policy if exists "resultados: organizador escreve" on public.resultados;
create policy "resultados: organizador escreve" on public.resultados
  for all using (public.eh_organizador()) with check (public.eh_organizador());

-- -----------------------------------------------------------------------------
-- 3. Imagens de capa (Supabase Storage)
--    Balde público: a capa do evento é para todo mundo ver. Só organizador
--    envia e apaga.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('capas', 'capas', true)
on conflict (id) do nothing;

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

-- -----------------------------------------------------------------------------
-- 4. Funções públicas atualizadas, agora com os campos novos
-- -----------------------------------------------------------------------------
create or replace function public.eventos_publicos()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x->>'data' nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'nome', e.nome, 'descricao', e.descricao,
      'categoria', e.categoria, 'cidade', e.cidade, 'uf', e.uf,
      'imagem_url', e.imagem_url, 'destaque', e.destaque, 'distancias', e.distancias,
      'data', e.data, 'hora', e.hora, 'local', e.local, 'vagas', e.vagas,
      'espera_ativa', e.espera_ativa, 'inscricoes_abertas', e.inscricoes_abertas,
      'tem_edital', length(btrim(e.edital)) > 0,
      'ocupadas', (select count(*) from public.inscricoes i
                    where i.evento_id = e.id and i.status in ('pendente','pago')),
      'na_fila',  (select count(*) from public.inscricoes i
                    where i.evento_id = e.id and i.status = 'espera'),
      'lotes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'nome', l.nome, 'preco_centavos', l.preco_centavos,
                  'vende_ate', l.vende_ate, 'quantidade', l.quantidade,
                  'vendidos', (select count(*) from public.inscricoes i
                                where i.lote_id = l.id and i.status in ('pendente','pago'))
                ) order by l.ordem), '[]'::jsonb)
                from public.lotes l where l.evento_id = e.id)
    ) as x
    from public.eventos e where e.publicado
  ) s;
$$;

create or replace function public.evento_publico(p_slug text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'nome', e.nome, 'descricao', e.descricao,
    'categoria', e.categoria, 'cidade', e.cidade, 'uf', e.uf,
    'imagem_url', e.imagem_url, 'distancias', e.distancias,
    'edital', e.edital, 'data', e.data, 'hora', e.hora, 'local', e.local,
    'vagas', e.vagas, 'espera_ativa', e.espera_ativa,
    'inscricoes_abertas', e.inscricoes_abertas,
    'resultados_publicados', e.resultados_publicados,
    'ocupadas', (select count(*) from public.inscricoes i
                  where i.evento_id = e.id and i.status in ('pendente','pago')),
    'na_fila',  (select count(*) from public.inscricoes i
                  where i.evento_id = e.id and i.status = 'espera'),
    'lotes', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', l.id, 'nome', l.nome, 'preco_centavos', l.preco_centavos,
                'vende_ate', l.vende_ate, 'quantidade', l.quantidade,
                'vendidos', (select count(*) from public.inscricoes i
                              where i.lote_id = l.id and i.status in ('pendente','pago'))
              ) order by l.ordem), '[]'::jsonb)
              from public.lotes l where l.evento_id = e.id),
    'perguntas', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', p.id, 'rotulo', p.rotulo, 'tipo', p.tipo,
                    'opcoes', p.opcoes, 'obrigatorio', p.obrigatorio
                  ) order by p.ordem), '[]'::jsonb)
                  from public.perguntas p where p.evento_id = e.id)
  )
  from public.eventos e
  where e.slug = p_slug and e.publicado;
$$;

-- lista de eventos que já têm resultado divulgado
create or replace function public.eventos_com_resultado()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', e.slug, 'nome', e.nome, 'data', e.data,
    'cidade', e.cidade, 'uf', e.uf, 'categoria', e.categoria,
    'imagem_url', e.imagem_url,
    'total', (select count(*) from public.resultados r where r.evento_id = e.id)
  ) order by e.data desc), '[]'::jsonb)
  from public.eventos e
  where e.publicado and e.resultados_publicados;
$$;

grant execute on function public.eventos_com_resultado() to anon, authenticated;

-- =============================================================================
--  Depois de rodar: no Painel, cada evento passa a ter modalidade, cidade/UF,
--  distâncias, imagem de capa e a opção de aparecer em destaque na abertura.
--  A aba Resultados só mostra o evento depois que você marcar
--  "resultados publicados".
-- =============================================================================
