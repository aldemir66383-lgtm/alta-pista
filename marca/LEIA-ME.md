# A marca Alta Pista

O símbolo é um monograma: o **A** e o **P** dividem a mesma haste vertical,
e o conjunto se inclina sete graus para a frente. A inclinação é o ponto
todo — é o gesto de quem corre, e é o que separa a marca de um monograma
parado qualquer.

O desenho é geometria pura, sem nenhuma tipografia. Isso significa que ele
sai idêntico em qualquer computador, celular ou impressora, sem depender de
fonte instalada — e que ninguém consegue reproduzir a marca por acidente
digitando "AP" numa fonte parecida.

## Qual arquivo usar

| Situação | Arquivo |
|---|---|
| Logotipo do site, no Painel | `selo-lima-512.png` |
| Fundo escuro | `selo-base-512.png` |
| Sobre foto ou cor qualquer | `selo-transparente-512.png` |
| Perfil de rede social | `selo-redondo-512.png` |
| Impressão, cartaz, camisa | qualquer `.svg` |
| Documento, cabeçalho de ofício | `assinatura-clara.svg` |
| Documento em fundo escuro | `assinatura-escura.svg` |

Os `.svg` não têm tamanho: servem de um botão de 16 pixels a um banner de
três metros sem perder nitidez. Os `.png` existem porque nem todo lugar
aceita SVG — o campo de logotipo do site, por exemplo.

## Como colocar no site

No Painel, seção **Identidade do site**, campo de logotipo: envie o
`selo-lima-512.png`. Preencha também o nome como `Alta Pista` e a sigla
como `AP` — a sigla é o que aparece se o logotipo não carregar.

## As cores

| | Código | Onde |
|---|---|---|
| Lima | `#C6F24E` | fundo do selo, destaques do site |
| Azul-noite | `#0B1B2B` | o monograma, as faixas escuras, texto |
| Branco | `#FFFFFF` | monograma sobre fundo escuro |

O azul profundo sustenta a parte que precisa de confiança — pagamento,
dados, comprovante — e o lima carrega a parte que precisa de energia. Uma
cor só não dá conta das duas coisas, e é por isso que a paleta anterior,
amarelo com preto, foi trocada: alto contraste demais, sobriedade de menos,
e igual à sinalização de obra que todo mundo usa.

O lima é a **única** cor viva do site. Se ela aparecer em dois lugares na
mesma tela, um dos dois está errado.

## O que não fazer

Não estique só na largura ou só na altura — o monograma tem uma inclinação
própria e esticar cria uma segunda inclinação que briga com ela. Não troque
o lima por outra cor no selo padrão; para fundos coloridos existe a
versão transparente. E não recrie o "AP" digitando em outra fonte: o
desenho tem proporções próprias que nenhuma fonte reproduz.

## Regerar tudo

```bash
node marca/gerar.mjs
```

Refaz os sete SVG e os oito PNG a partir da mesma geometria. O rasterizador
é escrito à mão, sem biblioteca: ele responde, para cada ponto da imagem,
se aquele ponto é tinta ou fundo, e olha dezesseis pontos por pixel para a
borda sair lisa. É por isso que o PNG nunca sai diferente do SVG — os dois
leem o mesmo desenho.
