// Verifica a navegação por barra inferior: alcance do polegar, abas, ações e volta.
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/orihuela/';
const VH = 844;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: VH }, deviceScaleFactor: 2, isMobile: false, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  await page.waitForSelector('.lock', { state: 'detached' });
  await page.waitForSelector('.tabbar button');

  // 1) Nada clicável no cabeçalho
  console.log('Botões no header:', await page.$$eval('header button, header a, header [onclick]', els => els.length));
  console.log('Abas:', await page.$$eval('.tabbar button', els => els.map(e => e.textContent.trim()).join(' | ')));

  // 2) Onde ficam os controles fixos (quanto maior o Y, melhor para o polegar)
  const fixedPos = async (label) => {
    const r = await page.evaluate(() => {
      const out = {};
      const tab = document.querySelector('.tabbar'); const ab = document.querySelector('#actionbar');
      out.tabTop = Math.round(tab.getBoundingClientRect().top);
      out.abVisible = !ab.classList.contains('hidden');
      out.abTop = out.abVisible ? Math.round(ab.getBoundingClientRect().top) : null;
      out.abH = out.abVisible ? Math.round(ab.getBoundingClientRect().height) : 0;
      // alvo de toque menor que 44px em qualquer controle fixo
      const small = [];
      document.querySelectorAll('.tabbar button, #actionbar button').forEach(b => {
        const r = b.getBoundingClientRect();
        if (r.height < 44 || r.width < 40) small.push(b.textContent.trim() + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      out.small = small;
      return out;
    });
    console.log(`${label}: abas em y=${r.tabTop} (${Math.round(r.tabTop / VH * 100)}% da tela)` +
      (r.abVisible ? `, barra de ação em y=${r.abTop} alt=${r.abH}` : ', sem barra de ação') +
      (r.small.length ? `  ALVOS PEQUENOS: ${r.small.join(', ')}` : ''));
    return r;
  };
  await fixedPos('Início');
  await page.screenshot({ path: path.join(OUT, 'nav-home.png') });

  // 3) Percorrer as abas
  for (const [label, expect] of [['Cotações', 'Cotações'], ['Clientes', 'Clientes'], ['Desempenho', 'Desempenho'], ['Ajustes', 'Ajustes']]) {
    await page.click(`.tabbar button:has-text("${label}")`);
    await page.waitForTimeout(150);
    const title = await page.textContent('#title');
    const on = await page.textContent('.tabbar button.on');
    console.log(`Aba ${label} -> título "${title}" | aba ativa "${on.trim()}" ${title === expect ? 'OK' : 'DIVERGE'}`);
  }

  await page.click('.tabbar button:has-text("Cotações")');
  await page.waitForSelector('.quote-row');
  await fixedPos('Cotações');
  await page.screenshot({ path: path.join(OUT, 'nav-quotes.png') });
  await page.click('#actionbar button:has-text("Atualizar cotações")');
  await page.waitForSelector('.quote-row input');
  const editBar = await fixedPos('Cotações (edição)');
  await page.screenshot({ path: path.join(OUT, 'nav-quotes-edit.png') });
  // o último campo da lista não pode ficar escondido atrás das barras
  const hidden = await page.evaluate(() => {
    const rows = document.querySelectorAll('.quote-row');
    const last = rows[rows.length - 1].getBoundingClientRect();
    window.scrollTo(0, document.body.scrollHeight);
    const after = document.querySelectorAll('.quote-row')[rows.length - 1].getBoundingClientRect();
    const ab = document.querySelector('#actionbar').getBoundingClientRect();
    return { lastBottomAfterScroll: Math.round(after.bottom), actionTop: Math.round(ab.top), oculto: after.bottom > ab.top + 1 };
  });
  console.log('Último campo após rolar até o fim: bottom=' + hidden.lastBottomAfterScroll + ' vs barra em ' + hidden.actionTop + ' -> ' + (hidden.oculto ? 'ESCONDIDO' : 'visível'));
  await page.click('#actionbar button:has-text("Cancelar")');
  await page.waitForTimeout(150);

  // 4) Cliente: ação principal embaixo, menu e volta pela aba
  await page.click('.tabbar button:has-text("Clientes")');
  await page.waitForSelector('.list-item');
  await fixedPos('Clientes');
  await page.click('.list-item:has-text("RD")');
  await page.waitForSelector('table.tbl');
  await page.waitForTimeout(250);
  await fixedPos('Carteira RD');
  await page.screenshot({ path: path.join(OUT, 'nav-client.png') });
  console.log('Aba ativa na carteira:', (await page.textContent('.tabbar button.on')).trim());
  await page.click('#actionbar button:has-text("•••")');
  await page.waitForSelector('.sheet-menu');
  console.log('Menu:', await page.$$eval('.sheet-menu button', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
  await page.screenshot({ path: path.join(OUT, 'nav-client-menu.png') });
  await page.click('.sheet-menu button:has-text("Adicionar ação")');
  await page.waitForSelector('.sheet input[list="ticker-list"]');
  console.log('Menu abre o formulário de ação: OK');
  await page.click('.sheet button:has-text("Cancelar")');

  // ação principal
  await page.click('#actionbar button:has-text("Nova operação")');
  await page.waitForSelector('.sheet select');
  console.log('Nova operação abre: OK');
  await page.click('.sheet button:has-text("Cancelar")');

  // voltar tocando na aba Clientes
  await page.click('.tabbar button:has-text("Clientes")');
  await page.waitForTimeout(200);
  console.log('Voltou para:', await page.textContent('#title'));

  // 5) Gesto de arrastar da borda esquerda
  await page.click('.list-item:has-text("RD")');
  await page.waitForSelector('table.tbl');
  await page.touchscreen.tap(200, 400);
  await page.evaluate(() => {
    const fire = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
      document.body.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] }));
    };
    fire('touchstart', 8, 400); fire('touchend', 140, 410);
  });
  await page.waitForTimeout(250);
  console.log('Após arrastar da borda:', await page.textContent('#title'));

  // 6) Offline
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForSelector('.lock', { timeout: 10000 });
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.waitForSelector('.tabbar button');
  await page.click('.tabbar button:has-text("Clientes")');
  await page.waitForSelector('.list-item');
  console.log('Off-line, clientes:', await page.$$eval('.list-item .t1', els => els.map(e => e.textContent).join(', ')));
  await ctx.setOffline(false);

  console.log('\nErros de página/console:', errors.length ? errors : 'nenhum');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
