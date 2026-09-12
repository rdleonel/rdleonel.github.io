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
4. Aporte, retirada ou bônus recebido: `tx "Apelido" deposit|withdraw VALOR` ou
   `tx "Apelido" bonus [VALOR]` (sem valor usa o patrimônio de hoje).
5. Confira com `node orihuela/tools/cli.js show` e `validate`, depois commit e push.
   O app no celular pega a versão nova na próxima abertura com internet.

Se o usuário colar um JSON exportado pelo app, substitua `orihuela/data.json` por ele
(valide com `show` antes de commitar). Se houver dúvida na leitura de um número do print
(vírgula, milhar, ticker parecido), pergunte antes de gravar.

Use só apelidos para clientes: o site é público. Ao alterar `orihuela/index.html`,
`app.js`, `styles.css` ou `core.js`, incremente `CACHE` em `orihuela/sw.js`.
