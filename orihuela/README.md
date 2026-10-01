# Orihuela Consulting

App de acompanhamento das carteiras dos clientes (todos na XP). Funciona como PWA em
`https://rdleonel.github.io/orihuela/`, pode ser instalado na tela inicial do celular
e abre off-line com a última versão dos dados que foi sincronizada.

## Navegação

Pensada para uso com uma mão no iPhone: **nada clicável fica no topo da tela**. As
cinco telas ficam numa barra de abas fixa no rodapé (Início, Cotações, Clientes,
Desempenho, Ajustes), e a ação principal de cada tela fica numa barra logo acima
dela ("Atualizar todas as cotações", "+ Novo cliente", "Nova operação"). As ações
secundárias da carteira estão no botão ••• ao lado. Para sair da carteira de um
cliente, toque na aba Clientes ou arraste a partir da borda esquerda. Quando o
teclado abre, as abas saem de cena e a barra de ação encosta no teclado.

## Atualizar as cotações

O botão **Atualizar cotações** fica fixo no rodapé da tela inicial. Ele abre a tela de
conferência, onde os preços podem chegar de três formas:

1. **Busca automática.** Com um serviço configurado em Ajustes, o app já busca tudo ao
   abrir a tela: cada campo vem preenchido, com borda verde e a variação em relação ao
   preço anterior ao lado (uma variação absurda denuncia leitura errada na hora). O
   padrão é a brapi.dev, que cobre ações, BDRs, ETFs e fundos imobiliários da B3 e
   precisa de um token gratuito. O endereço é um template com `{TICKERS}` e `{TOKEN}`,
   então dá para trocar de serviço sem mexer no código; a leitura da resposta é
   tolerante e reconhece os formatos mais comuns de JSON.

   A busca é feita em lotes. Planos gratuitos costumam limitar quantos papéis cabem em
   uma chamada, então, quando o serviço recusa um lote grande, o app reduz sozinho (20,
   depois 5, depois um a um), completa a lista e guarda o tamanho que funcionou para as
   próximas vezes. Erro de conexão ou token inválido para na primeira tentativa, sem
   repetir a chamada. Use o botão Testar em Ajustes para conferir a cobertura dos seus
   papéis antes de depender da busca.
2. **Print da corretora.** O botão ao lado (ícone de imagem) abre a câmera ou a galeria.
   O print fica fixo no topo da tela, com três tamanhos, enquanto a lista de preços rola
   embaixo: dá para conferir sem trocar de aplicativo. A tecla Enter pula para o próximo
   papel.
3. **À mão**, digitando direto nos campos.

Em qualquer caso nada é gravado antes de você tocar em **Salvar cotações**, e o mesmo
toque registra um ponto no gráfico de todos os clientes na data escolhida.

O app não lê o print sozinho: isso exigiria um serviço de visão e uma chave de API
guardada no aparelho. Para extração automática a partir de imagens, o caminho continua
sendo mandar o print numa sessão do Claude neste repositório.

## O que o app mostra

- **Cotações**: todas as ações que aparecem em pelo menos uma carteira, com a última
  cotação e a data. Botão para atualizar todas de uma vez (isso registra um ponto novo
  no gráfico de cada cliente).
- **Clientes**: lista de apelidos. Cada carteira mostra, por ação: cotas, valor atual
  (cotas × última cotação), total investido (cotas × preço médio) e lucro ou prejuízo
  (valor atual − investido). No topo: patrimônio total (ações + caixa), rentabilidade
  acumulada, valor da carteira no último bônus e o percentual acima (verde) ou abaixo
  (vermelho) dessa base. Abaixo: o track record (gráfico com camadas de patrimônio e
  rentabilidade sobre o mesmo eixo de datas) e o registro de operações, com o resultado
  de cada venda.
- **Desempenho**: todos os clientes lado a lado (patrimônio, rentabilidade, vs. bônus).

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

Há duas formas de o arquivo ser alterado:

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
