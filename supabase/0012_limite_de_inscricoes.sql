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
