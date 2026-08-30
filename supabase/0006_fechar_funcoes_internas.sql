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
