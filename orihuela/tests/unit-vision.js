// Leitura de prints por IA: partes puras (pedido, resposta, preço médio, plano, aplicação).
// Roda em Node, sem navegador e sem rede:  node orihuela/tests/unit-vision.js
const assert = require('assert');
const C = require('../core.js');
const V = require('../vision.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

function sample() {
  const d = C.emptyData();
  C.setQuotes(d, { PETR4: 40, MUTC34: 948.07, ROXO34: 11.48 });
  C.addClient(d, 'Teste');
  const c = d.clients[0];
  C.setPosition(d, c, 'PETR4', 100, 30);
  C.setPosition(d, c, 'MUTC34', 198, 800);
  return { d, c };
}
const items = (...a) => a;

ok('pedido: imagem, schema estruturado, effort e cabeçalho do navegador', () => {
  const body = V.buildRequest('ops', [{ mediaType: 'image/jpeg', data: 'AAAA' }], {});
  assert.strictEqual(body.model, 'claude-opus-5-5');
  assert.strictEqual(body.messages[0].content[0].type, 'image');
  assert.strictEqual(body.messages[0].content[0].source.type, 'base64');
  assert.strictEqual(body.output_config.format.type, 'json_schema');
  assert.strictEqual(body.output_config.effort, 'medium');
  assert.ok(!('thinking' in body) && !('temperature' in body) && !('tool_choice' in body));
  assert.strictEqual(body.fallbacks, 'default');
  assert.strictEqual(V.buildRequest('positions', [{ data: 'A' }], { fallback: false }).fallbacks, undefined);
  const h = V.headers('sk-ant-x', true);
  assert.strictEqual(h['anthropic-dangerous-direct-browser-access'], 'true');
  assert.strictEqual(h['x-api-key'], 'sk-ant-x');
  assert.ok(h['anthropic-beta']);
  assert.throws(() => V.buildRequest('ops', [], {}), /imagem/);
});

ok('resposta: texto JSON, recusa, corte e lixo', () => {
  const good = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ items: [{ ticker: 'A' }], notes: ' ok ' }) }] };
  const r = V.parseResponse(good);
  assert.strictEqual(r.items.length, 1); assert.strictEqual(r.notes, 'ok');
  assert.throws(() => V.parseResponse({ stop_reason: 'refusal', content: [] }), /recusou/);
  assert.throws(() => V.parseResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }), /cortada/);
  assert.throws(() => V.parseResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'oi' }] }), /formato/);
});

(async () => {
  const cfg = { key: 'k', model: 'claude-opus-5-5' };
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const good = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"items":[],"notes":""}' }] };
  let calls = [];
  const f1 = async (url, o) => { calls.push({ url, o }); return resp(401, { error: { message: 'x' } }); };
  await assert.rejects(V.extract('ops', [{ data: 'A' }], cfg, f1), /Chave da Anthropic recusada/);
  assert.strictEqual(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(JSON.parse(calls[0].o.body).fallbacks, 'default');

  calls = [];
  const f2 = async (url, o) => { calls.push(JSON.parse(o.body)); return calls.length === 1 ? resp(400, { error: { message: 'unknown field: fallbacks' } }) : resp(200, good); };
  const r = await V.extract('ops', [{ data: 'A' }], cfg, f2);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].fallbacks, undefined);

  await assert.rejects(V.extract('ops', [{ data: 'A' }], { key: '' }, f2), /chave/i);
  await assert.rejects(V.extract('ops', [{ data: 'A' }], cfg, async () => { throw new Error('net'); }), /conexão/);
  console.log('ok  rede: erro 401, repetição sem fallback, offline');
})().catch(e => { console.error(e); process.exit(1); });

ok('preço médio: resultado em R$ vence o arredondamento', () => {
  // PM verdadeiro 750,1234 em 198 cotas, preço 948,07
  const value = 187717.86, pm = 750.1234, result = value - 198 * pm;
  const r = V.refineAvgPrice({ qty: 198, avg_price: 750.12, position_value_brl: value, result_brl: Math.round(result * 100) / 100, result_pct: null, last_price: 948.07 });
  assert.strictEqual(r.method, 'resultado');
  assert.ok(Math.abs(r.pm - pm) < 0.0001, 'pm ' + r.pm);
});

ok('preço médio: faixa que reproduz PM e rentabilidade (caso real MUTC34)', () => {
  const r = V.refineAvgPrice({ qty: 2417, avg_price: 791.05, last_price: 951.02, result_pct: 20.22, position_value_brl: null, result_brl: null });
  assert.strictEqual(r.method, 'faixa');
  assert.ok(r.pm >= 791.045 && r.pm <= 791.055);
  const g = V.refineAvgPrice({ qty: 138140, avg_price: 11.67, last_price: 11.36, result_pct: -2.68 });
  assert.strictEqual(g.method, 'faixa');
  assert.ok(Math.abs(g.pm - 11.67283) < 0.0002, 'pm ' + g.pm);
});

ok('preço médio: indefinido não é inventado', () => {
  const r = V.refineAvgPrice({ qty: 49605, avg_price: null, last_price: 27.66, result_pct: null });
  assert.strictEqual(r.pm, null); assert.strictEqual(r.method, 'nenhum');
});

ok('carteira: usa o mantido, depois o preço atual (provisório) e marca', () => {
  const { d, c } = sample();
  const rows = V.buildPlan(d, c, 'positions', items(
    { ticker: 'petr4', qty: 100, avg_price: null, last_price: 41, position_value_brl: null, result_brl: null, result_pct: null },
    { ticker: 'NOVO3', qty: 10, avg_price: null, last_price: 5, position_value_brl: null, result_brl: null, result_pct: null }));
  assert.strictEqual(rows[0].method, 'mantido'); assert.strictEqual(rows[0].avg, 30);
  assert.strictEqual(rows[1].method, 'provisorio'); assert.strictEqual(rows[1].avg, 5);
  assert.ok(rows[1].warnings.some(w => /pendente/.test(w.text)));
});

ok('carteira: aplica posição e só cria cotação que faltava', () => {
  const { d, c } = sample();
  const rows = V.buildPlan(d, c, 'positions', items(
    { ticker: 'MUTC34', qty: 198, avg_price: 791.05, last_price: 999, position_value_brl: null, result_brl: null, result_pct: null },
    { ticker: 'NOVO3', qty: 10, avg_price: 4.5, last_price: 5, position_value_brl: null, result_brl: null, result_pct: null },
    { ticker: 'ALUG11', qty: -50, avg_price: 20, last_price: 19, position_value_brl: null, result_brl: null, result_pct: null }));
  assert.strictEqual(V.dryRun(d, c, rows), null);
  const done = V.applyRows(d, c, rows);
  assert.strictEqual(done.length, 3);
  assert.strictEqual(c.positions.find(p => p.ticker === 'MUTC34').avgPrice, 791.05);
  assert.strictEqual(d.quotes.MUTC34.price, 948.07, 'cotação existente não pode mudar');
  assert.strictEqual(d.quotes.NOVO3.price, 5);
  assert.strictEqual(c.positions.find(p => p.ticker === 'ALUG11').qty, -50);
  assert.deepStrictEqual(V.missingFromPrint(c, rows), ['PETR4']);
});

ok('operações: compra média, venda com resultado e aluguel', () => {
  const { d, c } = sample();
  const rows = V.buildPlan(d, c, 'ops', items(
    { side: 'buy', ticker: 'PETR4', qty: 100, price: 40, total_brl: 4000, date: '2026-10-01' },
    { side: 'sell', ticker: 'MUTC34', qty: 98, price: 950, total_brl: 93100, date: '2026-10-01' },
    { side: 'short', ticker: 'BOVA11', qty: 10, price: 184.41, total_brl: null, date: null }));
  assert.ok(rows.every(r => !r.blocked), JSON.stringify(rows.map(r => r.warnings)));
  assert.ok(rows[2].warnings.some(w => /data/.test(w.text)));
  assert.strictEqual(V.dryRun(d, c, rows), null);
  const cash0 = c.cash;
  V.applyRows(d, c, rows);
  const p = c.positions.find(x => x.ticker === 'PETR4');
  assert.strictEqual(p.qty, 200); assert.strictEqual(Math.round(p.avgPrice * 100) / 100, 35);
  assert.strictEqual(c.positions.find(x => x.ticker === 'MUTC34').qty, 100);
  assert.strictEqual(c.positions.find(x => x.ticker === 'BOVA11').qty, -10);
  assert.strictEqual(c.transactions.length, 3);
  assert.strictEqual(c.transactions[1].result, Math.round((950 - 800) * 98 * 100) / 100);
  assert.strictEqual(c.cash, Math.round((cash0 - 4000 + 93100 + 1844.1) * 100) / 100);
});

ok('operações: avisos de venda sem posição, total que não fecha e duplicada', () => {
  const { d, c } = sample();
  let rows = V.buildPlan(d, c, 'ops', items({ side: 'sell', ticker: 'XXXX3', qty: 1, price: 10, total_brl: 10, date: '2026-10-01' }));
  assert.ok(rows[0].blocked);
  rows = V.buildPlan(d, c, 'ops', items({ side: 'buy', ticker: 'PETR4', qty: 100, price: 40, total_brl: 5000, date: '2026-10-01' }));
  assert.ok(rows[0].warnings.some(w => /mostra/.test(w.text)));
  rows = V.buildPlan(d, c, 'ops', items({ side: 'unknown', ticker: 'PETR4', qty: 5, price: 40, total_brl: null, date: '2026-10-01' }));
  assert.ok(rows[0].warnings.some(w => /compra ou venda/.test(w.text)));
  rows = V.buildPlan(d, c, 'ops', items({ side: 'buy', ticker: 'PETR4', qty: 100, price: 40, total_brl: 4000, date: '2026-10-01' }));
  V.applyRows(d, c, rows);
  const again = V.buildPlan(d, c, 'ops', items({ side: 'buy', ticker: 'PETR4', qty: 100, price: 40, total_brl: 4000, date: '2026-10-01' }));
  assert.ok(again[0].warnings.some(w => /duplicada/.test(w.text)));
});

ok('ensaio acusa erro sem tocar nos dados reais', () => {
  const { d, c } = sample();
  const rows = V.buildPlan(d, c, 'ops', items(
    { side: 'buy', ticker: 'PETR4', qty: 10, price: 40, total_brl: null, date: '2026-10-01' },
    { side: 'sell', ticker: 'PETR4', qty: 999, price: 40, total_brl: null, date: '2026-10-01' }));
  const before = JSON.stringify(d);
  assert.ok(/maior que a posição/.test(V.dryRun(d, c, rows)));
  assert.strictEqual(JSON.stringify(d), before);
});

ok('linhas inválidas da IA são descartadas', () => {
  const { d, c } = sample();
  assert.strictEqual(V.buildPlan(d, c, 'ops', items({ side: 'buy', ticker: '', qty: 1, price: 1 }, { side: 'buy', ticker: 'A', qty: 0, price: 1 })).length, 0);
  assert.strictEqual(V.buildPlan(d, c, 'positions', items({ ticker: 'A', qty: 0 }, { ticker: 'B', qty: 'x' })).length, 0);
});

setTimeout(() => console.log('\n' + n + ' testes síncronos + rede: tudo passou.'), 50);
