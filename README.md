# Balcão de Inscrições

Site de inscrições e pagamento por Pix para as corridas e eventos da escola.
Cada pessoa entra com o próprio e-mail, se inscreve (para si ou para um
dependente), recebe o QR Code do Pix e acompanha a situação. A organização tem
um painel para publicar eventos com edital, definir lotes de preço, montar o
formulário e confirmar os pagamentos.

## O que garante que os dados não vazam

Esta é a diferença central em relação a uma página solta. Os dados pessoais
vivem no Postgres do Supabase, protegidos por **Row Level Security** — regras
aplicadas pelo próprio banco, não pelo código do site. Mesmo que alguém abra o
console do navegador e chame a API na mão, o banco só devolve o que aquela
pessoa tem direito de ver.

Na prática:

- **Inscrições.** A regra é `titular_id = auth.uid()`. Você enxerga as suas e
  as dos seus dependentes, e nada mais. Organizadores enxergam tudo.
- **Inserir inscrição é proibido diretamente.** Não existe política de INSERT
  na tabela. O único caminho é a função `inscrever()`, que roda no servidor e
  decide o lote, o preço e o status. Não adianta mexer no navegador para pagar
  menos ou furar a fila.
- **Quem é organizador está numa tabela sem escrita.** Ninguém se promove pelo
  site; só por SQL no painel do Supabase.
- **A chave Pix não é legível pelo site.** Ela fica na tabela `configuracao`,
  visível apenas para organizadores. Quando um inscrito pede o QR Code, a
  função `cobranca()` confere se a inscrição é dele antes de devolver os dados.
- **Contagens sem exposição.** As vagas restantes e os vendidos por lote saem
  de funções que devolvem só números, nunca a lista de pessoas.
- **Última vaga sem corrida.** A função `inscrever()` usa trava por evento, de
  modo que dois cliques simultâneos não ocupam a mesma vaga.
- **Ninguém entope o evento de graça.** Uma conta não acumula mais de cinco
  inscrições não pagas no mesmo evento, nem inscreve o mesmo nome duas vezes
  (`supabase/0012`). E pendências sem pagamento há mais de 48h são canceladas
  sozinhas, devolvendo a vaga para a fila (`supabase/0013`).
- **Nada de código de fora.** O site não importa nenhum JavaScript de CDN: a
  biblioteca do Supabase é uma cópia local em `site/vendor/`. Um `Content-
  Security-Policy` no `netlify.toml` manda o navegador só executar script do
  próprio site e só conversar com o Supabase.

A `anon key` que fica no `config.js` é pública por natureza e não é um segredo.
A que **nunca** pode aparecer no site é a `service_role`: ela ignora todas as
políticas. Se ela vazar, gere outra imediatamente no painel do Supabase.

## Montando (uma vez, ~20 minutos)

### 1. Criar o projeto no Supabase

1. Crie uma conta em <https://supabase.com> e um projeto novo (plano gratuito
   serve com folga para uma corrida escolar).
2. Escolha a região **South America (São Paulo)** — deixa o site mais rápido.
3. Guarde a senha do banco que ele pedir.

### 2. Criar as tabelas

**Jeito rápido:** abra **SQL Editor › New query**, cole o conteúdo inteiro de
[`supabase/0000_tudo.sql`](supabase/0000_tudo.sql) e clique em **Run**. Esse
arquivo é a junção dos três abaixo, na ordem certa — é só isso que você precisa
rodar.

Se preferir por partes, rode os três **nesta ordem**, cada um por vez:

1. [`supabase/0001_esquema.sql`](supabase/0001_esquema.sql) — tabelas,
   políticas de segurança e regras de inscrição.
2. [`supabase/0002_capas_categorias_resultados.sql`](supabase/0002_capas_categorias_resultados.sql)
   — modalidade, cidade/UF, percursos, imagem de capa, destaque e resultados.
3. [`supabase/0003_identidade.sql`](supabase/0003_identidade.sql) — iniciais,
   nome do site, cor de acento, logotipo e textos do rodapé.

Cada um deve terminar com "Success". Pode rodar de novo quando quiser: os três
são idempotentes.

**Depois**, rode também, na ordem do número, os arquivos `supabase/0005` em
diante — equipe pelo painel, fechamento das funções internas, número de peito,
personalização, e as travas `0012` (enxurrada de inscrições) e `0013`
(pendências que vencem). Todos são idempotentes e cada um termina com
"Success". O `0013` tenta ligar o `pg_cron` sozinho; se aparecer um aviso
pedindo para ligá-lo em **Database › Extensions**, ligue e rode o `0013` de
novo.

### 3. Ligar o login por e-mail

Em **Authentication › Providers**, confirme que **Email** está ativo e que
*Confirm email* está ligado. Em **Authentication › URL Configuration**, ponha o
endereço do site em **Site URL** e também em **Redirect URLs**.

#### O envio de e-mail, antes de divulgar

Todo mundo entra por link enviado por e-mail — não existe senha. O envio que o
Supabase oferece de graça é limitado a poucas mensagens por hora e é declarado
como sendo para desenvolvimento. Em dia de inscrição, isso significa que a
maioria das pessoas simplesmente não recebe o link, e conclui que o site não
funciona.

A correção é gratuita e leva uns quinze minutos: usar um serviço de envio
próprio. Qualquer um destes cobre com folga uma corrida de escola.

| Serviço | Grátis até | Servidor (host) | Porta | Usuário |
|---|---|---|---|---|
| **Brevo** | 300 mensagens por dia | `smtp-relay.brevo.com` | 587 | o login que ele mostrar |
| **Resend** | 3.000 por mês, 100 por dia | `smtp.resend.com` | 587 | `resend` |
| **Gmail da escola** | ~500 por dia | `smtp.gmail.com` | 587 | o endereço completo |

Com a conta criada, o serviço entrega uma senha de aplicativo — no Gmail ela sai
em *Conta Google › Segurança › Senhas de app*, e **não** é a senha normal da
conta. Então, em **Project Settings › Auth › SMTP Settings**, ligue *Enable
Custom SMTP* e preencha:

- **Sender email**: o endereço que aparece como remetente
- **Sender name**: o nome da organização, como as pessoas devem lê-lo
- **Host** e **Port**: da tabela acima
- **Username** e **Password**: os que o serviço entregou

Logo abaixo, em *Rate limits*, suba o limite de e-mails por hora para algo
compatível com o serviço contratado — o padrão continua baixo mesmo depois de
ligar o SMTP próprio.

Para conferir, saia da sua conta no site e peça um link de acesso. Ele deve
chegar em segundos, com o nome da organização no remetente. Se cair no spam,
vale mandar um teste para dois ou três endereços diferentes antes de divulgar.

> Enquanto isso não estiver feito, o site avisa em português quando o limite
> estoura, em vez de mostrar o erro cru — mas o aviso não faz o e-mail chegar.

### 4. Configurar o site

Pegue os dois valores em **Project Settings › API** e rode, na pasta do projeto:

```bash
node configurar.mjs https://SEU-PROJETO.supabase.co SUA_CHAVE_ANON
```

O script escreve o `site/config.js` e, mais importante, **testa a instalação**:
confere se a chave é aceita, se as tabelas e funções existem, se o balde de
imagens foi criado e — o teste que mais importa — se a tabela de inscrições está
mesmo fechada para quem não fez login. Ele também recusa a chave `service_role`
se você copiar a errada por engano, lendo o papel de dentro do próprio token.

Se preferir na mão, copie `site/config.exemplo.js` para `site/config.js` e
preencha os dois campos.

### 5. Publicar

Qualquer hospedagem de site estático serve, porque não existe servidor para
rodar. A mais simples:

1. Entre em <https://app.netlify.com/drop>.
2. Arraste a pasta `site` inteira para a página.
3. Copie o endereço que ele gerar e volte no passo 3 para colocá-lo em
   **Site URL** e **Redirect URLs** do Supabase.

Para testar na sua máquina antes:

```bash
npx serve site
```

### 6. Virar organizador

Entre no site com o seu e-mail uma vez, para a conta existir. Depois, no
**SQL Editor** do Supabase:

```sql
insert into public.organizadores (user_id)
select id from auth.users where email = 'seu-email@exemplo.com'
on conflict do nothing;
```

Repita trocando pelo e-mail do coordenador. Recarregue o site: a aba **Painel**
aparece.

## Usando

### Deixando o site com a sua cara

A primeira seção do Painel é **Identidade do site** e não exige mexer em código:

- **Iniciais do selo** — uma a três letras no círculo do topo. Coloque as suas.
- **Nome do site** — o que aparece grande ao lado do selo.
- **Logotipo** — se enviar uma imagem quadrada, ela substitui as iniciais.
- **Cor de acento** — muda botões, selos e destaques do site inteiro. O site
  escolhe sozinho se o texto por cima da cor fica preto ou branco, conforme o
  quanto ela é clara, então não tem como ficar ilegível.
- **Rodapé** — texto sobre a organização, contato, WhatsApp e Instagram.

Tudo vale para todo mundo assim que você salvar.

### O resto

No **Painel**, salve os **dados do Pix** (chave, nome do recebedor como
está na conta, cidade). Depois crie o evento: ele nasce como **rascunho** e só
aparece no site quando você clicar em **Publicar** — dá para montar tudo com
calma antes de abrir.

Dentro do evento você define os **lotes** (o primeiro que não venceu nem esgotou
é o que está à venda), escreve o **edital** e monta as **perguntas** do
formulário. O botão *Usar o conjunto de corrida* já traz percurso, camiseta,
categoria, contato de emergência e vínculo com a escola.

O edital aceita uma formatação simples: `## Título`, `- item de lista` e
`**negrito**`. Quem abre o evento pode imprimir ou salvar em PDF pelo botão.

Quando as vagas acabam, o site passa a oferecer a **lista de espera**. No painel,
*Chamar da fila* transforma a espera em inscrição pendente e o Pix aparece para
a pessoa em *Minhas inscrições*.

### A capa e o destaque

Cada evento aceita uma **imagem de capa** (envie no editor; ela vai para o balde
público `capas` do Supabase Storage). A capa aparece no cartão e na faixa grande
da abertura. Sem capa, o cartão mostra as iniciais do evento sobre um fundo
grafite — funciona, mas a página fica bem melhor com foto.

Marque **mostrar em destaque** nos eventos que devem girar na faixa de abertura.
Com dois ou mais marcados, o carrossel mostra exatamente esses. Se você marcar
um só, ou nenhum, ele completa com os próximos eventos abertos até três, para a
faixa não ficar parada.

### Resultados

No painel, o botão **Resultados** de cada evento abre uma caixa onde você cola a
apuração — uma linha por atleta, campos separados por ponto e vírgula ou
tabulação, na ordem *posição; atleta; equipe; categoria; percurso; tempo*. É o
formato que sai de qualquer planilha de cronometragem; um cabeçalho colado junto
é ignorado, e colunas do fim podem faltar. Salvar substitui a classificação
inteira.

A classificação só aparece na aba **Resultados** do site depois que você marcar
*publicar no site* — assim ninguém vê uma apuração pela metade. Os três
primeiros saem destacados em amarelo, e a página tem botão de imprimir.

> Resultados são públicos por natureza: quem abrir o site vê nome, equipe e
> tempo de quem correu, como em qualquer prova. Isso é diferente da lista de
> inscritos, que continua trancada. Se algum participante pedir para não
> aparecer, é só não incluir a linha dele na colagem.

## Testes

```bash
npm install   # só na primeira vez
npm test
```

São duas baterias.

A do **pagamento** (`testes/pix-e-qr.mjs`) confere o gerador de Pix contra o
vetor de referência do CRC-16, desmonta o código campo a campo para ver se bate
com o padrão do Banco Central — versão, moeda, país, a chave dentro do campo do
arranjo, o valor com duas casas, o identificador da inscrição — e manda uma
biblioteca independente ler de volta cada QR Code gerado. São os dois pedaços
escritos do zero, sem biblioteca, e ficam entre o participante e o dinheiro.

A da **segurança** (`testes/seguranca.mjs`) roda contra o banco de verdade
usando **só a chave pública** — exatamente o que um visitante mal-intencionado
teria na mão. Cada teste responde à pergunta "o que dá para fazer sem ter
conta?": ler a lista de inscritos, alterar a chave Pix, se promover a
organizador, cancelar inscrição alheia, apagar evento. Todos devem ser
recusados. Foi essa bateria que encontrou a função `gerar_codigo` exposta,
corrigida pelo `supabase/0006`.

Nenhuma das duas escreve no banco, então dá para rodar a qualquer momento,
inclusive com as inscrições abertas.

As duas rodam sozinhas pelo GitHub Actions (`.github/workflows/vigia.yml`) a
cada alteração no código e **de dois em dois dias**. Essa visita periódica tem
um segundo papel: o plano gratuito do Supabase pausa projetos com cerca de sete
dias de pouca atividade, e sem ela o site sairia do ar justamente entre o cartaz
ser colado e as inscrições abrirem. O Actions é gratuito e sem limite de minutos
em repositório público, então isso não custa nada.

## O que ainda é manual

A confirmação do pagamento. O Pix gerado é o padrão do Banco Central e cai
direto na conta, mas sem um gateway o banco não avisa o site que o dinheiro
entrou — alguém confere o extrato e clica em **Marcar pago**. Para automatizar
seria preciso contratar um gateway (Mercado Pago, Asaas, Efí) e um endpoint que
receba o aviso deles; dá para acrescentar depois sem refazer nada do que está
aqui.

Antes de divulgar, teste a cobrança com valor pequeno lendo o QR no app do banco
e conferindo se o nome do recebedor aparece certo.

## Sobre a LGPD

A escola é a responsável pelos dados coletados. Vale combinar antes:

- peça só o que a corrida precisa (a lista sugerida já é enxuta);
- diga na inscrição para que servem os dados e por quanto tempo ficam;
- apague os dados depois do evento — o painel permite apagar inscrições, e o
  Supabase permite apagar a conta da pessoa a pedido dela.

Como há menores de idade, quem se inscreve é o responsável, e é a conta dele que
guarda o vínculo: por isso a inscrição tem o campo *estou inscrevendo outra
pessoa*, com nome e data de nascimento do participante separados dos dados da
conta.

## Arquivos

```
configurar.mjs                                  escreve o config.js e testa a instalação
testes/pix-e-qr.mjs                             confere o código Pix e o QR Code
testes/seguranca.mjs                            bateria de segurança, roda sem navegador
.github/workflows/vigia.yml                     testes automáticos e antipausa do banco
supabase/0000_tudo.sql                          os três arquivos abaixo juntos, para colar de uma vez
supabase/0001_esquema.sql                       tabelas, políticas de segurança e regras
supabase/0002_capas_categorias_resultados.sql   capas, modalidade, destaque e resultados
supabase/0003_identidade.sql                    marca editável: iniciais, nome, cor, rodapé
supabase/0005_equipe.sql                        dar e tirar acesso ao painel pelo site
supabase/0006_fechar_funcoes_internas.sql       tira as funções internas do alcance público
supabase/0012_limite_de_inscricoes.sql          trava contra enxurrada de inscrições não pagas
supabase/0013_expirar_pendencias.sql            cancela pendências vencidas e devolve a vaga
netlify.toml                                    cabeçalhos de segurança e Content-Security-Policy
site/index.html                                 estrutura da página
site/estilo.css                                 identidade visual (claro e escuro)
site/app.js                                     telas e interações
site/api.js                                     conversa com o Supabase
site/pix.js                                     código Pix (EMV do Banco Central + CRC-16)
site/qr.js                                      desenha o QR Code, sem biblioteca externa
site/vendor/supabase-js.js                      cópia local da biblioteca do Supabase (npm run vendor)
site/config.exemplo.js                          modelo do config.js
```
