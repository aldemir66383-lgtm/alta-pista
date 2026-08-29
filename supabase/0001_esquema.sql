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
