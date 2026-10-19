// Comissão: padrão de 10%, percentual por cliente, cálculo sobre o ganho acima da base do bônus, só no aparelho.
const { chromium } = require('playwright');
const { DATA, useFixture, contextOptions } = require('./fixture');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/orihuela/';
const C = require('../core.js');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' }, contextOptions));
  await useFixture(ctx);
  const page = await ctx.newPage();
  const errors = [], fails = [];
  const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FALHA ') + msg); if (!ok) fails.push(msg); };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00-03:00')); // domingo: sem busca ao vivo
  const pin = async () => { for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`); };
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  await pin(); await page.click('.keypad button:text-is("OK")');
  await pin(); await page.click('.keypad button:text-is("OK")');
  await page.waitForSelector('.tabbar button');

  // cliente com base do bônus e ganho acima dela, calculado com o mesmo core.js
  const d = C.normalize(JSON.parse(JSON.stringify(DATA)));
  const cand = d.clients.map(c => ({ c, r: C.computeClient(c, d.quotes) })).find(x => x.r.bonusBase && x.r.total > x.r.bonusBase.value);
  if (!cand) { console.log('Nenhum cliente acima da base do bônus nos dados; teste pulado.'); await browser.close(); process.exit(0); }
  const gain = cand.r.total - cand.r.bonusBase.value;
  const brl = n => C.fmtBRL(n);
  console.log('Cliente:', cand.c.name, '| ganho acima da base:', brl(gain));

  const hero = (await page.textContent('.hero')).replace(/\s+/g, ' ');
  check(hero.includes('Comissões a receber'), 'painel mostra o total de comissões');

  await page.click('.tabbar button:has-text("Clientes")');
  await page.click(`.list-item:has-text("${cand.c.name}")`);
  await page.waitForSelector('.fee-stat');
  let v = (await page.textContent('.fee-stat .value')).trim();
  console.log('Comissão padrão:', (await page.textContent('.fee-stat')).replace(/\s+/g, ' '));
  check(v === brl(gain * 0.10), 'padrão de 10% sobre o ganho (' + v + ' = ' + brl(gain * 0.10) + ')');

  // 20% só para este cliente, pelo toque no quadro
  await page.click('.fee-stat');
  await page.fill('.sheet input[inputmode="decimal"]', '20');
  await page.click('.sheet button[type="submit"]');
  await page.waitForTimeout(200);
  v = (await page.textContent('.fee-stat .value')).trim();
  check(v === brl(gain * 0.20), '20% para este cliente (' + v + ')');
  await page.screenshot({ path: path.join(OUT, 'fee-client.png') });

  // Ajustes: padrão muda para 15%, o cliente com 20% não muda
  await page.click('.tabbar button:has-text("Ajustes")');
  await page.waitForSelector('.card:has-text("Comissões")');
  await page.fill('#fee-def', '15');
  await page.click('button:has-text("Salvar comissões")');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('orihuela.fees')));
  console.log('Guardado no aparelho:', JSON.stringify(saved));
  check(saved.def === 15 && Object.values(saved.byClient).includes(20), 'padrão 15% e o cliente com 20% guardados');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('orihuela.state')));
  check(st.dirty === false && !JSON.stringify(st.data).includes('byClient'), 'nada de comissão nos dados sincronizados');
  await page.screenshot({ path: path.join(OUT, 'fee-settings.png'), fullPage: true });

  console.log('\nErros:', errors.length ? errors : 'nenhum');
  await browser.close();
  process.exit(errors.length || fails.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
