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
