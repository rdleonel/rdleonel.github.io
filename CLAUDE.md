# rdleonel.github.io

Site estático no GitHub Pages com dois apps independentes (PWAs sem build, sem
dependências):

- Raiz (`index.html`, `sw.js`, `manifest.json`, `images/`, `icons/`): Iron Overload,
  rastreador de treino. Não mexer ao trabalhar no Orihuela.
- `orihuela/`: Orihuela Consulting, acompanhamento das carteiras de clientes na XP.
  Como o app funciona: `orihuela/README.md`.

## Prints e notas da XP

Qualquer imagem de carteira, custódia, cotações, boleta ou nota de negociação é trabalho
para a skill **orihuela** (`.claude/skills/orihuela/SKILL.md`): ela tem os comandos, as
regras de leitura e a conferência obrigatória. Invoque com `/orihuela` ou deixe que ela
seja acionada pelo assunto. O resumo de uma linha: os dados ficam em
`orihuela/data.json`, e só se mexe neles por `node orihuela/tools/cli.js`.

Ao alterar `orihuela/index.html`, `app.js`, `styles.css` ou `core.js`, incremente
`CACHE` em `orihuela/sw.js`. Use só apelidos para clientes: o site é público.

## Testes

Depois de mexer no app, rode `bash orihuela/tests/run.sh`. São seis testes de ponta a
ponta num navegador de verdade, em tela de iPhone: navegação, cálculos pela interface,
atualização de cotações, busca em lotes, preços ao vivo e o ciclo de atualização do app. Detalhes e
requisitos em `orihuela/tests/README.md`. Os ícones saem de
`node orihuela/tools/mkicon.js`.

## Continuidade

O projeto inteiro vive neste repositório: app, dados, testes, a skill `orihuela` e estas
notas. Nada depende de uma conta específica do Claude nem do histórico de uma conversa.
Para continuar de outra conta, basta conectar o GitHub e abrir este repositório; a skill
e este arquivo carregam sozinhos.

## Cotações automáticas (robô) e ao vivo

Todo dia útil às 18h30 de Brasília o workflow `.github/workflows/orihuela-cotacoes.yml`
roda `orihuela/tools/robo-cotacoes.js`, que grava as cotações em `orihuela/data.json` e
o ponto do pregão de todos os clientes, e faz commit direto na main. Por isso: **sempre
`git pull` antes de mexer em `data.json`**, e não precisa mais atualizar cotações à mão
a cada print (só quando o usuário pedir ou o robô falhar). O token da brapi do robô fica
no secret `BRAPI_TOKEN`. Para testar sem gravar: `BRAPI_TOKEN=... node
orihuela/tools/robo-cotacoes.js --dry-run`. No app, os preços ao vivo são só exibição e
nunca entram em `data.json`. Cada cotação pode ter `prev` (fechamento anterior), usado na
variação do dia; o CLI `quotes` não informa `prev`, e o `setQuotes` só mantém o antigo se
for do mesmo pregão.

## Leitura de prints dentro do app

O botão **Print** na tela do cliente lê imagens da XP com a API da Anthropic (chamada
direta do navegador, chave só no aparelho, cadastrada em Ajustes) e mostra uma lista
editável para conferência antes de gravar. Duas leituras: Carteira (posição e preço médio)
e Operação (boleta/nota). Código em `orihuela/vision.js` (partes puras, testadas em
`orihuela/tests/unit-vision.js`) e `orihuela/app.js` (`printDialog`). Pela linha de comando
e pelas sessões do Claude o fluxo continua o mesmo; não duplique regra de cálculo, o app
só chama `applyTransaction` e `setPosition` do `core.js`.

## Estado atual e pendências (atualize ao fim de cada sessão)

- Clientes: Nil (8 ativos; preços médios do print de 08/10/2026, refinados pela faixa que reproduz preço médio e rentabilidade; caixa R$ 3.307,90 (saldo disponível do print de 08/10); base de bônus R$ 700.000 em 31/01/2026, dia aproximado. IVVB11 vendida = −720 cotas (5 contratos de aluguel de tomador: 1+3+150+218+348, a R$ 440,37, vencimentos 03/11 e 09/11/2026, que o modelo não guarda), com custo provisório igual à cotação do app até chegar a nota; o print de Aluguel fecha com o total do patrimônio da XP: compradas R$ 998.134,32 − aluguel R$ 317.066,40 + caixa R$ 3.307,90 = R$ 684.375,82), Felipe (5 ativos), RD (16 ativos, carteira do próprio usuário, conferida
  contra o print de custódia de 11/09/2026), FRAN (6 ativos) e GABRIEL (5 ativos), os
  dois últimos conferidos linha a linha contra prints de 21/09/2026.
- Cotações de fechamento de 11/09/2026 para 27 papéis, atualizadas em 21/09/2026 pelos
  prints do FRAN (MUTC34, GOGL34, TSLA34, INBR32, M1TA34, BOVA11) e depois do GABRIEL
  (INBR32, MUTC34, TSLA34, MSFT34, IVVB11). Os dois prints são do mesmo dia mas de
  momentos diferentes: o do GABRIEL traz preços mais baixos em INBR32, MUTC34 e TSLA34,
  e prevaleceu por ser o mais recente recebido. Confirmar com o usuário se estiver
  errado.
- Cotações de 01/10/2026 (print de cotações da XP) atualizaram IVVB11, MUTC34, ROXO34, INBR32, PRIO3, BIDU34, M2RV34, DASA3, GOGL34, M1TA34 e BOVA11 e criaram um ponto de 01/10 para todos os clientes. Mudou bastante: Felipe de +25,85% para +49,30% (confira contra a XP).
- Cliente P (29 posições, caixa R$ 8.463,97, base de bônus R$ 6.805.000 em 31/01/2026, dia aproximado). Preços médios do print da carteira de 01/10/2026, refinados pela faixa que reproduz preço médio e rentabilidade. Pendentes: INBR32 (XP mostra preço médio "Indefinido", ficou igual à cotação) e as 7 posições vendidas (BOVA11, IVVB11, M1TA34, ITSA4, MOVI3, PRNR3, LREN3), todas com custo igual à cotação até chegar o print de Aluguel. ROXO34 = 188.140 cotas (confirmado pelo usuário; um print anterior mostrava 138.140). GMAT3, TSLA34, COGN3, JHSF3, HASH11 e ROMI3 seguem com cotação de 21/09 ou do print do Felipe.
- Pendências de dados: saldo em caixa e base do último bônus (valor e data) dos três
  clientes; custo real de MAXR11, RNGO11 e XPCM11 no RD (a XP mostra preço médio
  "Indefinido", então estão com preço médio igual à cotação e lucro zero); BPAC11 e
  ROMI3 do Felipe ainda com preço do print da carteira, não do fechamento; e o
  vencimento do aluguel de BOVA11 do FRAN, 05/10/2026, que o modelo de dados não guarda.
- O preço médio do BOVA11 vendido do FRAN (R$ 174,74) veio da nota de negociação de
  04/08/2026. As demais operações da mesma nota (venda de 62 GOGL34 e compra de 27
  MUTC34) já estavam refletidas nos preços médios do print e não devem ser lançadas.
- No print de Aluguel do GABRIEL, as quatro linhas de IVVB11 (115+169+218+219 = 721
  cotas) somam R$ 322.416,78 e o cabeçalho da seção mostra R$ 319.763,50. Não falta
  linha: o cabeçalho usa uma cotação anterior (319.763,50 ÷ 721 = R$ 443,50) enquanto as
  linhas usam R$ 447,18. Vale checar essa divisão antes de supor print cortado.
- O preço médio do IVVB11 vendido do GABRIEL (R$ 442,26) veio da nota de negociação: as
  três vendas (57, 281 e 383) somam exatamente as 721 cotas, todas ao mesmo preço. As
  outras operações da nota (vendas de BABA34 e GOGL34, que zeraram essas posições, e a
  compra de 7.811 INBR32) já estão refletidas no print da carteira.
- Serviço de cotações (brapi.dev) configurável em Ajustes; o usuário estava obtendo o
  token para testar. Falta confirmar a cobertura de INBR32, MAXR11, RNGO11 e XPCM11.
- Os demais clientes (mais de 30) entram aos poucos por prints.
- Rentabilidade acumulada = patrimônio ÷ capital aportado − 1. Enquanto o cliente não
  tem operações registradas, o capital acompanha investido + caixa.
