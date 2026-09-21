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
  contra o print de custódia de 11/09/2026) e FRAN (6 ativos, conferido contra o print
  de 21/09/2026: saldo e rentabilidade batem em todas as linhas e a soma fecha com
  R$ 105.414,90 em ações).
- Cotações de fechamento de 11/09/2026 para 27 papéis, com MUTC34, GOGL34, TSLA34,
  INBR32, M1TA34 e BOVA11 atualizados em 21/09/2026 pelo print do FRAN.
- Pendências de dados: saldo em caixa e base do último bônus (valor e data) dos três
  clientes; custo real de MAXR11, RNGO11 e XPCM11 no RD (a XP mostra preço médio
  "Indefinido", então estão com preço médio igual à cotação e lucro zero); BPAC11 e
  ROMI3 do Felipe ainda com preço do print da carteira, não do fechamento; e o
  vencimento do aluguel de BOVA11 do FRAN, 05/10/2026, que o modelo de dados não guarda.
- O preço médio do BOVA11 vendido do FRAN (R$ 174,74) veio da nota de negociação de
  04/08/2026. As demais operações da mesma nota (venda de 62 GOGL34 e compra de 27
  MUTC34) já estavam refletidas nos preços médios do print e não devem ser lançadas.
- Serviço de cotações (brapi.dev) configurável em Ajustes; o usuário estava obtendo o
  token para testar. Falta confirmar a cobertura de INBR32, MAXR11, RNGO11 e XPCM11.
- Os demais clientes (mais de 30) entram aos poucos por prints.
- Rentabilidade acumulada = patrimônio ÷ capital aportado − 1. Enquanto o cliente não
  tem operações registradas, o capital acompanha investido + caixa.
