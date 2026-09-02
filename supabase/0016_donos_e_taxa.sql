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
