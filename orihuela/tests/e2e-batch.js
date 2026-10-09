// Busca de cotações com serviço que limita a quantidade de papéis por chamada.
const { chromium } = require('playwright');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = 'http://127.0.0.1:8765/orihuela/';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  let limit = 5;            // papéis aceitos por chamada
  let calls = [];
  let mode = 'limit';
  await ctx.route('https://brapi.dev/**', async route => {
    const url = route.request().url();
    const tickers = decodeURIComponent(url.split('/quote/')[1].split('?')[0]).split(',');
    calls.push(tickers.length);
    if (mode === 'auth') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"token"}' });
    if (tickers.length > limit) {
      // a brapi devolve erro quando o plano não permite tantos papéis
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"too many tickers"}' });
    }
    const results = tickers.map((t, i) => ({ symbol: t, regularMarketPrice: 20 + i }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) });
  });

  // domingo: fora do pregão, o app não busca preços ao vivo sozinho e a contagem de chamadas fica limpa
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00-03:00'));
  const pin = async () => { for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`); };
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  await pin(); await page.click('.keypad button:text-is("OK")');
  await pin(); await page.click('.keypad button:text-is("OK")');
  await page.waitForSelector('.tabbar button');
  await page.evaluate(() => localStorage.setItem('orihuela.quotes', JSON.stringify({
    url: 'https://brapi.dev/api/quote/{TICKERS}?token={TOKEN}', token: 'tok', sep: ',', auth: '', batch: 20
  })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.lock'); await pin();
  await page.waitForSelector('.tabbar button');

  // 1) serviço que só aceita 5 por vez
  await page.click('.tabbar button:has-text("Cotações")');
  calls = [];
  await page.click('#actionbar button:has-text("Atualizar cotações")');
  await page.waitForSelector('.banner:has-text("preenchidas")', { timeout: 30000 });
  console.log('Aviso:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());
  console.log('Chamadas (papéis por chamada):', calls.join(', '));
  const filled = await page.$$eval('.quote-row.filled', e => e.length);
  const total = await page.$$eval('.quote-row', e => e.length);
  console.log('Preenchidos: ' + filled + '/' + total);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('orihuela.quotes')).batch);
  console.log('Tamanho de lote aprendido:', saved);
  await page.click('#actionbar button:has-text("Cancelar")');

  // 2) segunda busca já começa com o lote aprendido
  calls = [];
  await page.click('#actionbar button:has-text("Atualizar cotações")');
  await page.waitForSelector('.banner:has-text("preenchidas")', { timeout: 30000 });
  console.log('Segunda busca, chamadas:', calls.join(', '), '(sem repetir a tentativa grande)');
  await page.click('#actionbar button:has-text("Cancelar")');

  // 3) token inválido: para na primeira, sem martelar o serviço
  mode = 'auth'; calls = [];
  await page.click('#actionbar button:has-text("Atualizar cotações")');
  await page.waitForSelector('.banner', { timeout: 20000 });
  await page.waitForTimeout(600);
  console.log('Token inválido:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());
  console.log('Chamadas com token inválido:', calls.length);

  console.log('\nErros:', errors.length ? errors : 'nenhum');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
