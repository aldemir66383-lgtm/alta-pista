-- =============================================================================
--  Balcão de Inscrições — BANCO INTEIRO, DE UMA VEZ SÓ
--
--  Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
--  É a junção de 0001 a 0016 na ordem certa. Tudo é idempotente: pode
--  rodar de novo quantas vezes quiser, com as inscrições abertas ou não,
--  sem apagar nem estragar nada. Gerado automaticamente.
-- =============================================================================


-- ####################################################################### 0001_esquema.sql

-- =============================================================================
--  Balcão de Inscrições — esquema, permissões e regras de negócio
--
--  Rode este arquivo INTEIRO no SQL Editor do Supabase (Database › SQL Editor).
--  Ele é idempotente: pode ser executado de novo sem quebrar nada.
--
--  Princípio de segurança deste banco: NENHUMA tabela com dado pessoal é
--  legível diretamente pelo site. O navegador só enxerga:
--    - as próprias inscrições de quem está logado;
--    - contagens agregadas (vagas ocupadas, vendidos por lote);
--    - os dados públicos do evento e do edital.
--  Tudo o que precisa de privilégio passa por função SECURITY DEFINER, que
--  valida quem está chamando antes de agir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quem é organizador
--    Tabela sem NENHUMA política de escrita: ninguém se promove pelo site.
--    Só dá para virar organizador rodando SQL aqui no painel do Supabase.
-- -----------------------------------------------------------------------------
create table if not exists public.organizadores (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.organizadores enable row level security;

create or replace function public.eh_organizador()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.organizadores o where o.user_id = auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- 2. Perfil de cada conta
-- -----------------------------------------------------------------------------
create table if not exists public.perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text not null default '',
  telefone  text not null default '',
  criado_em timestamptz not null default now()
);
alter table public.perfis enable row level security;

drop policy if exists "perfil proprio: ler" on public.perfis;
create policy "perfil proprio: ler" on public.perfis
  for select using (id = auth.uid() or public.eh_organizador());

drop policy if exists "perfil proprio: criar" on public.perfis;
create policy "perfil proprio: criar" on public.perfis
  for insert with check (id = auth.uid());

drop policy if exists "perfil proprio: alterar" on public.perfis;
create policy "perfil proprio: alterar" on public.perfis
  for update using (id = auth.uid()) with check (id = auth.uid());

-- cria o perfil assim que a conta nasce
create or replace function public.criar_perfil()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- -----------------------------------------------------------------------------
-- 3. Configuração da organização (inclui a chave Pix)
--    A chave Pix NÃO é legível pelo site. Quem precisa dela é a função que
--    monta a cobrança, e ela só devolve os dados para o dono da inscrição.
-- -----------------------------------------------------------------------------
create table if not exists public.configuracao (
  id           boolean primary key default true check (id),
  organizacao  text not null default '',
  chave_pix    text not null default '',
  beneficiario text not null default '',
  cidade       text not null default ''
);
alter table public.configuracao enable row level security;
insert into public.configuracao (id) values (true) on conflict (id) do nothing;

drop policy if exists "config: so organizador le" on public.configuracao;
create policy "config: so organizador le" on public.configuracao
  for select using (public.eh_organizador());

drop policy if exists "config: so organizador altera" on public.configuracao;
create policy "config: so organizador altera" on public.configuracao
  for update using (public.eh_organizador()) with check (public.eh_organizador());

-- o nome da organização é público (aparece no cabeçalho do site)
create or replace function public.nome_organizacao()
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select organizacao from public.configuracao where id;
$$;

-- -----------------------------------------------------------------------------
-- 4. Eventos, lotes e perguntas
-- -----------------------------------------------------------------------------
create table if not exists public.eventos (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  nome               text not null,
  descricao          text not null default '',
  edital             text not null default '',
  data               date,
  hora               time,
  local              text not null default '',
  vagas              integer not null default 0 check (vagas >= 0),  -- 0 = ilimitado
  espera_ativa       boolean not null default true,
  inscricoes_abertas boolean not null default true,
  publicado          boolean not null default false,
  criado_em          timestamptz not null default now()
);
alter table public.eventos enable row level security;

drop policy if exists "eventos: publicados sao publicos" on public.eventos;
create policy "eventos: publicados sao publicos" on public.eventos
  for select using (publicado or public.eh_organizador());

drop policy if exists "eventos: organizador cria" on public.eventos;
create policy "eventos: organizador cria" on public.eventos
  for insert with check (public.eh_organizador());

drop policy if exists "eventos: organizador altera" on public.eventos;
create policy "eventos: organizador altera" on public.eventos
  for update using (public.eh_organizador()) with check (public.eh_organizador());

drop policy if exists "eventos: organizador apaga" on public.eventos;
create policy "eventos: organizador apaga" on public.eventos
  for delete using (public.eh_organizador());

create table if not exists public.lotes (
  id             uuid primary key default gen_random_uuid(),
  evento_id      uuid not null references public.eventos(id) on delete cascade,
  ordem          integer not null default 1,
  nome           text not null,
  preco_centavos integer not null default 0 check (preco_centavos >= 0),
  vende_ate      date,
  quantidade     integer not null default 0 check (quantidade >= 0)  -- 0 = livre
);
alter table public.lotes enable row level security;
create index if not exists lotes_por_evento on public.lotes (evento_id, ordem);

drop policy if exists "lotes: publicos" on public.lotes;
create policy "lotes: publicos" on public.lotes
  for select using (
    public.eh_organizador()
    or exists (select 1 from public.eventos e where e.id = evento_id and e.publicado)
  );

drop policy if exists "lotes: organizador escreve" on public.lotes;
create policy "lotes: organizador escreve" on public.lotes
  for all using (public.eh_organizador()) with check (public.eh_organizador());

create table if not exists public.perguntas (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  ordem       integer not null default 1,
  rotulo      text not null,
  tipo        text not null default 'texto' check (tipo in ('texto','opcoes','cpf','data')),
  opcoes      text not null default '',
  obrigatorio boolean not null default false
);
alter table public.perguntas enable row level security;
create index if not exists perguntas_por_evento on public.perguntas (evento_id, ordem);

drop policy if exists "perguntas: publicas" on public.perguntas;
create policy "perguntas: publicas" on public.perguntas
  for select using (
    public.eh_organizador()
    or exists (select 1 from public.eventos e where e.id = evento_id and e.publicado)
  );

drop policy if exists "perguntas: organizador escreve" on public.perguntas;
create policy "perguntas: organizador escreve" on public.perguntas
  for all using (public.eh_organizador()) with check (public.eh_organizador());

-- -----------------------------------------------------------------------------
-- 5. Inscrições — a tabela com dado pessoal
--
--    LER:      só o titular da conta, ou um organizador.
--    INSERIR:  ninguém direto. Só pela função inscrever(), que calcula preço,
--              lote e status no servidor. Assim não dá para forjar valor zero
--              nem furar a fila mexendo no navegador.
--    ALTERAR:  só organizador (confirmar pagamento, chamar da fila). O titular
--              cancela a própria inscrição pela função cancelar_inscricao().
-- -----------------------------------------------------------------------------
create table if not exists public.inscricoes (
  id                      uuid primary key default gen_random_uuid(),
  evento_id               uuid not null references public.eventos(id) on delete restrict,
  lote_id                 uuid references public.lotes(id) on delete set null,
  titular_id              uuid not null references auth.users(id) on delete cascade,
  participante_nome       text not null,
  participante_nascimento date,
  participante_email      text not null default '',
  participante_telefone   text not null default '',
  eh_titular              boolean not null default true,
  respostas               jsonb not null default '{}'::jsonb,
  observacao              text not null default '',
  codigo                  text unique not null,
  lote_nome               text not null default '',
  valor_centavos          integer not null default 0,
  status                  text not null default 'pendente'
                            check (status in ('pendente','pago','cancelada','espera')),
  pago_em                 timestamptz,
  criado_em               timestamptz not null default now()
);
alter table public.inscricoes enable row level security;
create index if not exists inscricoes_por_evento  on public.inscricoes (evento_id, status);
create index if not exists inscricoes_por_titular on public.inscricoes (titular_id);
create index if not exists inscricoes_por_lote    on public.inscricoes (lote_id);

drop policy if exists "inscricoes: dono ou organizador le" on public.inscricoes;
create policy "inscricoes: dono ou organizador le" on public.inscricoes
  for select using (titular_id = auth.uid() or public.eh_organizador());

drop policy if exists "inscricoes: organizador altera" on public.inscricoes;
create policy "inscricoes: organizador altera" on public.inscricoes
  for update using (public.eh_organizador()) with check (public.eh_organizador());

drop policy if exists "inscricoes: organizador apaga" on public.inscricoes;
create policy "inscricoes: organizador apaga" on public.inscricoes
  for delete using (public.eh_organizador());
-- repare: não existe policy de INSERT. É proposital.

-- -----------------------------------------------------------------------------
-- 6. Código legível da inscrição (ABC-123)
-- -----------------------------------------------------------------------------
create or replace function public.gerar_codigo()
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- sem I, O, 0 e 1
  v_bruto    text;
  v_codigo   text;   -- nome diferente da coluna: senão o WHERE compararia a coluna com ela mesma
  v_existe   boolean;
begin
  loop
    v_bruto := '';
    for i in 1..6 loop
      v_bruto := v_bruto || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    v_codigo := substr(v_bruto, 1, 3) || '-' || substr(v_bruto, 4, 3);
    select exists (select 1 from public.inscricoes i where i.codigo = v_codigo) into v_existe;
    exit when not v_existe;
  end loop;
  return v_codigo;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Dados públicos do evento (sem nada pessoal)
-- -----------------------------------------------------------------------------
create or replace function public.eventos_publicos()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x->>'data' nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'nome', e.nome, 'descricao', e.descricao,
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
    'edital', e.edital, 'data', e.data, 'hora', e.hora, 'local', e.local,
    'vagas', e.vagas, 'espera_ativa', e.espera_ativa,
    'inscricoes_abertas', e.inscricoes_abertas,
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

-- -----------------------------------------------------------------------------
-- 8. Inscrever — o preço, o lote e o status são decididos AQUI, no servidor
-- -----------------------------------------------------------------------------
create or replace function public.inscrever(
  p_evento      uuid,
  p_nome        text,
  p_nascimento  date        default null,
  p_email       text        default '',
  p_telefone    text        default '',
  p_eh_titular  boolean     default true,
  p_respostas   jsonb       default '{}'::jsonb,
  p_observacao  text        default ''
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_evento   public.eventos;
  v_lote     public.lotes;
  v_ocupadas integer;
  v_valor    integer;
  v_status   text;
  v_id       uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para se inscrever.' using errcode = '28000';
  end if;
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome do participante.' using errcode = '22023';
  end if;

  -- serializa as inscrições do mesmo evento: sem isso, dois cliques
  -- simultâneos poderiam ocupar a mesma última vaga
  perform pg_advisory_xact_lock(hashtext(p_evento::text));

  select * into v_evento from public.eventos where id = p_evento and publicado;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = '22023';
  end if;
  if not v_evento.inscricoes_abertas then
    raise exception 'As inscrições deste evento estão encerradas.' using errcode = '22023';
  end if;

  -- primeiro lote que não venceu nem esgotou
  select l.* into v_lote
    from public.lotes l
   where l.evento_id = p_evento
     and (l.vende_ate is null or l.vende_ate >= current_date)
     and (l.quantidade = 0 or (
           select count(*) from public.inscricoes i
            where i.lote_id = l.id and i.status in ('pendente','pago')
         ) < l.quantidade)
   order by l.ordem
   limit 1;

  select count(*) into v_ocupadas
    from public.inscricoes
   where evento_id = p_evento and status in ('pendente','pago');

  if v_lote.id is null or (v_evento.vagas > 0 and v_ocupadas >= v_evento.vagas) then
    if not v_evento.espera_ativa then
      raise exception 'As vagas acabaram.' using errcode = '22023';
    end if;
    v_status := 'espera';
    v_valor  := coalesce((select preco_centavos from public.lotes
                           where evento_id = p_evento order by ordem desc limit 1), 0);
  else
    v_valor  := v_lote.preco_centavos;
    v_status := case when v_valor > 0 then 'pendente' else 'pago' end;
  end if;

  insert into public.inscricoes (
    evento_id, lote_id, titular_id, participante_nome, participante_nascimento,
    participante_email, participante_telefone, eh_titular, respostas, observacao,
    codigo, lote_nome, valor_centavos, status, pago_em
  ) values (
    p_evento, v_lote.id, auth.uid(), btrim(p_nome), p_nascimento,
    coalesce(p_email,''), coalesce(p_telefone,''), coalesce(p_eh_titular, true),
    coalesce(p_respostas, '{}'::jsonb), coalesce(p_observacao,''),
    public.gerar_codigo(), coalesce(v_lote.nome, ''), v_valor, v_status,
    case when v_status = 'pago' then now() else null end
  ) returning id into v_id;

  return (select to_jsonb(i) from public.inscricoes i where i.id = v_id);
end $$;

-- -----------------------------------------------------------------------------
-- 9. Dados da cobrança Pix — só para o dono da inscrição
-- -----------------------------------------------------------------------------
create or replace function public.cobranca(p_inscricao uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ins public.inscricoes; v_cfg public.configuracao;
begin
  -- este teste precisa vir ANTES da comparação: com auth.uid() nulo,
  -- "titular_id <> auth.uid()" resulta em NULL e o IF não dispararia
  if auth.uid() is null then
    raise exception 'Entre na sua conta.' using errcode = '28000';
  end if;
  select * into v_ins from public.inscricoes where id = p_inscricao;
  if not found then
    raise exception 'Inscrição não encontrada.' using errcode = '22023';
  end if;
  if v_ins.titular_id <> auth.uid() and not public.eh_organizador() then
    raise exception 'Esta inscrição não é sua.' using errcode = '42501';
  end if;
  if v_ins.status <> 'pendente' or v_ins.valor_centavos <= 0 then
    return null;  -- nada a cobrar
  end if;
  select * into v_cfg from public.configuracao where id;
  if coalesce(btrim(v_cfg.chave_pix), '') = '' then
    return null;  -- chave Pix ainda não cadastrada
  end if;
  return jsonb_build_object(
    'chave',        v_cfg.chave_pix,
    'beneficiario', coalesce(nullif(v_cfg.beneficiario,''), v_cfg.organizacao),
    'cidade',       v_cfg.cidade,
    'centavos',     v_ins.valor_centavos,
    'txid',         replace(v_ins.codigo, '-', '')
  );
end $$;

-- -----------------------------------------------------------------------------
-- 10. Cancelar a própria inscrição
-- -----------------------------------------------------------------------------
create or replace function public.cancelar_inscricao(p_inscricao uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ins public.inscricoes;
begin
  -- mesma armadilha do NULL: sem conta, recusa antes de qualquer comparação
  if auth.uid() is null then
    raise exception 'Entre na sua conta.' using errcode = '28000';
  end if;
  select * into v_ins from public.inscricoes where id = p_inscricao;
  if not found then
    raise exception 'Inscrição não encontrada.' using errcode = '22023';
  end if;
  if v_ins.titular_id <> auth.uid() then
    raise exception 'Esta inscrição não é sua.' using errcode = '42501';
  end if;
  if v_ins.status = 'pago' then
    raise exception 'Inscrição já paga: fale com a organização para pedir o cancelamento.'
      using errcode = '22023';
  end if;
  update public.inscricoes set status = 'cancelada' where id = p_inscricao;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 11. Posição na fila de espera (do próprio inscrito)
-- -----------------------------------------------------------------------------
create or replace function public.posicao_na_fila(p_inscricao uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  with alvo as (
    select id, evento_id, titular_id from public.inscricoes where id = p_inscricao
  ), fila as (
    select i.id, row_number() over (order by i.criado_em) as posicao
      from public.inscricoes i, alvo
     where i.evento_id = alvo.evento_id and i.status = 'espera'
  )
  select f.posicao::int
    from fila f, alvo
   where f.id = alvo.id
     and auth.uid() is not null
     and (alvo.titular_id = auth.uid() or public.eh_organizador());
$$;

-- -----------------------------------------------------------------------------
-- 12. Permissões de execução
-- -----------------------------------------------------------------------------
grant execute on function public.eh_organizador()            to anon, authenticated;
grant execute on function public.nome_organizacao()          to anon, authenticated;
grant execute on function public.eventos_publicos()          to anon, authenticated;
grant execute on function public.evento_publico(text)        to anon, authenticated;
grant execute on function public.inscrever(uuid,text,date,text,text,boolean,jsonb,text)
                                                             to authenticated;
grant execute on function public.cobranca(uuid)              to authenticated;
grant execute on function public.cancelar_inscricao(uuid)    to authenticated;
grant execute on function public.posicao_na_fila(uuid)       to authenticated;
revoke execute on function public.gerar_codigo()             from anon, authenticated;

-- =============================================================================
--  DEPOIS DE RODAR ISTO: entre no site uma vez com o seu e-mail para a conta
--  existir, e então rode, aqui mesmo, trocando pelo seu endereço:
--
--    insert into public.organizadores (user_id)
--    select id from auth.users where email = 'seu-email@exemplo.com'
--    on conflict do nothing;
--
--  Repita para o e-mail do coordenador. Só quem está nessa tabela vê o painel.
-- =============================================================================


-- ####################################################################### 0002_capas_categorias_resultados.sql

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


-- ####################################################################### 0003_identidade.sql

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


-- ####################################################################### 0004_finalizar.sql

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


-- ####################################################################### 0005_equipe.sql

/* ============================================================ */
/*  Balcao de Inscricoes - equipe da organizacao                 */
/*                                                              */
/*  Permite que um organizador convide outro pelo painel, sem   */
/*  precisar de SQL. A tabela organizadores continua sem        */
/*  politica de escrita: quem escreve nela sao estas funcoes,   */
/*  que conferem quem esta chamando antes de agir.              */
/*                                                              */
/*  Cole no SQL Editor e clique em Run. Idempotente.            */
/* ============================================================ */

/* Quem sao os organizadores. So organizador enxerga a lista. */
create or replace function public.listar_organizadores()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.eh_organizador() then
    raise exception 'Apenas a organizacao pode ver a equipe.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.id,
      'email',   u.email,
      'nome',    coalesce(p.nome, ''),
      'desde',   o.criado_em,
      'sou_eu',  u.id = auth.uid()
    ) order by o.criado_em)
    from public.organizadores o
    join auth.users u on u.id = o.user_id
    left join public.perfis p on p.id = u.id
  ), '[]'::jsonb);
end $$;

/* Promove alguem a organizador pelo e-mail.
   A pessoa precisa ja ter entrado no site pelo menos uma vez,
   porque so entao a conta dela existe. */
create or replace function public.promover_organizador(p_email text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_email text;
begin
  if not public.eh_organizador() then
    raise exception 'Apenas a organizacao pode convidar.' using errcode = '42501';
  end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'Informe o e-mail.' using errcode = '22023';
  end if;

  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is null then
    raise exception 'Nao existe conta com esse e-mail. Peca para a pessoa entrar no site uma vez, e tente de novo.'
      using errcode = '22023';
  end if;

  insert into public.organizadores (user_id) values (v_id)
  on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

/* Remove um organizador. Duas travas: nao dá para remover a si
   mesmo por engano, nem para esvaziar a equipe. */
create or replace function public.remover_organizador(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer;
begin
  if not public.eh_organizador() then
    raise exception 'Apenas a organizacao pode remover.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Voce nao pode remover a si mesmo. Peca a outro organizador.' using errcode = '22023';
  end if;

  select count(*) into v_total from public.organizadores;
  if v_total <= 1 then
    raise exception 'A organizacao ficaria sem ninguem. Convide outra pessoa antes.' using errcode = '22023';
  end if;

  delete from public.organizadores where user_id = p_user_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.listar_organizadores()      to authenticated;
grant execute on function public.promover_organizador(text)  to authenticated;
grant execute on function public.remover_organizador(uuid)   to authenticated;


-- ####################################################################### 0006_fechar_funcoes_internas.sql

/* ============================================================ */
/*  Balcao de Inscricoes - fechar as funcoes internas            */
/*                                                              */
/*  No Postgres, toda funcao nova nasce com EXECUTE liberado     */
/*  para PUBLIC. Revogar de "anon" e "authenticated" nao adianta */
/*  nada, porque os dois herdam de PUBLIC. Era o caso da         */
/*  gerar_codigo, que ficou chamavel por qualquer visitante.     */
/*                                                              */
/*  Aqui revogamos de PUBLIC nas funcoes que sao de uso interno  */
/*  e reafirmamos as permissoes das que devem mesmo ser          */
/*  chamadas pelo site.                                         */
/*                                                              */
/*  Cole no SQL Editor e clique em Run. Idempotente.             */
/* ============================================================ */

/* ==== internas: ninguem chama de fora ==== */

revoke all on function public.gerar_codigo() from public;
revoke all on function public.gerar_codigo() from anon, authenticated;

revoke all on function public.criar_perfil() from public;
revoke all on function public.criar_perfil() from anon, authenticated;

/* ==== publicas: qualquer visitante pode ver ==== */

revoke all on function public.eventos_publicos()      from public;
revoke all on function public.evento_publico(text)    from public;
revoke all on function public.eventos_com_resultado() from public;
revoke all on function public.identidade()            from public;
revoke all on function public.nome_organizacao()      from public;
revoke all on function public.eh_organizador()        from public;

grant execute on function public.eventos_publicos()      to anon, authenticated;
grant execute on function public.evento_publico(text)    to anon, authenticated;
grant execute on function public.eventos_com_resultado() to anon, authenticated;
grant execute on function public.identidade()            to anon, authenticated;
grant execute on function public.nome_organizacao()      to anon, authenticated;
grant execute on function public.eh_organizador()        to anon, authenticated;

/* ==== so para quem tem conta ==== */

revoke all on function public.inscrever(uuid,text,date,text,text,boolean,jsonb,text) from public;
revoke all on function public.cobranca(uuid)             from public;
revoke all on function public.cancelar_inscricao(uuid)   from public;
revoke all on function public.posicao_na_fila(uuid)      from public;
revoke all on function public.listar_organizadores()     from public;
revoke all on function public.promover_organizador(text) from public;
revoke all on function public.remover_organizador(uuid)  from public;

grant execute on function public.inscrever(uuid,text,date,text,text,boolean,jsonb,text) to authenticated;
grant execute on function public.cobranca(uuid)             to authenticated;
grant execute on function public.cancelar_inscricao(uuid)   to authenticated;
grant execute on function public.posicao_na_fila(uuid)      to authenticated;
grant execute on function public.listar_organizadores()     to authenticated;
grant execute on function public.promover_organizador(text) to authenticated;
grant execute on function public.remover_organizador(uuid)  to authenticated;

/* ============================================================ */
/*  Conferencia: depois de rodar, o teste                        */
/*  "gerar codigos de inscricao a vontade" deve passar.          */
/*     node testes/seguranca.mjs                                 */
/* ============================================================ */


-- ####################################################################### 0007_numero_de_peito.sql

/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0007 - Numero de peito e retirada de kit                    */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run.             */
/*  Pode rodar mais de uma vez sem estragar nada.               */
/* ============================================================ */


/* ==== 1. As colunas novas ==== */

/* O numero que a pessoa usa no peito. Fica vazio enquanto a      */
/* inscricao nao esta paga: quem nao pagou nao ocupa numero.      */
alter table public.inscricoes
  add column if not exists numero integer;

/* Marca que o kit (camisa, sacola, ficha de alimentacao) ja foi  */
/* entregue na retirada. Evita entregar duas vezes.               */
alter table public.inscricoes
  add column if not exists kit_retirado boolean not null default false;

alter table public.inscricoes
  add column if not exists kit_retirado_em timestamptz;

/* De quanto comeca a numeracao do evento. Muitas corridas comecam */
/* em 100 ou 1000 porque numero de um digito fica feio na foto.    */
alter table public.eventos
  add column if not exists numero_inicial integer not null default 1;

/* Dois inscritos do mesmo evento nunca podem ter o mesmo numero.  */
/* O indice e a garantia final: mesmo que o codigo tenha um erro,  */
/* o banco recusa a duplicata.                                     */
create unique index if not exists inscricoes_numero_por_evento
  on public.inscricoes (evento_id, numero)
  where numero is not null;


/* ==== 2. A atribuicao automatica ==== */

/*  A regra: no instante em que a inscricao passa a "pago", ela    */
/*  ganha o proximo numero livre do evento. Se ja tem numero,      */
/*  mantem o que tem, inclusive se for cancelada e reaberta: a   */
/*  pessoa nao troca de numero no meio do caminho.                 */
/*                                                                 */
/*  O advisory lock serializa por evento. Sem ele, duas baixas de  */
/*  pagamento no mesmo segundo poderiam ler o mesmo "maior numero" */
/*  e tentar gravar o mesmo valor.                                 */

create or replace function public.atribuir_numero()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inicio integer;
  v_maior  integer;
begin
  if new.status = 'pago' and new.numero is null then

    perform pg_advisory_xact_lock(hashtext('numero:' || new.evento_id::text));

    select coalesce(numero_inicial, 1) into v_inicio
      from public.eventos where id = new.evento_id;

    select coalesce(max(numero), 0) into v_maior
      from public.inscricoes where evento_id = new.evento_id;

    new.numero := greatest(coalesce(v_inicio, 1), v_maior + 1);
  end if;

  return new;
end $$;

revoke all on function public.atribuir_numero() from public;

drop trigger if exists tg_atribuir_numero_ins on public.inscricoes;
create trigger tg_atribuir_numero_ins
  before insert on public.inscricoes
  for each row execute function public.atribuir_numero();

drop trigger if exists tg_atribuir_numero_upd on public.inscricoes;
create trigger tg_atribuir_numero_upd
  before update on public.inscricoes
  for each row execute function public.atribuir_numero();


/* ==== 3. Numerar quem ja estava pago antes desta migracao ==== */

/*  Roda uma vez so, na ordem em que as pessoas pagaram: quem      */
/*  pagou primeiro leva o numero menor.                            */

do $$
declare
  v_evento uuid;
  v_id     uuid;
  v_prox   integer;
begin
  for v_evento in
    select distinct evento_id from public.inscricoes
     where status = 'pago' and numero is null
  loop
    select greatest(
             coalesce((select numero_inicial from public.eventos where id = v_evento), 1),
             coalesce((select max(numero) from public.inscricoes
                        where evento_id = v_evento), 0) + 1)
      into v_prox;

    for v_id in
      select id from public.inscricoes
       where evento_id = v_evento and status = 'pago' and numero is null
       order by coalesce(pago_em, criado_em), criado_em
    loop
      update public.inscricoes set numero = v_prox where id = v_id;
      v_prox := v_prox + 1;
    end loop;
  end loop;
end $$;

/* ============================================================ */
/*  Depois de rodar, o painel mostra a coluna "Numero" e o        */
/*  participante ve o proprio numero em "Minhas inscricoes".      */
/* ============================================================ */


-- ####################################################################### 0008_peito_personalizado.sql

/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0008 - Personalizacao do numero de peito                    */
/*                                                              */
/*  Cada evento passa a mandar na aparencia do proprio numero:   */
/*  quantos algarismos, a cor, o logotipo e uma arte de fundo.   */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run.             */
/*  Pode rodar mais de uma vez sem estragar nada.               */
/* ============================================================ */


/*  Quantos algarismos o numero sempre tera. Com 4, o corredor 7  */
/*  vira 0007. Zero desliga o preenchimento e mostra o numero cru.*/
alter table public.eventos
  add column if not exists numero_digitos integer not null default 0;

/*  Cor da faixa e do selo do percurso. Vazio significa usar a    */
/*  cor de acento do site, para o organizador nao precisar        */
/*  escolher nada se nao quiser.                                  */
alter table public.eventos
  add column if not exists peito_cor text not null default '';

/*  Logotipo do evento, no lugar da sigla da marca.               */
alter table public.eventos
  add column if not exists peito_logo_url text not null default '';

/*  Arte pronta ocupando a folha inteira, atras do numero.        */
alter table public.eventos
  add column if not exists peito_fundo_url text not null default '';


/*  Limites de sanidade. Nao sao seguranca (o site so escreve com  */
/*  organizador logado), sao para um erro de digitacao nao gerar   */
/*  mil folhas impressas erradas.                                  */

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_numero_digitos_limite') then
    alter table public.eventos
      add constraint eventos_numero_digitos_limite
      check (numero_digitos >= 0 and numero_digitos <= 6);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'eventos_peito_cor_hex') then
    alter table public.eventos
      add constraint eventos_peito_cor_hex
      check (peito_cor = '' or peito_cor ~* '^#[0-9a-f]{6}$');
  end if;
end $$;

/* ============================================================ */
/*  Depois de rodar, o formulario do evento no Painel ganha a     */
/*  secao "Aparencia do numero de peito", com previa ao vivo.     */
/* ============================================================ */


-- ####################################################################### 0009_paleta.sql

/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0009 - Nova paleta: azul-noite com lima                     */
/*                                                              */
/*  A cor de acento fica guardada no banco, nao no codigo, para  */
/*  voce poder troca-la pelo Painel a qualquer momento. Esta     */
/*  migracao so muda o valor que ja esta la e o padrao de quem   */
/*  instalar o sistema do zero.                                  */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run.             */
/* ============================================================ */

alter table public.configuracao
  alter column cor_acento set default '#C6F24E';

update public.configuracao
   set cor_acento = '#C6F24E'
 where cor_acento = '#FFE01B';

/* ============================================================ */
/*  Se voce ja tinha escolhido uma cor propria no Painel, ela    */
/*  e preservada: a troca so alcanca quem estava no amarelo      */
/*  original.                                                    */
/* ============================================================ */


-- ####################################################################### 0010_devolver_acesso.sql

/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0010 - Devolver o acesso ao Painel                          */
/*                                                              */
/*  Para quando a conta de login foi apagada por engano. Apagar  */
/*  um usuario no Supabase apaga em cascata tudo que estava      */
/*  pendurado nele: o perfil, as inscricoes e o vinculo de       */
/*  organizador. Entrar de novo com o mesmo e-mail cria uma      */
/*  conta nova, com outro identificador interno, e o banco a     */
/*  trata como outra pessoa.                                     */
/*                                                              */
/*  Este script religa a conta atual a lista de organizadores.   */
/*                                                              */
/*  ANTES DE RODAR: entre no site pelo link do e-mail, ao menos  */
/*  uma vez. A conta precisa existir para poder ser promovida.   */
/*                                                              */
/*  Cole no SQL Editor e clique em Run. Pode rodar mais de uma   */
/*  vez sem estragar nada.                                       */
/* ============================================================ */


/*  Troque o endereco abaixo se quiser promover outro e-mail.    */

do $$
declare
  v_email text := 'aldemir66383@gmail.com';
  v_id    uuid;
  v_total integer;
begin

  /* a conta mais recente com esse endereco */
  select id into v_id
    from auth.users
   where lower(email) = lower(v_email)
   order by created_at desc
   limit 1;

  if v_id is null then
    raise exception
      'Nao existe conta com o e-mail %. Entre no site pelo link antes de rodar isto.', v_email;
  end if;

  /* o perfil costuma ser criado por gatilho, mas se a conta veio de
     antes do gatilho existir, garantimos aqui */
  insert into public.perfis (id) values (v_id)
  on conflict (id) do nothing;

  insert into public.organizadores (user_id) values (v_id)
  on conflict (user_id) do nothing;

  select count(*) into v_total from public.organizadores;

  raise notice 'Acesso devolvido a %. A equipe tem agora % organizador(es).', v_email, v_total;

end $$;


/*  Confira o resultado: deve aparecer uma linha com o seu e-mail. */

select u.email,
       o.criado_em as organizador_desde
  from public.organizadores o
  join auth.users u on u.id = o.user_id
 order by o.criado_em;

/* ============================================================ */
/*  Depois de rodar, recarregue o site. O botao "Painel" volta.  */
/*                                                              */
/*  Para limpar testes daqui em diante, nao apague usuarios:     */
/*  cancele a inscricao pelo site e apague o evento pelo Painel. */
/*  Assim nada e removido em cascata.                            */
/* ============================================================ */


-- ####################################################################### 0011_numero_com_quatro_algarismos.sql

/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0011 - Quatro algarismos como padrao                        */
/*                                                              */
/*  O numero de peito passa a sair como 0007, nao como 7.        */
/*  E o formato usado em corrida: alinha na folha, ocupa sempre  */
/*  a mesma largura, e numero de um algarismo sozinho fica       */
/*  pequeno demais na foto de chegada.                           */
/*                                                              */
/*  Cole no SQL Editor e clique em Run.                          */
/* ============================================================ */

alter table public.eventos
  alter column numero_digitos set default 4;

/*  Alcanca so quem estava no zero, que era o padrao antigo.     */
/*  Se voce ja escolheu outra quantidade em algum evento, ela e  */
/*  preservada.                                                   */
update public.eventos
   set numero_digitos = 4
 where numero_digitos = 0;

/* ============================================================ */


-- ####################################################################### 0012_limite_de_inscricoes.sql

/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0012 - Trava contra enxurrada de inscricoes                 */
/*                                                              */
/*  Sem isto, uma pessoa logada pode chamar inscrever() em      */
/*  serie e encher o evento de inscricoes "pendente" que nunca  */
/*  viram pagamento, empurrando os inscritos de verdade para a  */
/*  lista de espera. Duas travas novas:                         */
/*                                                              */
/*   1. no maximo 5 inscricoes em aberto (pendente/espera) por  */
/*      conta em cada evento;                                   */
/*   2. a mesma conta nao inscreve o mesmo nome duas vezes no   */
/*      mesmo evento (a menos que a primeira tenha sido         */
/*      cancelada).                                             */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run.             */
/*  Idempotente: pode rodar de novo sem estragar nada.          */
/* ============================================================ */


/* ==== 1. A garantia final: o banco recusa a duplicata exata ==== */
/*  Se ja houver duplicatas antigas, este create falha e avisa —   */
/*  nesse caso, cancele as inscricoes repetidas pelo Painel e rode */
/*  de novo.                                                        */

create unique index if not exists inscricoes_sem_duplicata
  on public.inscricoes (evento_id, titular_id, lower(btrim(participante_nome)))
  where status in ('pendente','pago','espera');


/* ==== 2. inscrever() com as duas checagens, sob a mesma trava ==== */
/*  E a funcao inteira do 0001, com o bloco novo logo depois do     */
/*  pg_advisory_xact_lock. O resto e igual.                         */

create or replace function public.inscrever(
  p_evento      uuid,
  p_nome        text,
  p_nascimento  date        default null,
  p_email       text        default '',
  p_telefone    text        default '',
  p_eh_titular  boolean     default true,
  p_respostas   jsonb       default '{}'::jsonb,
  p_observacao  text        default ''
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_evento   public.eventos;
  v_lote     public.lotes;
  v_ocupadas integer;
  v_valor    integer;
  v_status   text;
  v_id       uuid;
  v_abertas  integer;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para se inscrever.' using errcode = '28000';
  end if;
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome do participante.' using errcode = '22023';
  end if;

  -- serializa as inscrições do mesmo evento: sem isso, dois cliques
  -- simultâneos poderiam ocupar a mesma última vaga
  perform pg_advisory_xact_lock(hashtext(p_evento::text));

  -- trava contra enxurrada: uma conta não acumula inscrições não pagas no
  -- mesmo evento. A checagem vem depois do lock para que uma rajada de
  -- chamadas simultâneas não passe toda no mesmo instante.
  select count(*) into v_abertas
    from public.inscricoes
   where evento_id = p_evento
     and titular_id = auth.uid()
     and status in ('pendente','espera');
  if v_abertas >= 5 then
    raise exception 'Você já tem inscrições em aberto neste evento. Conclua ou cancele antes de fazer outra.'
      using errcode = '22023';
  end if;

  -- a mesma conta não inscreve o mesmo nome duas vezes no mesmo evento
  if exists (
    select 1 from public.inscricoes
     where evento_id = p_evento
       and titular_id = auth.uid()
       and lower(btrim(participante_nome)) = lower(btrim(p_nome))
       and status in ('pendente','pago','espera')
  ) then
    raise exception 'Você já inscreveu % neste evento. Veja em "Minhas inscrições".', btrim(p_nome)
      using errcode = '22023';
  end if;

  select * into v_evento from public.eventos where id = p_evento and publicado;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = '22023';
  end if;
  if not v_evento.inscricoes_abertas then
    raise exception 'As inscrições deste evento estão encerradas.' using errcode = '22023';
  end if;

  -- primeiro lote que não venceu nem esgotou
  select l.* into v_lote
    from public.lotes l
   where l.evento_id = p_evento
     and (l.vende_ate is null or l.vende_ate >= current_date)
     and (l.quantidade = 0 or (
           select count(*) from public.inscricoes i
            where i.lote_id = l.id and i.status in ('pendente','pago')
         ) < l.quantidade)
   order by l.ordem
   limit 1;

  select count(*) into v_ocupadas
    from public.inscricoes
   where evento_id = p_evento and status in ('pendente','pago');

  if v_lote.id is null or (v_evento.vagas > 0 and v_ocupadas >= v_evento.vagas) then
    if not v_evento.espera_ativa then
      raise exception 'As vagas acabaram.' using errcode = '22023';
    end if;
    v_status := 'espera';
    v_valor  := coalesce((select preco_centavos from public.lotes
                           where evento_id = p_evento order by ordem desc limit 1), 0);
  else
    v_valor  := v_lote.preco_centavos;
    v_status := case when v_valor > 0 then 'pendente' else 'pago' end;
  end if;

  insert into public.inscricoes (
    evento_id, lote_id, titular_id, participante_nome, participante_nascimento,
    participante_email, participante_telefone, eh_titular, respostas, observacao,
    codigo, lote_nome, valor_centavos, status, pago_em
  ) values (
    p_evento, v_lote.id, auth.uid(), btrim(p_nome), p_nascimento,
    coalesce(p_email,''), coalesce(p_telefone,''), coalesce(p_eh_titular, true),
    coalesce(p_respostas, '{}'::jsonb), coalesce(p_observacao,''),
    public.gerar_codigo(), coalesce(v_lote.nome, ''), v_valor, v_status,
    case when v_status = 'pago' then now() else null end
  ) returning id into v_id;

  return (select to_jsonb(i) from public.inscricoes i where i.id = v_id);
end $$;

revoke all on function public.inscrever(uuid,text,date,text,text,boolean,jsonb,text) from public;
grant execute on function public.inscrever(uuid,text,date,text,text,boolean,jsonb,text) to authenticated;

/* ============================================================ */
/*  Depois de rodar, o teste                                     */
/*     node testes/seguranca.mjs                                 */
/*  continua passando, e a nova bateria em                       */
/*     testes/limite.mjs  (se voce rodar com uma conta de teste) */
/*  cobre o limite.                                              */
/* ============================================================ */


-- ####################################################################### 0013_expirar_pendencias.sql

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


-- ####################################################################### 0014_fechar_expirar_pendencias.sql

/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0014 - Fechar a expirar_pendencias para quem nao tem conta  */
/*                                                              */
/*  No Supabase, toda funcao NOVA no schema public nasce com    */
/*  EXECUTE concedido nominalmente a "anon" e "authenticated"   */
/*  por "default privileges". O  revoke ... from public  do     */
/*  0013 nao alcanca esse grant nominal, entao um visitante     */
/*  sem conta ainda conseguia disparar o cancelamento das       */
/*  pendencias. Este arquivo tira o acesso de "anon".           */
/*                                                              */
/*  (Mesmo problema que o 0006 resolveu para gerar_codigo.)     */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run. Idempotente.*/
/* ============================================================ */

revoke all on function public.expirar_pendencias(integer) from public;
revoke all on function public.expirar_pendencias(integer) from anon;
grant  execute on function public.expirar_pendencias(integer) to authenticated;

/* ============================================================ */
/*  Conferencia: depois de rodar, o teste                        */
/*     node testes/seguranca.mjs                                 */
/*  volta a passar 100%  ("disparar a expiracao de pendencias    */
/*  sem conta" deve ser RECUSADO).                               */
/*                                                              */
/*  Quem continua podendo chamar:                                */
/*   - o pg_cron / SQL Editor (rodam como postgres, sem passar   */
/*     por esse controle);                                       */
/*   - um organizador logado, pelo Painel.                       */
/*  Um usuario logado que NAO seja organizador e recusado por    */
/*  dentro da propria funcao.                                    */
/* ============================================================ */


-- ####################################################################### 0015_pix_mercadopago.sql

/* ============================================================
   0015 - Cobrança Pix automática pelo Mercado Pago

   Mantém uma cobrança única, com valor imutável, para cada
   inscrição pendente. Nenhuma chave do Mercado Pago fica no
   banco ou no navegador: o access token vive somente nas
   variáveis de ambiente das funções da Netlify.

   Cole no SQL Editor do Supabase e clique em Run.
   Idempotente: pode rodar de novo sem estragar nada.
   ============================================================ */

create table if not exists public.pix_cobrancas (
  id                uuid primary key default gen_random_uuid(),
  inscricao_id      uuid not null references public.inscricoes(id) on delete cascade,
  correlation_id    uuid not null unique,          -- external_reference enviado ao Mercado Pago
  transaction_id    text unique,                   -- id do pagamento no Mercado Pago
  valor_centavos    integer not null check (valor_centavos > 0),
  status            text not null default 'ativa'
                    check (status in ('ativa','paga','expirada','cancelada','falhou')),
  payload_pix       text,                          -- "copia e cola" (EMV) do QR
  expira_em         timestamptz not null,
  end_to_end_id     text unique,                   -- referência da liquidação confirmada
  pago_em           timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index if not exists pix_cobrancas_por_inscricao
  on public.pix_cobrancas (inscricao_id, status, expira_em desc);

alter table public.pix_cobrancas enable row level security;

-- A tabela não é exposta ao navegador. Só a função de servidor, autenticada
-- com service_role, cria e atualiza cobranças após falar com o Mercado Pago.
revoke all on table public.pix_cobrancas from anon, authenticated;

/* O número de peito já é atribuído pelo gatilho existente quando a inscrição
   muda para "pago". A função de webhook atualiza public.inscricoes usando
   service_role, apenas depois de reconsultar o pagamento na API do Mercado
   Pago e conferir estado e valor. */


-- ####################################################################### 0016_donos_e_taxa.sql

/* ============================================================
   0016 - Cada evento com o seu dono, e a taxa de serviço

   Duas mudanças que andam juntas e transformam o site de
   "as corridas de uma escola" em plataforma:

   1. O evento passa a ter dono. Quem cria administra o próprio
      evento e só enxerga os próprios inscritos. Quem está na
      tabela `organizadores` continua enxergando tudo — é a
      administração da plataforma, não mais a única dona.

   2. Taxa de serviço de R$ 1,00 por inscrição, somada ao preço
      do lote e exibida ao participante antes do pagamento,
      conforme o termo de uso em site/termos.html.

   Sobre os valores, para não haver ambiguidade adiante:

     valor_centavos  = o TOTAL que o participante paga
     taxa_centavos   = a parte desse total que é da plataforma

   Ou seja, `valor_centavos` continua sendo o que a cobrança Pix
   usa — nada do que já existe muda de significado. O que sobra
   para o organizador é `valor_centavos - taxa_centavos`.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

-- -----------------------------------------------------------------------------
-- 1. O dono do evento e a chave Pix dele
-- -----------------------------------------------------------------------------

alter table public.eventos
  add column if not exists dono_id uuid references auth.users(id) on delete set null;

/* Cada organizador recebe na própria conta: sem isto, o dinheiro de todo mundo
   cairia na mesma chave — o oposto do que o termo de uso promete. Em branco,
   o evento usa a chave geral da tabela `configuracao`, que é o comportamento
   dos eventos que já existiam. */
alter table public.eventos
  add column if not exists chave_pix        text not null default '';
alter table public.eventos
  add column if not exists recebedor_nome   text not null default '';
alter table public.eventos
  add column if not exists recebedor_cidade text not null default '';

create index if not exists eventos_dono_idx on public.eventos (dono_id);

/* Dono do evento. SECURITY DEFINER porque precisa enxergar a linha do evento
   mesmo quando a política de leitura ainda não deixaria. */
create or replace function public.eh_dono(p_evento uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.eventos e
     where e.id = p_evento and e.dono_id is not null and e.dono_id = auth.uid()
  );
$$;

/* Quem manda neste evento: o dono ou a administração da plataforma. */
create or replace function public.manda_no_evento(p_evento uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.eh_organizador() or public.eh_dono(p_evento);
$$;

-- -----------------------------------------------------------------------------
-- 2. Quem pode criar, ver e mexer em evento
-- -----------------------------------------------------------------------------

/* Ler: o público vê os publicados; o dono vê os seus, publicados ou não; a
   administração vê tudo. */
drop policy if exists "eventos: publicados sao publicos" on public.eventos;
create policy "eventos: publicados sao publicos" on public.eventos
  for select using (
    publicado
    or public.eh_organizador()
    or (dono_id is not null and dono_id = auth.uid())
  );

/* Criar: qualquer pessoa com conta, desde que se declare dona do próprio
   evento. A administração pode criar em nome da casa, sem dono. */
drop policy if exists "eventos: organizador cria" on public.eventos;
create policy "eventos: organizador cria" on public.eventos
  for insert with check (
    (auth.uid() is not null and dono_id = auth.uid())
    or public.eh_organizador()
  );

/* Alterar e apagar: o dono ou a administração. O `with check` impede que o
   dono passe o evento para outra pessoa e perca o próprio acesso sem querer. */
drop policy if exists "eventos: organizador altera" on public.eventos;
create policy "eventos: organizador altera" on public.eventos
  for update using (
    public.eh_organizador() or (dono_id is not null and dono_id = auth.uid())
  ) with check (
    public.eh_organizador() or (dono_id is not null and dono_id = auth.uid())
  );

drop policy if exists "eventos: organizador apaga" on public.eventos;
create policy "eventos: organizador apaga" on public.eventos
  for delete using (
    public.eh_organizador() or (dono_id is not null and dono_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 3. Lotes e perguntas seguem o dono do evento
-- -----------------------------------------------------------------------------

drop policy if exists "lotes: organizador escreve" on public.lotes;
create policy "lotes: organizador escreve" on public.lotes
  for all using (public.manda_no_evento(evento_id))
  with check (public.manda_no_evento(evento_id));

drop policy if exists "perguntas: organizador escreve" on public.perguntas;
create policy "perguntas: organizador escreve" on public.perguntas
  for all using (public.manda_no_evento(evento_id))
  with check (public.manda_no_evento(evento_id));

-- -----------------------------------------------------------------------------
-- 4. Inscritos: cada dono enxerga só os do próprio evento
-- -----------------------------------------------------------------------------

drop policy if exists "inscricoes: dono ou organizador le" on public.inscricoes;
create policy "inscricoes: dono ou organizador le" on public.inscricoes
  for select using (
    titular_id = auth.uid()
    or public.eh_organizador()
    or public.eh_dono(evento_id)
  );

drop policy if exists "inscricoes: organizador altera" on public.inscricoes;
create policy "inscricoes: organizador altera" on public.inscricoes
  for update using (public.manda_no_evento(evento_id))
  with check (public.manda_no_evento(evento_id));

drop policy if exists "inscricoes: organizador apaga" on public.inscricoes;
create policy "inscricoes: organizador apaga" on public.inscricoes
  for delete using (public.manda_no_evento(evento_id));

-- -----------------------------------------------------------------------------
-- 5. A taxa de serviço
-- -----------------------------------------------------------------------------

/* Fica no banco, não no código: mudar o valor um dia não exige publicar o
   site de novo. O termo de uso promete aviso de 30 dias antes de mudar. */
alter table public.configuracao
  add column if not exists taxa_centavos integer not null default 100
  check (taxa_centavos >= 0);

alter table public.inscricoes
  add column if not exists taxa_centavos integer not null default 0
  check (taxa_centavos >= 0);

/* Pública: o site precisa dizer ao participante quanto é a taxa ANTES de ele
   pagar, e quem ainda não tem conta também vê a página do evento. */
create or replace function public.taxa_servico()
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select taxa_centavos from public.configuracao where id), 0);
$$;
grant execute on function public.taxa_servico() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Inscrever passa a somar a taxa
-- -----------------------------------------------------------------------------

create or replace function public.inscrever(
  p_evento      uuid,
  p_nome        text,
  p_nascimento  date        default null,
  p_email       text        default '',
  p_telefone    text        default '',
  p_eh_titular  boolean     default true,
  p_respostas   jsonb       default '{}'::jsonb,
  p_observacao  text        default ''
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_evento   public.eventos;
  v_lote     public.lotes;
  v_ocupadas integer;
  v_preco    integer;   -- o que o organizador definiu
  v_taxa     integer;   -- a parte da plataforma
  v_valor    integer;   -- o total que o participante paga
  v_status   text;
  v_id       uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para se inscrever.' using errcode = '28000';
  end if;
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome do participante.' using errcode = '22023';
  end if;

  -- serializa as inscrições do mesmo evento: sem isso, dois cliques
  -- simultâneos poderiam ocupar a mesma última vaga
  perform pg_advisory_xact_lock(hashtext(p_evento::text));

  select * into v_evento from public.eventos where id = p_evento and publicado;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = '22023';
  end if;
  if not v_evento.inscricoes_abertas then
    raise exception 'As inscrições deste evento estão encerradas.' using errcode = '22023';
  end if;

  -- primeiro lote que não venceu nem esgotou
  select l.* into v_lote
    from public.lotes l
   where l.evento_id = p_evento
     and (l.vende_ate is null or l.vende_ate >= current_date)
     and (l.quantidade = 0 or (
           select count(*) from public.inscricoes i
            where i.lote_id = l.id and i.status in ('pendente','pago')
         ) < l.quantidade)
   order by l.ordem
   limit 1;

  select count(*) into v_ocupadas
    from public.inscricoes
   where evento_id = p_evento and status in ('pendente','pago');

  if v_lote.id is null or (v_evento.vagas > 0 and v_ocupadas >= v_evento.vagas) then
    if not v_evento.espera_ativa then
      raise exception 'As vagas acabaram.' using errcode = '22023';
    end if;
    v_status := 'espera';
    v_preco  := coalesce((select preco_centavos from public.lotes
                           where evento_id = p_evento order by ordem desc limit 1), 0);
  else
    v_preco  := v_lote.preco_centavos;
    v_status := case when v_preco > 0 then 'pendente' else 'pago' end;
  end if;

  -- Evento gratuito não gera taxa: somar R$ 1,00 a uma inscrição de graça
  -- transformaria "gratuito" em mentira na cara do participante.
  v_taxa  := case when v_preco > 0 then public.taxa_servico() else 0 end;
  v_valor := v_preco + v_taxa;

  insert into public.inscricoes (
    evento_id, lote_id, titular_id, participante_nome, participante_nascimento,
    participante_email, participante_telefone, eh_titular, respostas, observacao,
    codigo, lote_nome, valor_centavos, taxa_centavos, status, pago_em
  ) values (
    p_evento, v_lote.id, auth.uid(), btrim(p_nome), p_nascimento,
    coalesce(p_email,''), coalesce(p_telefone,''), coalesce(p_eh_titular, true),
    coalesce(p_respostas, '{}'::jsonb), coalesce(p_observacao,''),
    public.gerar_codigo(), coalesce(v_lote.nome, ''), v_valor, v_taxa, v_status,
    case when v_status = 'pago' then now() else null end
  ) returning id into v_id;

  return (select to_jsonb(i) from public.inscricoes i where i.id = v_id);
end $$;

-- -----------------------------------------------------------------------------
-- 7. A cobrança usa a chave do dono do evento
-- -----------------------------------------------------------------------------

create or replace function public.cobranca(p_inscricao uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ins    public.inscricoes;
  v_ev     public.eventos;
  v_cfg    public.configuracao;
  v_chave  text;
  v_nome   text;
  v_cidade text;
begin
  -- este teste precisa vir ANTES da comparação: com auth.uid() nulo,
  -- "titular_id <> auth.uid()" resulta em NULL e o IF não dispararia
  if auth.uid() is null then
    raise exception 'Entre na sua conta.' using errcode = '28000';
  end if;
  select * into v_ins from public.inscricoes where id = p_inscricao;
  if not found then
    raise exception 'Inscrição não encontrada.' using errcode = '22023';
  end if;
  if v_ins.titular_id <> auth.uid() and not public.manda_no_evento(v_ins.evento_id) then
    raise exception 'Esta inscrição não é sua.' using errcode = '42501';
  end if;
  if v_ins.status <> 'pendente' or v_ins.valor_centavos <= 0 then
    return null;  -- nada a cobrar
  end if;

  select * into v_ev  from public.eventos     where id = v_ins.evento_id;
  select * into v_cfg from public.configuracao where id;

  -- a chave do evento manda; sem ela, a chave da casa
  v_chave  := coalesce(nullif(btrim(v_ev.chave_pix), ''), v_cfg.chave_pix);
  v_nome   := coalesce(nullif(btrim(v_ev.recebedor_nome), ''),
                       nullif(v_cfg.beneficiario, ''), v_cfg.organizacao);
  v_cidade := coalesce(nullif(btrim(v_ev.recebedor_cidade), ''), v_cfg.cidade);

  if coalesce(btrim(v_chave), '') = '' then
    return null;  -- chave Pix ainda não cadastrada
  end if;

  return jsonb_build_object(
    'chave',        v_chave,
    'beneficiario', v_nome,
    'cidade',       v_cidade,
    'centavos',     v_ins.valor_centavos,
    'taxa',         v_ins.taxa_centavos,
    'txid',         replace(v_ins.codigo, '-', '')
  );
end $$;

-- -----------------------------------------------------------------------------
-- 8. Extrato: quanto cada evento deve de taxa
-- -----------------------------------------------------------------------------

/* Só conta inscrição paga: cancelada, pendente ou reembolsada não gera taxa,
   como diz o termo de uso. O dono vê os próprios eventos; a administração da
   plataforma vê todos. */
create or replace function public.extrato_taxas()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) from (
    select jsonb_build_object(
      'evento_id',    e.id,
      'nome',         e.nome,
      'data',         e.data,
      'pagas',        count(i.id),
      'arrecadado',   coalesce(sum(i.valor_centavos), 0),
      'taxa_devida',  coalesce(sum(i.taxa_centavos), 0),
      'liquido',      coalesce(sum(i.valor_centavos - i.taxa_centavos), 0)
    ) as x
    from public.eventos e
    left join public.inscricoes i
      on i.evento_id = e.id and i.status = 'pago'
    where public.eh_organizador()
       or (e.dono_id is not null and e.dono_id = auth.uid())
    group by e.id, e.nome, e.data
  ) s;
$$;
grant execute on function public.extrato_taxas() to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Eventos que eu administro (para o painel saber o que mostrar)
-- -----------------------------------------------------------------------------

create or replace function public.sou_dono_de_algum()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.eventos e
     where e.dono_id is not null and e.dono_id = auth.uid()
  );
$$;
grant execute on function public.sou_dono_de_algum() to authenticated;

