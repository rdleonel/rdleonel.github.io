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

## Estado atual e pendências (atualize ao fim de cada sessão)

- Clientes: Felipe (5 ativos), RD (16 ativos, carteira do próprio usuário, conferida
  contra o print de custódia de 11/09/2026), FRAN (6 ativos) e GABRIEL (5 ativos), os
  dois últimos conferidos linha a linha contra prints de 21/09/2026.
- Cotações de fechamento de 11/09/2026 para 27 papéis, atualizadas em 21/09/2026 pelos
  prints do FRAN (MUTC34, GOGL34, TSLA34, INBR32, M1TA34, BOVA11) e depois do GABRIEL
  (INBR32, MUTC34, TSLA34, MSFT34, IVVB11). Os dois prints são do mesmo dia mas de
  momentos diferentes: o do GABRIEL traz preços mais baixos em INBR32, MUTC34 e TSLA34,
  e prevaleceu por ser o mais recente recebido. Confirmar com o usuário se estiver
  errado.
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
