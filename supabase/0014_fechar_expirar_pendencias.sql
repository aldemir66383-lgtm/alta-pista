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
