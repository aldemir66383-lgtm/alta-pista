/* ============================================================
   0020 - Fecha a chave Pix de verdade

   A 0018 tentou isto com "revoke select (colunas) ... from anon"
   e nao teve efeito nenhum. O motivo: no PostgreSQL, revogar a
   permissao de uma COLUNA nao restringe nada enquanto o papel
   tiver permissao na TABELA inteira - e o anon tem, porque o
   Supabase concede "select on all tables in schema public".
   O comando roda, nao da erro, e a chave continua legivel.

   O jeito certo e o inverso: tirar a permissao da tabela e
   devolve-la coluna a coluna, menos as tres sensiveis.

   A lista de colunas e montada na hora, a partir do proprio
   catalogo do banco, para nao depender de eu lembrar de todas -
   e para que uma coluna nova, criada no futuro, nasca fechada
   para o publico em vez de aberta por descuido.

   O site publico nao le esta tabela: a lista e a pagina do
   evento vem de eventos_publicos() e evento_publico(), que sao
   security definer. O organizador entra com conta e usa o papel
   authenticated, que nao e tocado aqui.

   Idempotente: pode rodar de novo a vontade.
   ============================================================ */

do $$
declare colunas text;
begin
  revoke select on public.eventos from anon;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into colunas
    from information_schema.columns
   where table_schema = 'public'
     and table_name  = 'eventos'
     and column_name not in ('chave_pix', 'recebedor_nome', 'recebedor_cidade');

  execute 'grant select (' || colunas || ') on public.eventos to anon';
end $$;
