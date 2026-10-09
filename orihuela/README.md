# Orihuela Consulting

App de acompanhamento das carteiras dos clientes (todos na XP). Funciona como PWA em
`https://rdleonel.github.io/orihuela/`, pode ser instalado na tela inicial do celular
e abre off-line com a última versão dos dados que foi sincronizada.

## Navegação

Pensada para uso com uma mão no iPhone: **nada clicável fica no topo da tela**. As
cinco telas ficam numa barra de abas fixa no rodapé (Início, Cotações, Clientes,
Desempenho, Ajustes), e a ação principal de cada tela fica numa barra logo acima
dela ("Atualizar preços agora", "Atualizar cotações", "+ Novo cliente", "Nova operação").
As ações secundárias da carteira estão no botão ••• ao lado. Para sair da carteira de um
cliente, toque na aba Clientes ou arraste a partir da borda esquerda. Quando o
teclado abre, as abas saem de cena e a barra de ação encosta no teclado.

## Cotações: robô no fechamento + preços ao vivo

**Robô (grava).** Todo dia útil às 18h30 de Brasília o workflow
`.github/workflows/orihuela-cotacoes.yml` roda `orihuela/tools/robo-cotacoes.js`: busca na
brapi a cotação de cada papel em carteira (um papel por consulta, como o plano gratuito
exige), grava em `data.json` com o fechamento anterior e registra o ponto do pregão no
gráfico de todos os clientes. O token fica no secret `BRAPI_TOKEN` do repositório. A data
do ponto é a do pregão informada pela brapi, então rodar num feriado só regrava o último
pregão. Dá para rodar à mão em Actions → "Orihuela · cotações" → Run workflow, ou no
terminal com `BRAPI_TOKEN=... node orihuela/tools/robo-cotacoes.js --dry-run` (mostra sem
gravar). Se o app gravar ao mesmo tempo, o robô refaz em cima da versão nova.

**Ao vivo (só mostra).** Com o token da brapi em Ajustes, o app busca os preços sozinho
durante o pregão (dias úteis, 9h45 às 18h15) ao abrir, ao voltar para ele e a cada 30
minutos com ele aberto, e o botão **Atualizar preços agora** força a busca. Esses preços
entram em todos os números da tela, inclusive o resultado do dia, mas **nunca são
gravados**: não criam ponto no gráfico nem edição pendente. Fechar e abrir o app no mesmo
dia reaproveita a última busca. O plano gratuito dá 15 mil consultas por mês e cada busca
gasta uma por papel; quando o saldo (mostrado em Ajustes) fica abaixo de 2.000, o app para
de buscar sozinho e deixa o restante para o robô. Se o plano limitar papéis por consulta,
o app lê o limite da própria resposta da brapi e passa a pedir um a um.

**Variação do dia.** Cada cotação guarda o fechamento anterior (`prev`), calculado como
preço − variação do dia informada pela brapi (o campo de fechamento anterior dela às
vezes traz o after-market). Resultado do dia = cotas × (preço − fechamento anterior).
Fora do pregão, a tela diz de que dia é a variação ("em 08/10").

**Gravar à mão.** Na aba Cotações, **Atualizar cotações** abre a conferência de sempre,
onde os preços chegam de três formas e só são gravados ao tocar em **Salvar cotações**
(o mesmo toque registra um ponto no gráfico de todos os clientes na data escolhida):

1. **Busca.** Cada campo vem preenchido, com borda verde e a variação em relação ao preço
   anterior ao lado (uma variação absurda denuncia leitura errada na hora). O endereço é
   um template com `{TICKERS}` e `{TOKEN}`, então dá para trocar de serviço sem mexer no
   código; a leitura da resposta reconhece os formatos mais comuns de JSON. Erro de
   conexão ou token inválido para na primeira tentativa, sem repetir a chamada.
2. **Print da corretora.** O print fica fixo no topo da tela, com três tamanhos, enquanto
   a lista de preços rola embaixo. A tecla Enter pula para o próximo papel.
3. **À mão**, digitando direto nos campos.

A leitura de preços por print continua manual (itens 2 e 3). Para ler **operações e
posições** de um cliente por imagem, veja a próxima seção.

## Ler print com IA (operações e carteira)

Na tela de um cliente, o botão **📷 Print** (ou ••• → Ler print com IA) manda uma ou mais
imagens da XP para a API da Anthropic, que devolve os dados em JSON. Há duas leituras:

- **Carteira:** tela da carteira com cotas e preço médio. Atualiza as posições do cliente.
  O preço médio é refinado quando o print traz o resultado em R$ ou a rentabilidade (a XP
  arredonda a 2 casas). Papéis que não aparecem no print não são mexidos. Se a tela traz
  preço médio "Indefinido", o app mantém o que já estava ou usa o preço atual (lucro zero)
  e avisa que fica pendente.
- **Operação:** boleta, nota de negociação ou ordem executada. Registra compra, venda e
  venda a descoberto (aluguel) como operações, com o mesmo cálculo de preço médio, caixa e
  resultado do botão Nova operação. Operações que já estão embutidas no preço médio da
  carteira não devem ser lançadas de novo; o app avisa quando acha uma duplicada.

Nada é gravado sem a sua conferência: depois da leitura aparece uma lista editável, uma
linha por papel, com avisos (venda sem posição, quantidade × preço que não fecha com o
total do print, preço longe da cotação, operação duplicada). Dá para corrigir qualquer
valor ou desmarcar a linha. Ao tocar em **Aplicar**, tudo é testado num clone dos dados
antes de gravar; se alguma linha falhar, nada muda. Cotações existentes nunca são
alteradas por esta tela (só é criada a de um papel que ainda não tinha).

Configuração (uma vez): Ajustes → Leitura de prints (IA) → cole uma chave da API da
Anthropic (console.anthropic.com → API keys). A chamada sai direto do aparelho para
`api.anthropic.com` com o cabeçalho `anthropic-dangerous-direct-browser-access`, então a
chave fica só no aparelho (localStorage, como o token do GitHub) e não vai para o
repositório. Use uma chave exclusiva para isto, com limite de gasto baixo. O modelo
padrão é `claude-opus-5-5`; dá para trocar em Ajustes. A imagem é reduzida (lado maior de
1600 px), enviada só para a leitura e não é guardada. Cubra nome, CPF e número da conta
antes de enviar.

O código está em `vision.js` (pedido, leitura da resposta, preço médio, plano de
conferência; testado em `tests/unit-vision.js`) e `app.js` (tela de conferência).

## O que o app mostra

- **Início (painel)**: patrimônio total sob gestão com o resultado do dia, o estado dos
  preços (ao vivo ou gravados) e um cartão por cliente com patrimônio, variação do dia,
  rentabilidade acumulada e posição contra a base do último bônus.
- **Cotações**: lista de todos os papéis em carteira com preço e variação do dia,
  ordenável por variação, exposição (valor somado em todas as carteiras) ou A–Z. Tocar
  num papel mostra quem tem e quanto, e dá o atalho para corrigir o preço.
- **Clientes**: lista de apelidos. A carteira abre com patrimônio, rentabilidade, resultado
  do dia, caixa, investido, lucro e bônus, e uma **tabela** com Papel, Peso (% do
  patrimônio), Hoje, Lucro e Valor, ordenável pelo cabeçalho. Tocar numa linha mostra
  cotas, preço médio, cotação, investido, lucro e resultado do dia, com atalhos para
  editar a posição e ver quem mais tem o papel. Abaixo: o track record e o registro de
  operações.
- **Desempenho**: tabela por período com todos os clientes: Hoje, 7 dias, 30 dias,
  acumulada e contra o bônus, com fundo colorido pela intensidade do resultado. 7 e 30
  dias comparam com o ponto do gráfico daquela idade (`periodReturn` no `core.js`) e
  ficam em branco até haver histórico suficiente.

Tudo é editável no próprio app: criar, renomear e excluir clientes, ajustar cotas,
preço médio, caixa, capital e base do bônus, registrar operações, adicionar ou apagar
pontos do histórico.

## Definições

- Patrimônio total = Σ (cotas × cotação) + caixa.
- Investido = Σ (cotas × preço médio).
- Lucro em ações = patrimônio em ações − investido.
- Capital aportado = base da rentabilidade acumulada. Começa como investido + caixa e
  só muda com aporte (+) ou retirada (−). Compras e vendas não alteram.
- Rentabilidade acumulada = patrimônio total ÷ capital aportado − 1.
- vs. bônus = patrimônio total ÷ valor da carteira no último bônus − 1.
- Venda: resultado = (preço de venda − preço médio) × quantidade. O preço médio da
  posição restante não muda; o dinheiro da venda entra no caixa. Corretagem e
  emolumentos são ignorados.
- Compra: novo preço médio ponderado; o valor sai do caixa.
- Posição vendida (aluguel como tomador, quantidade negativa na XP): guardada com
  quantidade negativa. Valor atual e investido ficam negativos e o lucro sai certo
  (preço médio − cotação) × quantidade. "Venda a descoberto" abre ou aumenta a posição
  vendida (o dinheiro entra no caixa); uma "Compra" sobre posição vendida é recompra e
  calcula o resultado da operação. Não se cruza zero numa única operação.

## Como os dados circulam

O arquivo `orihuela/data.json` é a fonte de verdade e fica no repositório. O app baixa
esse arquivo quando tem internet e guarda uma cópia local (localStorage) para uso
off-line.

Há duas formas de o arquivo ser alterado (e, em qualquer uma, o cliente também pode ser
atualizado direto no app pelo botão Print, veja acima):

1. **Pelo Claude, a partir de prints** (fluxo principal). Você manda o print da XP
   (cotações, boleta de compra ou venda, posição consolidada) numa sessão do Claude Code
   neste repositório. Ele lê a imagem, roda `orihuela/tools/cli.js`, confere com
   `show`, faz commit e push. Quando o site republica, o app baixa a versão nova na
   próxima abertura com internet.
2. **Pelo app, com um token do GitHub** (opcional, em Configurações). Com o token,
   cada edição feita no celular é gravada direto em `data.json` no branch configurado.
   Sem token, as edições ficam só no aparelho; use "Compartilhar JSON" ou "Copiar JSON"
   para mandar o conteúdo ao Claude, que grava no repositório.

Se houver edições locais não enviadas e o servidor tiver uma versão mais nova, o app
mostra um aviso e deixa escolher: usar a do servidor ou manter a local.

Token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained
tokens → Only select repositories (este) → Repository permissions → Contents: Read and
write. O token fica apenas no aparelho.

## Atualizar o app no celular

Uma versão nova entra no ar quando as mudanças chegam ao branch `main` (o GitHub Pages
republica o site em um ou dois minutos). No aparelho:

1. Abra o app com internet. Ele procura atualização ao abrir, ao voltar do segundo plano
   e a cada meia hora.
2. Quando houver versão nova, aparece um aviso no topo com **Atualizar agora**. Também
   dá para forçar em Ajustes → Versão do aplicativo → Procurar atualização.
3. Tocar em atualizar recarrega o app com o código novo.

**Atualizar não apaga dados.** As carteiras ficam no `localStorage` do aparelho e em
`data.json` no repositório; a atualização troca apenas o código (HTML, CSS, JS e ícones).
Isso está coberto por teste automatizado.

O que **apaga** os dados do aparelho é remover o app da tela inicial (no iOS os dados de
um app instalado somem junto) ou usar "Apagar dados locais" em Ajustes. Antes de fazer
qualquer um dos dois, confirme que não há edições pendentes: a tela inicial avisa
"Edições locais não enviadas ao servidor". Se houver, envie com o token do GitHub ou use
Compartilhar JSON. Com tudo sincronizado, reinstalar é seguro: o app baixa o `data.json`
de novo.

Trocar o ícone exige reinstalar o atalho: o iOS guarda a imagem no momento em que o
atalho é criado e não a atualiza sozinha. Sincronize, remova o app da tela inicial e
adicione de novo pelo Safari.

## PIN e privacidade

O app pede um PIN ao abrir e ao voltar depois de 2 minutos em segundo plano. É um
bloqueio de tela do aparelho, nada mais: `data.json` fica em um site público, então use
apenas apelidos e nunca o nome completo dos clientes. "Esqueci o PIN" apaga os dados
locais e o token; o arquivo do servidor não é afetado.

## CLI (usado pelo Claude nas sessões)

Na raiz do repositório:

```
node orihuela/tools/cli.js show
node orihuela/tools/cli.js validate
node orihuela/tools/cli.js quotes PETR4=38,12 VALE3=61,30 [--date 2026-09-12] [--no-snapshot]
node orihuela/tools/cli.js snapshot [--date 2026-09-12]
node orihuela/tools/cli.js client add "Apelido" [--cash 0] [--bonus 36000 --bonus-date 2026-06-30]
node orihuela/tools/cli.js client edit "Apelido" [--name "Novo"] [--cash X] [--capital X] [--bonus X] [--bonus-date D]
node orihuela/tools/cli.js client remove "Apelido"
node orihuela/tools/cli.js position set "Apelido" PETR4 200 31,40
node orihuela/tools/cli.js position remove "Apelido" PETR4
node orihuela/tools/cli.js tx "Apelido" buy PETR4 100 30,50 [--date D] [--note "..."]
node orihuela/tools/cli.js tx "Apelido" sell PETR4 100 40,00 [--date D]
node orihuela/tools/cli.js tx "Apelido" short BOVA11 100 160,00 [--date D]   (venda a descoberto)
node orihuela/tools/cli.js tx "Apelido" buy BOVA11 100 150,00                (sobre posição vendida = recompra)
node orihuela/tools/cli.js position set "Apelido" BOVA11 -182 110,40         (negativo = posição vendida)
node orihuela/tools/cli.js tx "Apelido" deposit 1000 [--date D]
node orihuela/tools/cli.js tx "Apelido" withdraw 1000 [--date D]
node orihuela/tools/cli.js tx "Apelido" bonus [valor] [--date D]
node orihuela/tools/cli.js tx "Apelido" undo
node orihuela/tools/cli.js point "Apelido" 2026-06-30 36000 [--ret 5,2]
node orihuela/tools/cli.js point remove "Apelido" 2026-06-30
```

`quotes` registra automaticamente um ponto no histórico de todos os clientes na data
informada (padrão: hoje). O CLI e o app usam o mesmo `core.js`, então os números batem.

## Arquivos

- `index.html`, `styles.css`, `app.js`: interface.
- `core.js`: cálculos (compartilhado com o CLI).
- `data.json`: dados.
- `sw.js`, `manifest.json`, `icons/`: PWA.
- `tools/cli.js`: atualização por linha de comando.

Ao mudar arquivos da interface, aumente a versão do cache em `sw.js` (`orihuela-vN`)
para que os celulares recebam a versão nova.
