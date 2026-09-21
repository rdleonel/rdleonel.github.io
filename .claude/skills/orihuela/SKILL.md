---
name: orihuela
description: Atualiza as carteiras do app Orihuela Consulting (pasta orihuela/) a partir de prints e notas da corretora XP. Use sempre que a pessoa mandar imagem de carteira, custódia, cotações, boleta ou nota de negociação, ou pedir para cadastrar cliente, lançar compra, venda, aluguel, aporte, retirada ou bônus, conferir uma posição, atualizar preços ou registrar ponto no gráfico. Use também quando a mensagem só trouxer imagens com tickers e valores e o apelido de um cliente, sem pedido explícito, porque nesse projeto isso significa atualizar a carteira. Não use para mexer no app Iron Overload da raiz do repositório.
---

# Orihuela Consulting: atualizar carteiras a partir de prints

Os dados das carteiras vivem em `orihuela/data.json`. O app no celular lê esse arquivo,
então tudo que entrar aqui aparece lá na próxima sincronização.

Nunca edite o JSON à mão para cotações, posições ou operações. Use
`node orihuela/tools/cli.js`, que compartilha o `orihuela/core.js` com o app. É isso que
garante que o número que você calcula é o mesmo que a pessoa vê na tela. Editar o JSON
direto quebra essa garantia e costuma introduzir erro de arredondamento.

## O ciclo de trabalho

1. Leia a imagem e extraia os dados.
2. Rode os comandos do CLI.
3. Confira o resultado contra a própria imagem, linha por linha, com um script.
4. Mostre a tabela comparada na resposta.
5. `validate`, commit e push.

O passo 3 não é formalidade. Prints têm números arredondados, colunas cortadas e tickers
parecidos; a conferência é o que separa um dado confiável de um palpite. Compare saldo,
quantidade, preço e o total geral, e diga na resposta quantas linhas bateram.

## Comandos

```
node orihuela/tools/cli.js show                       # estado atual
node orihuela/tools/cli.js validate                   # pendências conhecidas
node orihuela/tools/cli.js quotes PETR4=38,12 VALE3=61,30 [--date AAAA-MM-DD] [--no-snapshot]
node orihuela/tools/cli.js snapshot [--date AAAA-MM-DD]
node orihuela/tools/cli.js client add "Apelido" [--cash 0] [--bonus 36000 --bonus-date AAAA-MM-DD]
node orihuela/tools/cli.js client edit "Apelido" [--name X] [--cash X] [--capital X] [--bonus X] [--bonus-date D]
node orihuela/tools/cli.js client remove "Apelido"
node orihuela/tools/cli.js position set "Apelido" PETR4 200 31,40      # negativo = vendida
node orihuela/tools/cli.js position remove "Apelido" PETR4
node orihuela/tools/cli.js tx "Apelido" buy|sell TICKER QTD PREÇO [--date D] [--note "..."]
node orihuela/tools/cli.js tx "Apelido" short TICKER QTD PREÇO         # abre ou aumenta vendida
node orihuela/tools/cli.js tx "Apelido" deposit|withdraw VALOR
node orihuela/tools/cli.js tx "Apelido" bonus [VALOR]                  # sem valor usa o patrimônio de hoje
node orihuela/tools/cli.js tx "Apelido" undo                           # desfaz a última operação
node orihuela/tools/cli.js point "Apelido" AAAA-MM-DD VALOR [--ret 5,2]
node orihuela/tools/cli.js point remove "Apelido" AAAA-MM-DD
```

Decimais vão com vírgula. `12.146` seria lido como doze mil e cento e quarenta e seis.

`quotes` registra um ponto no gráfico de todos os clientes na data informada, porque a
cotação é global: mudar o preço de um papel muda o patrimônio de quem o tem. Avise na
resposta quando isso afetar clientes além do que está em pauta.

## Lendo cada tipo de imagem

**Carteira ou posição consolidada.** Traz ticker, quantidade, preço médio e preço atual.
Use `client add` e um `position set` por papel. Quantidade negativa, ou a etiqueta
"Aluguel - Tomador", é posição vendida: passe o número negativo.

**Custódia.** Lista todos os ativos numa tela só, sem preço médio. Serve para conferir
que não faltou papel e que as quantidades estão certas.

**Cotações.** Vários papéis com o último preço. Vira um `quotes` só.

**Boleta ou nota de negociação.** Traz o preço real de uma operação. Serve para dois
casos: lançar uma operação nova, ou descobrir um custo que a tela da carteira não mostra
(foi assim que o preço médio do BOVA11 vendido do FRAN saiu de uma nota de agosto).
Cuidado: operações antigas já estão embutidas no preço médio que o print da carteira
mostra hoje. Lançar de novo conta duas vezes. Só lance o que ainda não estiver refletido.

## Preço médio preciso

A corretora arredonda o preço médio a 2 casas, o que basta para a tela mas erra o
resultado em alguns reais. Recupere o valor exato:

- Quando o print traz o resultado em reais: `PM = (Posição − Resultado) ÷ Quantidade`,
  com 5 ou 6 casas. Exemplo real: `20,69358` para INBR32.
- Quando traz só a rentabilidade em porcentagem, também arredondada: escolha um preço
  dentro da faixa que reproduz os dois valores exibidos ao mesmo tempo. Exemplo real:
  M1TA34 com preço médio 118,96 e rentabilidade 12,12% só fecha com `118,9566`.

## Quando parar e perguntar

Pergunte antes de gravar se houver dúvida real: vírgula contra ponto de milhar, ticker
parecido, coluna cortada, print sem data quando a data importa. Um número errado aqui
vira um gráfico errado depois, e a pessoa não tem como perceber olhando o app.

Quando um dado simplesmente não existe no print, não invente: registre o que dá, use o
preço da cotação como custo (lucro zero) e diga na resposta o que ficou pendente. É o
caso de fundo imobiliário com preço médio "Indefinido" e de posição alugada em tela que
não mostra o custo.

## Privacidade

O site é público. Use só apelidos, nunca o nome completo do cliente. Prints e notas
costumam trazer nome, CPF e número de conta: nada disso entra no repositório.

## Ao terminar

Rode `validate`, faça commit e push no branch de trabalho, e atualize a seção de estado
e pendências do `CLAUDE.md` com o que mudou e o que ficou faltando. Se o app tiver mudado
(`orihuela/index.html`, `app.js`, `styles.css`, `core.js`), incremente `CACHE` em
`orihuela/sw.js`, senão os celulares continuam na versão antiga.
