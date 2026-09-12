/* ============================================================
   0026 - Corrigir os dados da inscrição

   Até agora ninguém conseguia arrumar um nome escrito errado.
   Nem a pessoa (a política da tabela só deixa a organização
   escrever), nem a organização (o Painel nunca teve essa tela).
   O jeito era apagar e refazer — perdendo o código, a data da
   inscrição e o comprovante já anexado.

   O erro é quase sempre bobo e é da própria pessoa: faltou o
   sobrenome, o acento, um dígito do telefone. Se só a
   organização puder corrigir, cada letra errada vira uma
   mensagem no WhatsApp de quem já está ocupado conferindo
   pagamento. Então a pessoa corrige a si mesma.

   Mas com uma trava, e ela existe por um motivo concreto: visto
   de fora, "corrigir o nome" e "passar a minha inscrição paga
   para outra pessoa" são a MESMA operação. Como as provas têm
   vaga limitada e kit por pessoa, uma inscrição que troca de
   dono sem ninguém saber tira a camisa de alguém e põe na
   largada quem não está na lista. Por isso:

     - a pessoa corrige só a PRÓPRIA inscrição, e só enquanto a
       prova não passou e o resultado não saiu. Depois disso o
       nome virou documento: lista de largada, número de peito,
       certificado;
     - a organização corrige qualquer uma, a qualquer momento,
       porque sempre sobra o caso que a regra não previu;
     - toda correção fica registrada: quem, quando, de quê para
       quê. Sem isso não há como distinguir o conserto do
       repasse.

   Só mexe em nome, nascimento, e-mail e telefone. Situação,
   valor, lote, número de peito e evento ficam de fora de
   propósito — corrigir o nome não pode virar porta para mudar
   quanto se deve.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

-- -----------------------------------------------------------------------------
-- 1. O registro das correções
-- -----------------------------------------------------------------------------
create table if not exists public.correcoes_inscricao (
  id            uuid primary key default gen_random_uuid(),
  inscricao_id  uuid not null references public.inscricoes(id) on delete cascade,
  alterado_por  uuid references auth.users(id) on delete set null,
  pela_organizacao boolean not null default false,
  antes         jsonb not null,
  depois        jsonb not null,
  corrigido_em  timestamptz not null default now()
);

comment on table public.correcoes_inscricao is
  'Histórico das correções de dados da inscrição: quem mudou, quando, de quê para quê.';

create index if not exists correcoes_por_inscricao
  on public.correcoes_inscricao (inscricao_id, corrigido_em desc);

alter table public.correcoes_inscricao enable row level security;

/* Ler: quem enxerga a inscrição enxerga o histórico dela. Escrever: ninguém,
   direto. Só a função abaixo grava, e ela roda com permissão própria — um
   histórico que o interessado pode editar não serve de histórico. */
drop policy if exists "correcoes: quem ve a inscricao ve o historico" on public.correcoes_inscricao;
create policy "correcoes: quem ve a inscricao ve o historico" on public.correcoes_inscricao
  for select using (
    exists (
      select 1 from public.inscricoes i
      where i.id = inscricao_id
        and (i.titular_id = auth.uid() or public.manda_no_evento(i.evento_id))
    )
  );

revoke insert, update, delete on public.correcoes_inscricao from anon, authenticated;
grant select on public.correcoes_inscricao to authenticated;

-- -----------------------------------------------------------------------------
-- 2. A correção
--    SECURITY DEFINER de propósito. A alternativa seria abrir UPDATE na tabela
--    para o titular, mas as políticas do Postgres decidem por LINHA, não por
--    COLUNA: quem pudesse corrigir o nome poderia, na mesma tacada, marcar a
--    própria inscrição como paga. Aqui as colunas que se pode tocar são as
--    quatro escritas abaixo, e ponto.
-- -----------------------------------------------------------------------------
create or replace function public.corrigir_inscricao(
  p_id          uuid,
  p_nome        text,
  p_nascimento  date    default null,
  p_email       text    default '',
  p_telefone    text    default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ins     public.inscricoes;
  v_evento  public.eventos;
  v_manda   boolean;
  v_antes   jsonb;
  v_depois  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para corrigir a inscrição.' using errcode = '28000';
  end if;

  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'O nome não pode ficar em branco.' using errcode = '22023';
  end if;
  if length(btrim(p_nome)) < 3 then
    raise exception 'Escreva o nome completo do participante.' using errcode = '22023';
  end if;

  select * into v_ins from public.inscricoes where id = p_id;
  if not found then
    raise exception 'Inscrição não encontrada.' using errcode = '22023';
  end if;

  select * into v_evento from public.eventos where id = v_ins.evento_id;
  v_manda := public.manda_no_evento(v_ins.evento_id);

  if not v_manda then
    if v_ins.titular_id <> auth.uid() then
      raise exception 'Esta inscrição não é sua.' using errcode = '42501';
    end if;
    if v_ins.status = 'cancelada' then
      raise exception 'Esta inscrição está cancelada. Fale com a organização.' using errcode = '22023';
    end if;
    if v_evento.resultados_publicados then
      raise exception 'O resultado desta prova já saiu; o nome não muda mais. Fale com a organização.'
        using errcode = '22023';
    end if;
    if v_evento.data is not null and v_evento.data < current_date then
      raise exception 'Esta prova já aconteceu. Fale com a organização.' using errcode = '22023';
    end if;
  end if;

  v_antes := jsonb_build_object(
    'participante_nome', v_ins.participante_nome,
    'participante_nascimento', v_ins.participante_nascimento,
    'participante_email', v_ins.participante_email,
    'participante_telefone', v_ins.participante_telefone
  );
  v_depois := jsonb_build_object(
    'participante_nome', btrim(p_nome),
    'participante_nascimento', p_nascimento,
    'participante_email', coalesce(btrim(p_email), ''),
    'participante_telefone', coalesce(btrim(p_telefone), '')
  );

  -- Nada mudou: não grava linha de histórico à toa.
  if v_antes = v_depois then
    return to_jsonb(v_ins);
  end if;

  update public.inscricoes
     set participante_nome       = btrim(p_nome),
         participante_nascimento = p_nascimento,
         participante_email      = coalesce(btrim(p_email), ''),
         participante_telefone   = coalesce(btrim(p_telefone), '')
   where id = p_id
  returning * into v_ins;

  insert into public.correcoes_inscricao
    (inscricao_id, alterado_por, pela_organizacao, antes, depois)
  values (p_id, auth.uid(), v_manda, v_antes, v_depois);

  return to_jsonb(v_ins);
end $$;

revoke all on function public.corrigir_inscricao(uuid, text, date, text, text) from public, anon;
grant execute on function public.corrigir_inscricao(uuid, text, date, text, text) to authenticated;
