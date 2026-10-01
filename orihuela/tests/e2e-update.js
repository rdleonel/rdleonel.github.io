// Atualização do app: aviso de versão nova, instalação e preservação dos dados locais.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = 'http://127.0.0.1:8765/orihuela/';
const SW = path.join(__dirname, '..', 'sw.js');

(async () => {
  const original = fs.readFileSync(SW, 'utf8');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const pin = async () => { for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`); };

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.lock');
    await pin(); await page.click('.keypad button:text-is("OK")');
    await pin(); await page.click('.keypad button:text-is("OK")');
    await page.waitForSelector('.tabbar button');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    console.log('Service worker no controle: sim');
    console.log('Versão mostrada:', await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(e => /versão/i.test(e.textContent) && e.children.length === 0);
      return el ? el.textContent : '(ver em Ajustes)';
    }));

    // dado local que não pode se perder: cliente criado só no aparelho
    await page.click('.tabbar button:has-text("Clientes")');
    await page.click('#actionbar button:has-text("Novo cliente")');
    await page.fill('.sheet input[type="text"] >> nth=0', 'TesteLocal');
    await page.click('.sheet button[type="submit"]');
    await page.waitForSelector('#title:has-text("TesteLocal")');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('orihuela.state')).data.clients.map(c => c.name).join(','));
    console.log('Clientes antes de atualizar:', before);

    // publica uma "versão nova" do app
    const novo = original.replace(/const CACHE = '[^']+';/, "const CACHE = 'orihuela-teste-" + Date.now() + "';");
    if (novo === original) throw new Error('não achei a linha do cache em sw.js');
    fs.writeFileSync(SW, novo);
    console.log('Publicada versão nova no servidor (cache v7-teste)');

    await page.click('.tabbar button:has-text("Ajustes")');
    await page.waitForSelector('button:has-text("Procurar atualização")');
    await page.click('button:has-text("Procurar atualização")');
    await page.waitForSelector('.banner:has-text("versão nova")', { timeout: 20000 });
    console.log('Aviso:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());
    console.log('Botão em Ajustes:', await page.$eval('.card:has-text("Versão do aplicativo") .btn', b => b.textContent));

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {}),
      page.click('.banner button:has-text("Atualizar agora")')
    ]);
    await page.waitForSelector('.lock', { timeout: 15000 });
    await pin();
    await page.waitForSelector('.tabbar button');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('orihuela.state')).data.clients.map(c => c.name).join(','));
    console.log('Clientes depois de atualizar:', after, before === after ? 'IGUAL (nada perdido)' : 'DIVERGE');
    const cache = await page.evaluate(() => caches.keys());
    console.log('Caches no aparelho:', cache.join(', '));
    const pinKept = await page.evaluate(() => !!localStorage.getItem('orihuela.pin'));
    console.log('PIN preservado:', pinKept);

    console.log('\nErros:', errors.length ? errors : 'nenhum');
  } finally {
    fs.writeFileSync(SW, original);
    await browser.close();
  }
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
