# site/vendor/

Cópias locais de bibliotecas de terceiros. O site **não** carrega nada de CDN:
tudo o que ele precisa está aqui dentro, servido do mesmo endereço do site.

Por que isso importa para a segurança: um `import` de `https://esm.sh/...` faz o
navegador de cada visitante buscar código num servidor que não é o nosso. Se
esse servidor sair do ar, o site não abre. Se for invadido, passa a rodar o
código do invasor **com a sessão da pessoa que está logada** — inclusive a da
organização. Com a cópia local, isso deixa de ser possível.

## supabase-js.js

`@supabase/supabase-js` versão **2.45.4**, empacotado num arquivo só.

Para atualizar a versão:

1. Em `package.json`, troque `"@supabase/supabase-js": "2.45.4"` pela versão nova.
2. `npm install`
3. `npm run vendor`
4. `npm test` e abra o site com `npm run servir` para conferir o login.

O arquivo `vendor.entrada.mjs`, na raiz do projeto, é o ponto de entrada que o
`npm run vendor` empacota. Não é usado pelo site em si.
