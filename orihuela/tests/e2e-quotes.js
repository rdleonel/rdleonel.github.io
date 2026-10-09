// Atualização de cotações: busca automática (serviço simulado), print e falha de rede.
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/orihuela/';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // o passo 3 derruba o serviço de propósito: a falha de rede dele não conta como erro
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

  // serviço de cotações simulado, no formato da brapi (results[].symbol / regularMarketPrice)
  let mode = 'ok';
  let lastUrl = '';
  await ctx.route('https://brapi.dev/**', async route => {
    lastUrl = route.request().url();
    if (mode === 'down') return route.abort('failed');
    const tickers = decodeURIComponent(lastUrl.split('/quote/')[1].split('?')[0]).split(',');
    const results = tickers
      .filter(t => mode !== 'partial' || !/^(MAXR11|XPCM11|RNGO11)$/.test(t))
      .map((t, i) => ({ symbol: t, regularMarketPrice: 10 + i, currency: 'BRL' }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) });
  });

  // domingo: fora do pregão, o app não busca preços ao vivo sozinho e a contagem de chamadas fica limpa
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00-03:00'));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  await page.waitForSelector('.tabbar button');

  console.log('Botão na tela inicial:', (await page.textContent('#actionbar')).replace(/\s+/g, ' ').trim());

  // token configurado (a busca automática só roda com token)
  await page.evaluate(() => {
    localStorage.setItem('orihuela.quotes', JSON.stringify({ url: 'https://brapi.dev/api/quote/{TICKERS}?token={TOKEN}', token: 'tok_teste', sep: ',', auth: '' }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.waitForSelector('.tabbar button');

  // 1) na aba Cotações, um toque busca tudo
  await page.click('.tabbar button:has-text("Cotações")');
  await page.click('#actionbar button:has-text("Atualizar cotações")');
  await page.waitForSelector('.quote-row input');
  await page.waitForSelector('.banner');
  console.log('Aviso:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());
  console.log('URL chamada:', lastUrl.replace(/token=[^&]*/, 'token=***'));
  const filled = await page.$$eval('.quote-row.filled', els => els.length);
  const total = await page.$$eval('.quote-row', els => els.length);
  console.log('Campos preenchidos pela busca: ' + filled + '/' + total);
  console.log('Primeiras linhas:', await page.$$eval('.quote-row', els => els.slice(0, 3).map(e => e.innerText.replace(/\s+/g, ' ')).join(' | ')));
  const firstVal = await page.$eval('.quote-row input', i => i.value);
  console.log('Valor do primeiro campo:', firstVal);
  await page.screenshot({ path: path.join(OUT, 'q-fetch.png') });

  // salvar
  await page.click('#actionbar button:has-text("Salvar cotações")');
  await page.waitForSelector('.toast');
  console.log('Salvou:', await page.textContent('.toast'));
  await page.waitForTimeout(200);
  console.log('Lista após salvar:', await page.$$eval('.quote-row', els => els.slice(0, 2).map(e => e.innerText.replace(/\s+/g, ' ')).join(' | ')));

  // 2) print
  await page.click('#actionbar button:has-text("Atualizar cotações")');
  await page.waitForSelector('.quote-row input');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Usar um print")')
  ]);
  await chooser.setFiles(path.join(__dirname, '..', 'icons', 'icon-512.png'));
  await page.waitForSelector('.shot img');
  const shotBox = await page.$eval('.shot', el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; });
  console.log('Painel do print: topo=' + shotBox.top + ' altura=' + shotBox.h);
  await page.screenshot({ path: path.join(OUT, 'q-shot.png') });
  // rola a lista e confere que o print continua visível
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(150);
  const stillTop = await page.$eval('.shot', el => Math.round(el.getBoundingClientRect().top));
  console.log('Print após rolar 400px: topo=' + stillTop + (stillTop <= 5 ? ' (continua fixo)' : ' (saiu da tela)'));
  await page.click(".shot-bar button:text-is(\"Maior\")");
  console.log('Recolheu:', await page.$eval('.shot', el => el.className));
  await page.click('#actionbar button:has-text("Cancelar")');

  // 3) serviço fora do ar
  mode = 'down';
  await page.click('#actionbar button:has-text("Atualizar cotações")');
  await page.waitForSelector('.banner');
  console.log('Serviço fora do ar:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());

  // 4) resposta parcial
  mode = 'partial';
  await page.click('button:has-text("Buscar cotações")');
  await page.waitForTimeout(400);
  console.log('Resposta parcial:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());
  await page.click('#actionbar button:has-text("Cancelar")');

  // 5) Ajustes: testar serviço
  mode = 'ok';
  await page.click('.tabbar button:has-text("Ajustes")');
  await page.waitForSelector('.card:has-text("Serviço de cotações")');
  await page.evaluate(() => { document.querySelector('#toast-root').innerHTML = ''; });
  await page.click('.card:has-text("Serviço de cotações") button:text-is("Testar")');
  await page.waitForFunction(() => {
    const t = document.querySelector('.toast');
    return t && /reconhecidos/.test(t.textContent);
  }, null, { timeout: 8000 }).catch(() => {});
  console.log('Teste em Ajustes:', await page.textContent('.toast').catch(() => '(sem toast)'),
    '| msg:', await page.$eval('.card:has-text("Serviço de cotações") .form-error', e => e.textContent));
  await page.screenshot({ path: path.join(OUT, 'q-settings.png'), fullPage: true });

  console.log('\nErros:', errors.length ? errors : 'nenhum');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
