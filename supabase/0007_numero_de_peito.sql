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
