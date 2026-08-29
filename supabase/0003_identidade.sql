-- =============================================================================
--  Balcão de Inscrições — terceira parte do esquema
--
--  Deixa a identidade do site editável pelo painel: iniciais do selo, nome,
--  subtítulo, cor de acento e os textos do rodapé. Rode depois do 0002.
--  Idempotente.
-- =============================================================================

alter table public.configuracao add column if not exists sigla       text not null default 'B';
alter table public.configuracao add column if not exists nome_site   text not null default 'Balcão';
alter table public.configuracao add column if not exists subtitulo   text not null default 'Inscrições esportivas';
alter table public.configuracao add column if not exists cor_acento  text not null default '#FFE01B';
alter table public.configuracao add column if not exists sobre       text not null default '';
alter table public.configuracao add column if not exists contato     text not null default '';
alter table public.configuracao add column if not exists instagram   text not null default '';
alter table public.configuracao add column if not exists whatsapp    text not null default '';
alter table public.configuracao add column if not exists logo_url    text not null default '';

-- só aceita cor em hexadecimal (#RGB ou #RRGGBB): evita que um valor
-- estranho no painel quebre o CSS de todo mundo
alter table public.configuracao drop constraint if exists cor_acento_hex;
alter table public.configuracao add constraint cor_acento_hex
  check (cor_acento ~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$');

-- -----------------------------------------------------------------------------
--  Identidade pública — tudo menos os dados de recebimento.
--  A tabela configuracao continua legível só por organizador; é esta função
--  que entrega ao site o que pode ser público.
-- -----------------------------------------------------------------------------
create or replace function public.identidade()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'organizacao', c.organizacao,
    'sigla',       c.sigla,
    'nome_site',   c.nome_site,
    'subtitulo',   c.subtitulo,
    'cor_acento',  c.cor_acento,
    'sobre',       c.sobre,
    'contato',     c.contato,
    'instagram',   c.instagram,
    'whatsapp',    c.whatsapp,
    'logo_url',    c.logo_url
  )
  from public.configuracao c where c.id;
$$;

grant execute on function public.identidade() to anon, authenticated;

-- o balde das capas também guarda o logotipo, se você enviar um
-- (as políticas do 0002 já cobrem: leitura pública, escrita só de organizador)

-- =============================================================================
--  Depois de rodar: no Painel aparece a seção "Identidade do site", onde você
--  troca as iniciais do selo, o nome, a cor e os textos do rodapé. A mudança
--  vale para todo mundo assim que você salvar.
-- =============================================================================
