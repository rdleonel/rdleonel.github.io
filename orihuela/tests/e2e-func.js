// Fluxos de edição com a navegação nova: operação, recompra, erro, renomear, novo cliente.
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/orihuela/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const tab = name => page.click(`.tabbar button:has-text("${name}")`);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  await page.waitForSelector('.tabbar button');
  console.log('Home AUM:', await page.textContent('.hero .value'));

  // cotação isolada pela lista
  await tab('Cotações');
  await page.waitForSelector('.quote-row');
  await page.click('.quote-row:has-text("BOVA11")');
  await page.waitForSelector('.sheet input[inputmode="decimal"]');
  await page.fill('.sheet input[inputmode="decimal"]', '185,00');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  console.log('Cotação isolada:', await page.textContent('.toast'));

  // carteira
  await tab('Clientes');
  await page.waitForSelector('.list-item');
  await page.click('.list-item:has-text("RD")');
  await page.waitForSelector('table.tbl');
  await page.waitForTimeout(250);
  console.log('RD total:', await page.textContent('.hero .value'));
  console.log('BOVA11:', await page.$eval('table.tbl tbody tr:has-text("BOVA11")', tr => tr.innerText.replace(/\s+/g, ' ')));

  // venda comprada
  await page.click('#actionbar button:has-text("Nova operação")');
  await page.selectOption('.sheet select', 'sell');
  await page.fill('.sheet input[list="ticker-list"]', 'gmat3');
  let dec = await page.$$('.sheet input[inputmode="decimal"]:visible');
  await dec[0].fill('200'); await dec[1].fill('5,00');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  console.log('Venda:', await page.textContent('.toast'));

  // recompra de vendida
  await page.click('#actionbar button:has-text("Nova operação")');
  await page.selectOption('.sheet select', 'buy');
  await page.fill('.sheet input[list="ticker-list"]', 'PRIO3');
  dec = await page.$$('.sheet input[inputmode="decimal"]:visible');
  await dec[0].fill('4'); await dec[1].fill('60,00');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.toast');
  console.log('Recompra:', await page.textContent('.toast'));
  await page.waitForTimeout(300);
  console.log('Caixa:', await page.$eval('.stat:has-text("Caixa") .value', e => e.textContent));
  console.log('PRIO3 ainda na tabela:', await page.$$eval('table.tbl tbody tr', trs => trs.some(t => /PRIO3/.test(t.innerText))));

  // erro de validação
  await page.click('#actionbar button:has-text("Nova operação")');
  await page.selectOption('.sheet select', 'sell');
  await page.fill('.sheet input[list="ticker-list"]', 'GMAT3');
  dec = await page.$$('.sheet input[inputmode="decimal"]:visible');
  await dec[0].fill('999999'); await dec[1].fill('5');
  await page.click('.sheet button[type="submit"]');
  console.log('Erro esperado:', await page.textContent('.sheet .form-error'));
  await page.click('.sheet button:has-text("Cancelar")');

  // menu: editar cliente (renomear e caixa)
  await page.click('#actionbar button:has-text("•••")');
  await page.click('.sheet-menu button:has-text("Editar cliente")');
  await page.waitForSelector('.sheet input[type="text"]');
  await page.fill('.sheet input[type="text"] >> nth=0', 'RD2');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(200);
  console.log('Renomeado para:', await page.textContent('#title'));

  // menu: registrar ponto
  await page.click('#actionbar button:has-text("•••")');
  await page.click('.sheet-menu button:has-text("Registrar ponto agora")');
  await page.waitForSelector('.toast');
  console.log('Ponto:', await page.textContent('.toast'));

  // novo cliente pela action bar
  await tab('Clientes');
  await page.click('#actionbar button:has-text("Novo cliente")');
  await page.fill('.sheet input[type="text"] >> nth=0', 'Teste');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('#title:has-text("Teste")');
  await page.click('#actionbar button:has-text("•••")');
  await page.click('.sheet-menu button:has-text("Adicionar ação")');
  await page.fill('.sheet input[list="ticker-list"]', 'PETR4');
  dec = await page.$$('.sheet input[inputmode="decimal"]:visible');
  await dec[0].fill('100'); await dec[1].fill('30,00'); await dec[2].fill('35,00');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(250);
  console.log('Teste:', await page.textContent('.hero .value'), '|', await page.textContent('.hero .delta'));

  await tab('Desempenho');
  await page.waitForSelector('table.tbl');
  console.log('Desempenho:', await page.$eval('table.tbl', t => t.innerText.replace(/\s+/g, ' ')));
  await page.screenshot({ path: path.join(OUT, 'func-perf.png') });

  console.log('\nErros:', errors.length ? errors : 'nenhum');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
