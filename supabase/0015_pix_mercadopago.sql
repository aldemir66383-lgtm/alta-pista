/* ============================================================
   0015 - Cobrança Pix automática pelo Mercado Pago

   Mantém uma cobrança única, com valor imutável, para cada
   inscrição pendente. Nenhuma chave do Mercado Pago fica no
   banco ou no navegador: o access token vive somente nas
   variáveis de ambiente das funções da Netlify.

   Cole no SQL Editor do Supabase e clique em Run.
   Idempotente: pode rodar de novo sem estragar nada.
   ============================================================ */

create table if not exists public.pix_cobrancas (
  id                uuid primary key default gen_random_uuid(),
  inscricao_id      uuid not null references public.inscricoes(id) on delete cascade,
  correlation_id    uuid not null unique,          -- external_reference enviado ao Mercado Pago
  transaction_id    text unique,                   -- id do pagamento no Mercado Pago
  valor_centavos    integer not null check (valor_centavos > 0),
  status            text not null default 'ativa'
                    check (status in ('ativa','paga','expirada','cancelada','falhou')),
  payload_pix       text,                          -- "copia e cola" (EMV) do QR
  expira_em         timestamptz not null,
  end_to_end_id     text unique,                   -- referência da liquidação confirmada
  pago_em           timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index if not exists pix_cobrancas_por_inscricao
  on public.pix_cobrancas (inscricao_id, status, expira_em desc);

alter table public.pix_cobrancas enable row level security;

-- A tabela não é exposta ao navegador. Só a função de servidor, autenticada
-- com service_role, cria e atualiza cobranças após falar com o Mercado Pago.
revoke all on table public.pix_cobrancas from anon, authenticated;

/* O número de peito já é atribuído pelo gatilho existente quando a inscrição
   muda para "pago". A função de webhook atualiza public.inscricoes usando
   service_role, apenas depois de reconsultar o pagamento na API do Mercado
   Pago e conferir estado e valor. */
