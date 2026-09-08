/* ============================================================
   0021 - Registro do aceite dos termos

   O site já exige o aceite antes de pagar e antes de publicar um
   evento. Mas exigir e provar são coisas diferentes: hoje, se
   alguém contestar a taxa de serviço ou o uso da imagem numa
   foto, a única resposta possível é "o site exigia marcar" — o
   que não diz quem marcou, quando, nem qual texto estava no ar
   naquele dia.

   Esta tabela guarda isso. Uma linha por aceite: quem aceitou,
   o que estava aceitando, a versão dos termos que ele viu e o
   instante em que marcou.

   Fica em tabela própria, e não em colunas dentro de
   `inscricoes`, de propósito. O caminho da inscrição já está em
   produção, com gente se inscrevendo agora; mexer na função
   `inscrever()` a esta altura arriscaria o que funciona para
   ganhar um registro que pode viver ao lado, sem tocar em nada.

   Guardar isto é o mínimo do que a LGPD chama de demonstrar o
   consentimento — e é também o que separa um termo publicado de
   um termo efetivamente aceito.

   Idempotente: pode rodar de novo à vontade.
   ============================================================ */

create table if not exists public.aceites_termos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tipo        text not null check (tipo in ('inscricao', 'evento')),
  referencia  uuid,                       -- a inscrição ou o evento aceito
  versao      text not null,              -- a data da versão dos termos vista
  aceito_em   timestamptz not null default now()
);

comment on table public.aceites_termos is
  'Prova de que os termos foram aceitos: quem, o quê, qual versão e quando.';
comment on column public.aceites_termos.tipo is
  'inscricao = participante aceitando antes de pagar; evento = organizador publicando.';
comment on column public.aceites_termos.versao is
  'A data da última atualização dos termos que estava no ar quando a pessoa marcou.';

create index if not exists aceites_user_idx on public.aceites_termos (user_id);
create index if not exists aceites_ref_idx  on public.aceites_termos (referencia);

alter table public.aceites_termos enable row level security;

/* Cada pessoa registra o próprio aceite, e só em nome dela mesma.
   Sem isto, alguém poderia gravar um "aceite" no nome de outra pessoa — o que
   destruiria justamente o valor de prova que a tabela existe para ter. */
drop policy if exists "aceites: cada um registra o seu" on public.aceites_termos;
create policy "aceites: cada um registra o seu" on public.aceites_termos
  for insert with check (auth.uid() is not null and user_id = auth.uid());

/* Ler: a pessoa vê os próprios aceites; a administração da plataforma vê
   todos, que é quem precisa responder se um dia houver questionamento. */
drop policy if exists "aceites: le o proprio" on public.aceites_termos;
create policy "aceites: le o proprio" on public.aceites_termos
  for select using (user_id = auth.uid() or public.eh_organizador());

/* Ninguém altera nem apaga: um registro de prova que pode ser editado depois
   não prova nada. Não criamos política de update nem de delete — sem política,
   a operação é negada a todo mundo. */

grant select, insert on public.aceites_termos to authenticated;
