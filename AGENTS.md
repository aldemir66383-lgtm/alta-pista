# Balcão de Inscrições

Site de inscrições e pagamento por Pix para as corridas e eventos da escola.
Site estático em `site/` (HTML, CSS e JavaScript puro, sem build), com Supabase
como banco. O SQL das tabelas, políticas e funções está em `supabase/`.

Publicado na Vercel a partir do GitHub (`aldemir66383-lgtm/alta-pista`):
páginas em `site/`, funções de servidor em `api/`, configuração em `vercel.json`
(o `netlify.toml` fica como reserva). **Este repositório precisa continuar
separado dos outros projetos por causa disso.**

## Como o usuário trabalha

Ele não usa terminal nem git. Para abrir e salvar, ele clica duas vezes nos
atalhos que ficam em `Documentos\Projetos`:
`Abrir meus projetos.cmd` e `Salvar meu trabalho.cmd`.

Sempre executar as tarefas por ele em vez de entregar um passo a passo. Ver a
memória `entregar-sem-exigir-git` e `executar-em-vez-de-instruir`.

## Testes

`npm test` roda os três: Pix e QR Code, número de peito e segurança.
