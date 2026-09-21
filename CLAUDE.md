# rdleonel.github.io

Site estático no GitHub Pages com dois apps independentes (PWAs sem build, sem
dependências):

- Raiz (`index.html`, `sw.js`, `manifest.json`, `images/`, `icons/`): Iron Overload,
  rastreador de treino. Não mexer ao trabalhar no Orihuela.
- `orihuela/`: Orihuela Consulting, acompanhamento das carteiras de clientes na XP.
  Detalhes em `orihuela/README.md`.

## Orihuela: fluxo quando o usuário manda prints

Os prints vêm sempre da XP. Os dados ficam em `orihuela/data.json`; nunca edite o JSON
à mão para operações ou cotações, use `node orihuela/tools/cli.js` (mesmo `core.js` do
app, então os números batem com a tela).

1. Print de cotações: extraia ticker e último preço de cada ação e rode
   `node orihuela/tools/cli.js quotes TICKER=PREÇO ...`. Isso registra um ponto no
   gráfico de todos os clientes na data do print (`--date AAAA-MM-DD` se não for hoje).
2. Print de compra ou venda: identifique o cliente (apelido), ticker, quantidade e
   preço, e rode `tx "Apelido" buy|sell TICKER QTD PREÇO --date AAAA-MM-DD`. Em
   vendas, o CLI imprime o resultado da operação; repita esse valor na resposta.
3. Print de posição consolidada (cliente novo ou conferência): `client add` e depois
   `position set` para cada ação (quantidade e preço médio), `client edit --cash` para
   o saldo, e `client edit --bonus VALOR --bonus-date DATA` para a base do bônus.
   Na carteira da XP, "Quantidade" negativa (aluguel como tomador) é posição vendida:
   passe a quantidade negativa ao `position set`. O preço médio da XP vem arredondado
   a 2 casas; para bater o "Resultado total" ao centavo, use
   PM = (Posição − Resultado total) ÷ Quantidade com 5 ou 6 casas (ex.: `20,69358`).
   Recompra de posição vendida é `tx ... buy`; abrir ou aumentar uma vendida é
   `tx ... short`. Cada `tx` exige dígitos decimais com vírgula (`12,146`), porque
   `12.146` seria lido como doze mil.
4. Aporte, retirada ou bônus recebido: `tx "Apelido" deposit|withdraw VALOR` ou
   `tx "Apelido" bonus [VALOR]` (sem valor usa o patrimônio de hoje).
5. Confira com `node orihuela/tools/cli.js show` e `validate`, depois commit e push.
   O app no celular pega a versão nova na próxima abertura com internet.

Se o usuário colar um JSON exportado pelo app, substitua `orihuela/data.json` por ele
(valide com `show` antes de commitar). Se houver dúvida na leitura de um número do print
(vírgula, milhar, ticker parecido), pergunte antes de gravar.

Use só apelidos para clientes: o site é público. Ao alterar `orihuela/index.html`,
`app.js`, `styles.css` ou `core.js`, incremente `CACHE` em `orihuela/sw.js`.

## Orihuela: estado atual e pendências (atualize esta seção ao fim de cada sessão)

- Clientes cadastrados: Felipe (5 ativos), RD (16 ativos, carteira do próprio
  usuário, conferida contra o print de custódia de 11/09/2026) e FRAN (6 ativos,
  conferido contra o print de 21/09/2026: saldo e rentabilidade batem em todas as
  linhas e a soma fecha com R$ 105.414,90 em ações).
- Cotações de fechamento de 11/09/2026 para 27 papéis, com MUTC34, GOGL34,
  TSLA34, INBR32, M1TA34 e BOVA11 atualizados em 21/09/2026 pelo print do FRAN.
- Pendências de dados: saldo em caixa e base do último bônus (valor e data) dos
  três clientes; custo real de MAXR11, RNGO11 e XPCM11 no RD (a XP mostra preço
  médio "Indefinido", então estão com preço médio igual à cotação e lucro zero);
  BPAC11 e ROMI3 do Felipe ainda com preço do print da carteira, não do
  fechamento; preço médio do BOVA11 alugado do FRAN (a tela de Aluguel não traz
  essa coluna, então está com o preço da cotação e lucro zero) e o vencimento
  desse aluguel, 05/10/2026, que o modelo de dados não guarda.
- Quando o print traz preço médio e rentabilidade, ambos arredondados a 2 casas,
  escolha o preço médio dentro da faixa que reproduz os dois valores exibidos
  (foi o caso de M1TA34 no FRAN: 118,9566).
- Os demais clientes (mais de 30) serão cadastrados aos poucos por prints da XP:
  aba Carteira (traz preço médio) e, se possível, aba Custódia (lista completa
  para conferência). Sempre devolver ao usuário a tabela comparada antes de
  encerrar.
- Rentabilidade acumulada = patrimônio ÷ capital aportado − 1. Enquanto o cliente
  não tem operações registradas, o capital acompanha investido + caixa.
