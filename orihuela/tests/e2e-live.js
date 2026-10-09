// Preços ao vivo (v2): busca sozinha no pregão, variação do dia, nada gravado, limite do plano.
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/orihuela/';
const DATA = require('../data.json');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [], fails = [];
  const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FALHA ') + msg); if (!ok) fails.push(msg); };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fetching the script/.test(m.text())) errors.push('console: ' + m.text()); });

  // brapi simulada: plano de 1 papel por consulta (como o gratuito); preço 10% acima do gravado,
  // com a variação do dia apontando para o preço gravado como fechamento anterior
  let calls = [];
  await ctx.route('https://brapi.dev/**', async route => {
    const url = route.request().url();
    const tickers = decodeURIComponent(url.split('/quote/')[1].split('?')[0]).split(',');
    calls.push(tickers.length);
    if (tickers.length > 1) return route.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ error: true, code: 'QUOTES_PER_REQUEST_EXCEEDED', details: { limit: { current: 1, requested: tickers.length } } }) });
    const t = tickers[0]; const saved = DATA.quotes[t] ? DATA.quotes[t].price : 10;
    const price = Math.round(saved * 1.1 * 100) / 100;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'ratelimit-remaining': '9000', 'access-control-expose-headers': 'ratelimit-remaining' },
      body: JSON.stringify({ results: [{ symbol: t, regularMarketPrice: price, regularMarketChange: Math.round((price - saved) * 100) / 100, regularMarketPreviousClose: price, regularMarketTime: '2026-10-07T17:00:00.000Z' }] }) });
  });

  // quarta-feira, 14h de Brasília: pregão aberto
  await page.clock.setFixedTime(new Date('2026-10-07T14:00:00-03:00'));
  const pin = async () => { for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`); };
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('orihuela.quotes', JSON.stringify({ url: 'https://brapi.dev/api/quote/{TICKERS}?token={TOKEN}', token: 'tok', sep: ',', auth: '', batch: 20 })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  await pin(); await page.click('.keypad button:text-is("OK")');
  await pin(); await page.click('.keypad button:text-is("OK")');
  await page.waitForSelector('.tabbar button');

  // 1) busca sozinha ao abrir, aprendendo o limite pela resposta
  await page.waitForSelector('.live-status.on', { timeout: 40000 });
  const nT = new Set(DATA.clients.flatMap(c => c.positions.map(p => p.ticker))).size;
  console.log('Chamadas:', calls.length, '· papéis por chamada:', calls.slice(0, 4).join(', ') + ', …');
  check(calls[0] > 1 && calls.slice(1).every(n => n === 1), 'uma tentativa em lote e depois um papel por consulta');
  check(calls.length <= nT + 1, 'no máximo uma consulta desperdiçada (' + calls.length + ' para ' + nT + ' cotações gravadas)');
  const batch = await page.evaluate(() => JSON.parse(localStorage.getItem('orihuela.quotes')).batch);
  check(batch === 1, 'lote aprendido = 1');
  const hero = (await page.textContent('.hero')).replace(/\s+/g, ' ').trim();
  console.log('Painel:', hero, '|', await page.textContent('.live-status'));
  check(/hoje \(\+/.test(hero), 'resultado do dia positivo no painel');
  const cards = await page.$$eval('.client-card', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  console.log('Cartões:', cards.slice(0, 3).join(' | '));
  check(cards.length === DATA.clients.length, 'um cartão por cliente');
  await page.screenshot({ path: path.join(OUT, 'live-home.png') });

  // 2) nada foi gravado: preços ao vivo são só exibição
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('orihuela.state')));
  check(st.dirty === false, 'sem edições locais pendentes');
  const same = Object.keys(DATA.quotes).every(t => st.data.quotes[t] && st.data.quotes[t].price === DATA.quotes[t].price);
  check(same, 'cotações gravadas intactas');

  // 3) carteira em tabela: coluna Hoje preenchida, ordenação pelo cabeçalho, linha abre detalhes
  await page.click('.client-card >> nth=0');
  await page.waitForSelector('table.wallet');
  const firstRow = (await page.textContent('table.wallet tbody tr')).replace(/\s+/g, ' ');
  console.log('Carteira, 1ª linha:', firstRow);
  check(/\+10,0%/.test(await page.textContent('table.wallet tbody')), 'variação do dia de +10,0% aparece na carteira');
  await page.click('table.wallet th button:has-text("Papel")');
  const tks = await page.$$eval('table.wallet tbody tr.clickable td:first-child .tk', els => els.map(e => e.childNodes[0].textContent));
  check(tks.join() === tks.slice().sort().join(), 'ordenou por papel (A–Z)');
  await page.click('table.wallet tbody tr.clickable >> nth=0');
  check(!!(await page.$('table.wallet tr.detail .kv')), 'toque abre cotas, preço médio e cotação');
  await page.screenshot({ path: path.join(OUT, 'live-wallet.png') });

  // 4) desempenho por período
  await page.click('.tabbar button:has-text("Desempenho")');
  await page.waitForSelector('table.perf');
  console.log('Desempenho:', (await page.textContent('table.perf thead')).replace(/\s+/g, ' '), '|', (await page.textContent('table.perf tbody tr')).replace(/\s+/g, ' '));
  check((await page.$$('table.perf tbody tr')).length === DATA.clients.length, 'uma linha por cliente');
  await page.screenshot({ path: path.join(OUT, 'live-perf.png') });

  // 5) mercado: lista ordenada por variação
  await page.click('.tabbar button:has-text("Cotações")');
  await page.waitForSelector('.quote-row');
  console.log('Mercado:', (await page.textContent('.quote-row')).replace(/\s+/g, ' '));
  check(/\+10,\d\d% hoje/.test(await page.textContent('.quote-row')), 'variação do dia na lista de cotações');

  // 6) reabrir o app no mesmo minuto não gasta consultas; o botão força a busca
  calls = [];
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.lock'); await pin();
  await page.waitForSelector('.tabbar button');
  await page.waitForTimeout(1500);
  check(calls.length === 0, 'reabrir reaproveita os preços ao vivo do dia (' + calls.length + ' consultas)');
  await page.click('.tabbar button:has-text("Início")');
  await page.click('#actionbar button:has-text("Atualizar preços agora")');
  await page.waitForFunction(() => !document.querySelector('#actionbar').textContent.includes('Atualizando'), null, { timeout: 40000 });
  await page.waitForTimeout(300);
  check(calls.length >= nT - 2 && calls.every(n => n === 1), 'o botão busca de novo, já um papel por vez (' + calls.length + ')');

  console.log('\nErros:', errors.length ? errors : 'nenhum');
  await browser.close();
  process.exit(errors.length || fails.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
