# Testes do Orihuela

Testes de ponta a ponta que abrem o app num navegador de verdade (Chromium via
Playwright), em tela de iPhone, e conferem o comportamento. Não há framework: cada
arquivo é um script Node que imprime o que encontrou e sai com código diferente de zero
se houver erro de página ou de console.

```bash
bash orihuela/tests/run.sh            # todos
bash orihuela/tests/run.sh nav        # só um
```

O script sobe um servidor estático na porta 8765, roda os testes e derruba o servidor.
As capturas de tela vão para um diretório temporário, cujo caminho é impresso no início.

## O que cada um cobre

| Arquivo | Verifica |
|---|---|
| `e2e-nav.js` | Navegação: nenhum controle no topo da tela, as cinco abas, a posição das barras (devem ficar abaixo de 90% da altura), alvos de toque de 44px, voltar pela aba e pelo gesto de borda, uso off-line |
| `e2e-func.js` | Cálculos pela interface: venda, recompra de posição vendida, erro de quantidade maior que a posição, renomear cliente, criar cliente, tela de desempenho |
| `e2e-quotes.js` | Atualização de cotações: busca automática, anexar print fixo no topo, serviço fora do ar, resposta parcial, teste de conexão em Ajustes |
| `e2e-batch.js` | Busca em lotes contra um serviço que limita papéis por chamada: o lote encolhe, a lista completa, o tamanho é lembrado, token inválido não vira 22 chamadas |
| `e2e-read.js` | Leitura de prints pela IA: envio da imagem reduzida, conferência linha a linha, linha desmarcada não entra, preço médio de 5 casas preservado, posição vendida negativa, chave recusada e resposta sem JSON |
| `e2e-update.js` | Atualização do app: aviso de versão nova, instalação, dados e PIN preservados, cache antigo removido |

Os testes de cotações usam um serviço simulado (as chamadas a `brapi.dev` são
interceptadas), e o de leitura de prints intercepta `api.anthropic.com`, então nenhum
deles depende de rede, de token ou de chave da API.

## Requisitos

Node 20 ou mais novo, com `playwright` instalado e um Chromium disponível. Nos
contêiners do Claude Code o navegador já vem em `/opt/pw-browsers`; fora deles, rode
`npx playwright install chromium` e ajuste o `executablePath` no topo de cada arquivo,
ou remova essa opção para usar o navegador que o Playwright baixou.

## Gerador de ícones

`orihuela/tools/mkicon.js` desenha os ícones do app e grava em `orihuela/icons/`.
Rode depois de mudar o desenho:

```bash
node orihuela/tools/mkicon.js
```

Ele captura o elemento SVG, não a janela, e confere o tamanho de cada arquivo. A versão
antiga capturava a janela e os ícones saíam cortados pela metade.
