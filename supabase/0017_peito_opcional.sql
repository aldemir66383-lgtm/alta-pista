/* ============================================================
   0017 - Número de peito deixa de ser obrigatório

   Nem todo evento usa número de peito. Uma caminhada, uma aula
   aberta, um evento com camiseta numerada comprada pronta — em
   todos eles a folha que o site desenha não serve para nada, e
   hoje ela aparece assim mesmo.

   Duas colunas resolvem os dois casos:

     peito_ativo       o evento usa número de peito? Em branco
                       (false), o site não mostra a seção do peito,
                       não oferece a impressão e não exibe o número
                       na lista de inscritos.

     peito_pronto_url  uma arte de peito já pronta, enviada pela
                       organização. Quando preenchida, a impressão
                       usa essa imagem em vez do desenho gerado —
                       para quem já tem o peito fechado com a
                       gráfica ou com o patrocinador.

   Os eventos que já existem continuam como estavam: peito_ativo
   nasce true, que é o comportamento de hoje.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

alter table public.eventos
  add column if not exists peito_ativo boolean not null default true;

alter table public.eventos
  add column if not exists peito_pronto_url text not null default '';

/* Deixa explícito para quem for ler a tabela depois. */
comment on column public.eventos.peito_ativo is
  'O evento usa número de peito. Falso esconde a folha, a impressão e o número.';
comment on column public.eventos.peito_pronto_url is
  'Arte de peito já pronta. Preenchida, substitui o desenho gerado pelo site.';
