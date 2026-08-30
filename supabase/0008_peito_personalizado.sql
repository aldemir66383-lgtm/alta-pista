/* ============================================================ */
/*  Balcao de Inscricoes                                        */
/*  0008 - Personalizacao do numero de peito                    */
/*                                                              */
/*  Cada evento passa a mandar na aparencia do proprio numero:   */
/*  quantos algarismos, a cor, o logotipo e uma arte de fundo.   */
/*                                                              */
/*  Cole no SQL Editor do Supabase e clique em Run.             */
/*  Pode rodar mais de uma vez sem estragar nada.               */
/* ============================================================ */


/*  Quantos algarismos o numero sempre tera. Com 4, o corredor 7  */
/*  vira 0007. Zero desliga o preenchimento e mostra o numero cru.*/
alter table public.eventos
  add column if not exists numero_digitos integer not null default 0;

/*  Cor da faixa e do selo do percurso. Vazio significa usar a    */
/*  cor de acento do site, para o organizador nao precisar        */
/*  escolher nada se nao quiser.                                  */
alter table public.eventos
  add column if not exists peito_cor text not null default '';

/*  Logotipo do evento, no lugar da sigla da marca.               */
alter table public.eventos
  add column if not exists peito_logo_url text not null default '';

/*  Arte pronta ocupando a folha inteira, atras do numero.        */
alter table public.eventos
  add column if not exists peito_fundo_url text not null default '';


/*  Limites de sanidade. Nao sao seguranca (o site so escreve com  */
/*  organizador logado), sao para um erro de digitacao nao gerar   */
/*  mil folhas impressas erradas.                                  */

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_numero_digitos_limite') then
    alter table public.eventos
      add constraint eventos_numero_digitos_limite
      check (numero_digitos >= 0 and numero_digitos <= 6);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'eventos_peito_cor_hex') then
    alter table public.eventos
      add constraint eventos_peito_cor_hex
      check (peito_cor = '' or peito_cor ~* '^#[0-9a-f]{6}$');
  end if;
end $$;

/* ============================================================ */
/*  Depois de rodar, o formulario do evento no Painel ganha a     */
/*  secao "Aparencia do numero de peito", com previa ao vivo.     */
/* ============================================================ */
