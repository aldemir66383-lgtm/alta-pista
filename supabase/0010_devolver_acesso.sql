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
