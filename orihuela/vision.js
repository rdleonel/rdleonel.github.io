/*
 * Orihuela Consulting — leitura de prints por IA.
 * Manda a imagem para a API de mensagens da Anthropic (direto do navegador, com a chave
 * guardada só no aparelho), recebe os dados em JSON e monta um PLANO para conferência.
 * Nada é gravado aqui: quem grava é o app, depois que a pessoa confere e aprova, usando
 * as mesmas funções do core.js (applyTransaction, setPosition) que o CLI e o app já usam.
 *
 * Duas leituras:
 *   ops        boleta, nota de negociação ou ordem executada  -> operações (compra, venda, aluguel)
 *   positions  tela da carteira da XP                         -> posição e preço médio por papel
 *
 * As partes puras (sem DOM nem rede) rodam em Node e têm teste em tests/unit-vision.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.OrihuelaVision = factory(root.OrihuelaCore);
}(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const DEFAULT_MODEL = 'claude-opus-5-5';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MAX_IMAGES = 8;
  const MAX_SIDE = 1600;

  // ---------- pedido ----------
  const nullable = t => ({ anyOf: [{ type: t }, { type: 'null' }] });

  const SCHEMAS = {
    ops: {
      type: 'object', additionalProperties: false, required: ['items', 'notes'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['side', 'ticker', 'qty', 'price', 'total_brl', 'date'],
            properties: {
              side: { type: 'string', enum: ['buy', 'sell', 'short', 'unknown'] },
              ticker: { type: 'string' },
              qty: { type: 'number' },
              price: nullable('number'),
              total_brl: nullable('number'),
              date: nullable('string')
            }
          }
        },
        notes: { type: 'string' }
      }
    },
    positions: {
      type: 'object', additionalProperties: false, required: ['items', 'notes'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['ticker', 'qty', 'avg_price', 'last_price', 'position_value_brl', 'result_brl', 'result_pct'],
            properties: {
              ticker: { type: 'string' },
              qty: { type: 'number' },
              avg_price: nullable('number'),
              last_price: nullable('number'),
              position_value_brl: nullable('number'),
              result_brl: nullable('number'),
              result_pct: nullable('number')
            }
          }
        },
        notes: { type: 'string' }
      }
    }
  };

  const COMMON_RULES = [
    'Você lê prints de telas da corretora XP (Brasil) e devolve os dados em JSON, sem comentar.',
    'Regras:',
    '- Copie só o que está visível. Nunca calcule, estime nem complete um valor que não aparece: use null.',
    '- Números no formato brasileiro ("1.234,56" é 1234.56; "2.417" de quantidade é 2417). Percentuais como número, sem o sinal de %: "20,22%" vira 20.22 e "-2,68%" vira -2.68.',
    '- Código da ação em maiúsculas, sem espaços (ex.: PETR4, MUTC34, HASH11).',
    '- Se várias imagens forem enviadas, são partes seguidas da mesma tela: não repita uma linha que aparece em duas imagens.',
    '- Ignore nome do cliente, CPF, número de conta e qualquer dado pessoal. Não os copie para "notes".',
    '- Em "notes", diga em uma frase curta o que ficou ilegível, cortado ou ambíguo (ou deixe vazio).'
  ];
  const PROMPTS = {
    ops: COMMON_RULES.concat([
      'Tarefa: extrair as OPERAÇÕES executadas (boleta, nota de negociação ou ordem executada).',
      '- side: "buy" para Compra (C); "sell" para Venda (V); "short" para venda a descoberto ou aluguel como tomador; "unknown" se não der para saber.',
      '- qty: quantidade positiva. price: preço por ação da execução (preço médio de execução, se a ordem teve várias execuções). total_brl: valor total da operação se estiver visível.',
      '- date: data da operação em AAAA-MM-DD, ou null se não aparecer.',
      '- Uma ordem com várias execuções ao mesmo preço vira uma linha só; com preços diferentes, uma linha por execução.'
    ]).join('\n'),
    positions: COMMON_RULES.concat([
      'Tarefa: extrair as POSIÇÕES da carteira, uma linha por papel.',
      '- qty: quantidade; NEGATIVA para posição vendida (aluguel como tomador, "Qtd. -371").',
      '- avg_price: preço médio exatamente como exibido (null se estiver "Indefinido" ou ausente).',
      '- last_price: último preço / cotação atual por ação, se aparecer.',
      '- position_value_brl: saldo ou valor da posição em R$ (negativo para posição vendida).',
      '- result_brl: resultado total em R$ da posição (lucro positivo, prejuízo negativo), SE a tela mostrar o resultado total. "Result. dia" é só o resultado do dia: nesse caso use null.',
      '- result_pct: rentabilidade da posição em %, se aparecer (não use a variação do dia).'
    ]).join('\n')
  };

  function buildRequest(mode, images, opts) {
    opts = opts || {};
    if (!SCHEMAS[mode]) throw new Error('Modo de leitura inválido: ' + mode);
    if (!images || !images.length) throw new Error('Escolha ao menos uma imagem.');
    const content = images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data } }));
    content.push({ type: 'text', text: mode === 'ops' ? 'Extraia as operações destas imagens.' : 'Extraia as posições destas imagens.' });
    const body = {
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 8000,
      system: PROMPTS[mode],
      messages: [{ role: 'user', content }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMAS[mode] } }
    };
    if (opts.fallback !== false) body.fallbacks = 'default';
    return body;
  }

  function headers(key, withFallback) {
    const h = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (withFallback) h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    return h;
  }

  function httpError(status, body) {
    const msg = body && body.error && body.error.message ? body.error.message : '';
    if (status === 401 || status === 403) return 'Chave da Anthropic recusada (' + status + '). Confira em Ajustes.';
    if (status === 429) return 'Limite de uso da API atingido. Tente de novo em instantes.';
    if (status === 413) return 'As imagens ficaram grandes demais. Envie menos imagens por vez.';
    if (status >= 500) return 'A API da Anthropic está instável (' + status + '). Tente de novo.';
    return 'A API recusou o pedido (' + status + ')' + (msg ? ': ' + msg : '.');
  }

  // Lê a resposta da API e devolve { items, notes }. Lança Error com mensagem legível.
  function parseResponse(res) {
    if (!res || !Array.isArray(res.content)) throw new Error('Resposta inesperada da API.');
    if (res.stop_reason === 'refusal') throw new Error('A IA recusou ler esta imagem. Preencha pela tela de operação.');
    if (res.stop_reason === 'max_tokens') throw new Error('A resposta foi cortada (muitas linhas). Envie menos imagens por vez.');
    const block = res.content.find(b => b.type === 'text');
    if (!block || !block.text) throw new Error('A IA não devolveu dados.');
    let json;
    try { json = JSON.parse(block.text); } catch (e) { throw new Error('A IA devolveu um formato que não consegui ler.'); }
    if (!json || !Array.isArray(json.items)) throw new Error('A IA devolveu um formato que não consegui ler.');
    return { items: json.items, notes: String(json.notes || '').trim() };
  }

  // Chamada de rede (navegador). fetchImpl existe para teste.
  async function extract(mode, images, cfg, fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch.bind(self) : null);
    if (!f) throw new Error('Sem acesso à rede neste ambiente.');
    if (!cfg || !cfg.key) throw new Error('Informe a chave da Anthropic em Ajustes.');
    async function call(fallback) {
      const body = buildRequest(mode, images, { model: cfg.model, fallback });
      let r;
      try { r = await f(API_URL, { method: 'POST', headers: headers(cfg.key, fallback), body: JSON.stringify(body) }); }
      catch (e) { throw new Error('Sem conexão com a API da Anthropic. Verifique a internet.'); }
      let json = null;
      try { json = await r.json(); } catch (e) { /* corpo vazio */ }
      return { r, json };
    }
    let { r, json } = await call(true);
    // 400 pode ser o recurso de fallback (opcional) que a API não aceitou: repete uma vez sem ele
    if (r.status === 400) ({ r, json } = await call(false));
    if (!r.ok) throw new Error(httpError(r.status, json));
    return parseResponse(json);
  }

  // Teste de chave (Ajustes): pedido mínimo, sem imagem.
  async function ping(cfg, fetchImpl) {
    const f = fetchImpl || (typeof fetch === 'function' ? fetch.bind(self) : null);
    if (!f) throw new Error('Sem acesso à rede neste ambiente.');
    if (!cfg || !cfg.key) throw new Error('Informe a chave da Anthropic.');
    let r, json = null;
    try {
      r = await f(API_URL, { method: 'POST', headers: headers(cfg.key, false), body: JSON.stringify({ model: cfg.model || DEFAULT_MODEL, max_tokens: 64, messages: [{ role: 'user', content: 'Responda apenas: ok' }] }) });
      try { json = await r.json(); } catch (e) { /* corpo vazio */ }
    } catch (e) { throw new Error('Sem conexão com a API da Anthropic. Verifique a internet.'); }
    if (!r.ok) throw new Error(httpError(r.status, json));
    return true;
  }

  // ---------- imagens (navegador) ----------
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(new Error('Não consegui ler a imagem.'));
      fr.readAsDataURL(blob);
    });
  }
  // Reduz o lado maior a MAX_SIDE e converte para JPEG: menos dados, mesma leitura.
  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Imagem inválida: ' + (file.name || ''))); i.src = url;
      });
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Não consegui preparar a imagem.');
      return { mediaType: 'image/jpeg', data: await blobToBase64(blob), name: file.name || 'print' };
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- preço médio preciso ----------
  // A XP arredonda o preço médio a 2 casas, o que erra o resultado em alguns reais.
  //  1) resultado em R$ + valor da posição:  PM = (valor − resultado) ÷ qtd
  //  2) rentabilidade % + último preço: o PM tem de reproduzir ao mesmo tempo o PM impresso
  //     (a 2 casas) e a rentabilidade impressa (a 2 casas); usa o meio da faixa válida.
  function refineAvgPrice(it) {
    const qty = C.num(it.qty, NaN);
    const printed = C.num(it.avg_price, NaN);
    const value = C.num(it.position_value_brl, NaN), result = C.num(it.result_brl, NaN);
    const pct = C.num(it.result_pct, NaN), last = C.num(it.last_price, NaN);
    if (Number.isFinite(qty) && qty !== 0 && Number.isFinite(value) && Number.isFinite(result)) {
      const pm = (value - result) / qty;
      if (pm > 0 && (!Number.isFinite(printed) || Math.abs(pm - printed) <= 0.0051)) return { pm: round(pm, 5), method: 'resultado' };
    }
    if (Number.isFinite(printed) && Number.isFinite(pct) && Number.isFinite(last) && last > 0 && qty > 0) {
      const ok = [];
      for (let k = -500; k <= 500; k++) {
        const c = printed + k / 100000;
        if (c > 0 && Math.round((last / c - 1) * 10000) / 100 === Math.round(pct * 100) / 100) ok.push(c);
      }
      if (ok.length) return { pm: round((ok[0] + ok[ok.length - 1]) / 2, 5), method: 'faixa' };
    }
    return { pm: Number.isFinite(printed) ? printed : null, method: Number.isFinite(printed) ? 'impresso' : 'nenhum' };
  }
  function round(n, d) { const f = Math.pow(10, d); return Math.round(n * f) / f; }

  // ---------- plano de conferência ----------
  const SIDE_TO_TYPE = { buy: 'buy', sell: 'sell', short: 'short' };
  const SIDE_LABEL = { buy: 'Compra', sell: 'Venda', short: 'Venda a descoberto' };
  let rowSeq = 0;
  const rid = () => 'r' + (++rowSeq);

  function quoteOf(data, ticker) { const q = data.quotes[ticker]; return q ? q.price : null; }
  function today() { return C.localDateISO(); }

  // items brutos da IA -> linhas editáveis com avisos. Não altera nada.
  function buildPlan(data, client, mode, items) {
    const rows = [];
    (items || []).forEach(it => {
      const ticker = C.normTicker(it.ticker);
      if (!ticker) return;
      if (mode === 'ops') {
        const qty = C.num(it.qty, NaN);
        if (!(qty > 0)) return;
        const price = C.num(it.price, NaN), total = C.num(it.total_brl, NaN);
        const side = SIDE_TO_TYPE[it.side] ? it.side : 'unknown';
        const row = { id: rid(), mode, ticker, side, type: side === 'unknown' ? 'buy' : SIDE_TO_TYPE[side], qty, price: Number.isFinite(price) ? price : null, date: C.isISODate(it.date) ? it.date : null, total: Number.isFinite(total) ? total : null, warnings: [], include: true };
        rows.push(row);
      } else {
        const qty = C.num(it.qty, NaN);
        if (!Number.isFinite(qty) || qty === 0) return;
        const ref = refineAvgPrice(it);
        const cur = client.positions.find(p => p.ticker === ticker) || null;
        const last = C.num(it.last_price, NaN);
        let avg = ref.pm, method = ref.method;
        if (avg == null) {
          if (cur) { avg = cur.avgPrice; method = 'mantido'; }
          else if (Number.isFinite(last) && last > 0) { avg = last; method = 'provisorio'; }
          else { const q = quoteOf(data, ticker); avg = q != null ? q : null; method = q != null ? 'provisorio' : 'nenhum'; }
        }
        rows.push({ id: rid(), mode, ticker, qty, avg, method, last: Number.isFinite(last) && last > 0 ? last : null, before: cur ? { qty: cur.qty, avg: cur.avgPrice } : null, warnings: [], include: true });
      }
    });
    rows.forEach(r => validateRow(data, client, r));
    return rows;
  }

  // Recalcula os avisos de uma linha (chamado de novo quando a pessoa edita um campo).
  function validateRow(data, client, row) {
    const w = [];
    const q = quoteOf(data, row.ticker);
    if (row.mode === 'ops') {
      if (row.side === 'unknown') w.push({ level: 'warn', text: 'Não deu para saber se é compra ou venda: escolha o tipo.' });
      if (!(row.price >= 0) || row.price == null) w.push({ level: 'err', text: 'Sem preço: preencha o preço da operação.' });
      if (!row.date) w.push({ level: 'info', text: 'O print não traz data: será usada a de hoje (' + C.fmtDate(today()) + ').' });
      if (row.total != null && row.price != null && row.qty > 0) {
        const calc = row.qty * row.price;
        if (Math.abs(calc - row.total) > Math.max(1, row.total * 0.005)) w.push({ level: 'warn', text: 'Quantidade × preço = ' + C.fmtBRL(calc) + ', mas o print mostra ' + C.fmtBRL(row.total) + '. Confira quantidade e preço.' });
      }
      const pos = client.positions.find(p => p.ticker === row.ticker);
      if (row.type === 'sell') {
        if (!pos) w.push({ level: 'err', text: client.name + ' não tem ' + row.ticker + '. Se for aluguel, escolha "Venda a descoberto".' });
        else if (pos.qty < 0) w.push({ level: 'err', text: row.ticker + ' é posição vendida: use "Venda a descoberto" para aumentar ou "Compra" para recomprar.' });
        else if (row.qty > pos.qty + 1e-9) w.push({ level: 'err', text: 'Quantidade maior que a posição (' + C.fmtInt(pos.qty) + ').' });
      }
      if (row.type === 'buy' && pos && pos.qty < 0 && row.qty > -pos.qty + 1e-9) w.push({ level: 'err', text: 'Quantidade maior que a posição vendida (' + C.fmtInt(-pos.qty) + ').' });
      if (row.type === 'short' && pos && pos.qty > 0) w.push({ level: 'err', text: row.ticker + ' é posição comprada: use "Venda" para reduzi-la.' });
      if (q != null && row.price > 0 && Math.abs(row.price / q - 1) > 0.15) w.push({ level: 'warn', text: 'Preço bem diferente da cotação do app (' + C.fmtNum(q) + '). Confira.' });
      const date = row.date || today();
      const dup = client.transactions.find(t => t.ticker === row.ticker && t.type === row.type && t.date === date && Math.abs(t.qty - row.qty) < 1e-9 && Math.abs(t.price - row.price) < 0.005);
      if (dup) w.push({ level: 'warn', text: 'Já existe uma operação igual neste dia. Pode ser duplicada.' });
    } else {
      if (!Number.isFinite(row.qty) || row.qty === 0) w.push({ level: 'err', text: 'Quantidade inválida.' });
      if (row.avg == null || !(row.avg >= 0)) w.push({ level: 'err', text: 'Sem preço médio: preencha para gravar.' });
      if (row.method === 'provisorio') w.push({ level: 'warn', text: 'A tela não traz o preço médio: usei o preço atual (lucro zero). Fica pendente até chegar o custo real.' });
      if (row.method === 'mantido') w.push({ level: 'info', text: 'A tela não traz o preço médio: mantive o que já estava no app.' });
      if (row.method === 'resultado') w.push({ level: 'info', text: 'Preço médio calculado pelo resultado em R$ (mais preciso que o arredondado da XP).' });
      if (row.method === 'faixa') w.push({ level: 'info', text: 'Preço médio refinado pela rentabilidade exibida (mais preciso que o arredondado da XP).' });
      if (row.before && Math.sign(row.before.qty) !== Math.sign(row.qty)) w.push({ level: 'warn', text: 'O lado da posição mudou (de ' + C.fmtInt(row.before.qty) + ' para ' + C.fmtInt(row.qty) + ').' });
      if (!row.before && q == null && !row.last) w.push({ level: 'warn', text: 'Papel novo sem cotação no app: ficará "sem cotação" até atualizar os preços.' });
      if (row.before && row.avg != null && row.before.avg > 0 && Math.abs(row.avg / row.before.avg - 1) > 0.3) w.push({ level: 'warn', text: 'Preço médio muito diferente do atual (' + C.fmtNum(row.before.avg) + ').' });
    }
    row.warnings = w;
    row.blocked = w.some(x => x.level === 'err');
    return row;
  }

  // Papéis que o cliente tem no app e não apareceram no print de carteira (só informação).
  function missingFromPrint(client, rows) {
    const seen = new Set(rows.map(r => r.ticker));
    return client.positions.filter(p => !seen.has(p.ticker)).map(p => p.ticker);
  }

  // Aplica as linhas marcadas. Lança Error se alguma for inválida (nada é mantido: o chamador
  // deve rodar antes num clone, ver dryRun). Devolve um resumo.
  function applyRows(data, client, rows) {
    const done = [];
    rows.filter(r => r.include).forEach(r => {
      if (r.mode === 'ops') {
        const rec = C.applyTransaction(data, client, { type: r.type, date: r.date || today(), ticker: r.ticker, qty: r.qty, price: r.price, note: 'via print' });
        done.push({ ticker: r.ticker, label: SIDE_LABEL[r.side === 'unknown' ? r.type : r.side] || C.TX_TYPES[r.type], rec });
      } else {
        C.setPosition(data, client, r.ticker, r.qty, r.avg);
        // cotação só para papel que ainda não tem; nunca sobrescreve a de outro cliente
        if (!data.quotes[r.ticker] && r.last) C.setQuotes(data, { [r.ticker]: r.last });
        done.push({ ticker: r.ticker, label: 'Posição' });
      }
    });
    return done;
  }

  // Ensaio num clone: devolve null se tudo se aplica, ou a mensagem do primeiro erro.
  function dryRun(data, client, rows) {
    try {
      const copy = JSON.parse(JSON.stringify(data));
      const c = copy.clients.find(x => x.id === client.id);
      applyRows(copy, c, rows);
      return null;
    } catch (e) { return e.message || String(e); }
  }

  return { DEFAULT_MODEL, MAX_IMAGES, SCHEMAS, buildRequest, headers, parseResponse, extract, ping, prepareImage, refineAvgPrice, buildPlan, validateRow, missingFromPrint, applyRows, dryRun, SIDE_LABEL };
}));
