// Leitura de prints pela IA: envio da imagem, conferência, aplicação e falhas da API.
// A API da Anthropic é interceptada, então o teste não gasta chave nem depende de rede.
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || require('os').tmpdir();
const BASE = process.env.BASE || 'http://127.0.0.1:8765/orihuela/';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access'
};

// O que a IA "leu" no print: duas posições (uma vendida), uma operação e uma cotação.
const LEITURA = {
  kind: 'carteira',
  date: '2026-10-02',
  client: null,
  positions: [
    { ticker: 'TSTA3', qty: 100, avgPrice: 20.69358, price: 24.5 },
    { ticker: 'TSTB11', qty: -40, avgPrice: 174.74, price: 170.1 }
  ],
  trades: [{ side: 'sell', ticker: 'TSTA3', qty: 30, price: 25.0, date: '2026-10-01' }],
  quotes: [{ ticker: 'TSTC34', price: 61.3 }],
  note: 'Carteira de 02/10/2026; o preço médio de TSTB11 veio da nota, não do print.'
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

  let mode = 'ok', lastBody = null, lastHeaders = null, chamadas = 0;
  await ctx.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    chamadas++;
    lastHeaders = await req.allHeaders();
    try { lastBody = JSON.parse(req.postData() || '{}'); } catch (e) { lastBody = null; }
    if (mode === 'auth') {
      return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid x-api-key' } }) });
    }
    const texto = mode === 'lixo' ? 'não consegui ler' : '```json\n' + JSON.stringify(LEITURA) + '\n```';
    await route.fulfill({
      status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        stop_reason: 'end_turn', content: [{ type: 'text', text: texto }],
        usage: { input_tokens: 1200, output_tokens: 180 }
      })
    });
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.click('.keypad button:text-is("OK")');
  await page.waitForSelector('.tabbar button');

  // 1) sem chave configurada o app explica em vez de falhar
  await page.click('#actionbar button[aria-label="Ler um print"]');
  await page.waitForSelector('.banner');
  console.log('Sem chave:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim().slice(0, 90));

  await page.evaluate(() => localStorage.setItem('orihuela.ai', JSON.stringify({
    url: 'https://api.anthropic.com/v1/messages', key: 'sk-ant-teste', model: 'claude-opus-5-5'
  })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.lock');
  for (const k of '1234') await page.click(`.keypad button:text-is("${k}")`);
  await page.waitForSelector('.tabbar button');
  await page.click('.tabbar button:has-text("Início")');   // o reload reabre em #/read

  // 2) escolher o print e mandar ler
  await page.click('#actionbar button[aria-label="Ler um print"]');
  await page.waitForSelector('#actionbar button:has-text("Escolher prints")');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#actionbar button:has-text("Escolher prints")')
  ]);
  await chooser.setFiles(path.join(__dirname, '..', 'icons', 'icon-512.png'));
  await page.waitForSelector('.shot-thumb img');
  console.log('Miniatura:', await page.textContent('.shot-thumb .px'));
  await page.screenshot({ path: path.join(OUT, 'r-pick.png') });

  await page.click('#actionbar button:has-text("Ler com a IA")');
  await page.waitForSelector('.read-item', { timeout: 10000 });

  // o que foi para a API
  const img = lastBody.messages[0].content.find(c => c.type === 'image');
  console.log('Chamada à API: modelo=' + lastBody.model,
    '| imagens=' + lastBody.messages[0].content.filter(c => c.type === 'image').length,
    '| mídia=' + img.source.media_type,
    '| bytes≈' + Math.round(img.source.data.length * 0.75),
    '| schema=' + (lastBody.output_config && lastBody.output_config.format && lastBody.output_config.format.type),
    '| system=' + lastBody.system.length + ' chars');
  console.log('Cabeçalho de navegador:', lastHeaders['anthropic-dangerous-direct-browser-access'],
    '| versão:', lastHeaders['anthropic-version'], '| chave enviada:', lastHeaders['x-api-key'] ? 'sim' : 'não');
  if (/sk-ant/.test(JSON.stringify(lastBody))) errors.push('a chave vazou para o corpo da requisição');

  // 3) tela de conferência
  const linhas = await page.$$eval('.read-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  console.log('Linhas reconhecidas (' + linhas.length + '):');
  linhas.forEach(l => console.log('  · ' + l.slice(0, 96)));
  console.log('Observação da IA:', (await page.textContent('.card:has-text("O que a IA leu") p')).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(OUT, 'r-review.png'), fullPage: true });

  // aplicar sem escolher cliente tem que reclamar, não gravar
  await page.click('#actionbar button:has-text("Aplicar")');
  console.log('Sem cliente:', await page.textContent('#actionbar .form-error'));

  // 4) escolhe o cliente, desmarca uma linha e aplica
  const cliente = await page.$eval('#view select option:nth-child(2)', o => ({ v: o.value, t: o.textContent }));
  await page.selectOption('#view select', cliente.v);
  await page.uncheck('.card:has-text("Operações") .read-item input[type=checkbox]');
  console.log('Cliente escolhido:', cliente.t, '| operação desmarcada');
  await page.click('#actionbar button:has-text("Aplicar")');
  await page.waitForSelector('.toast');
  console.log('Resultado:', (await page.textContent('.toast')).replace(/\s+/g, ' ').trim());
  await page.waitForSelector('.tbl');

  const carteira = await page.$$eval('.tbl tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  console.log('Na carteira de ' + cliente.t + ':');
  carteira.filter(l => /TST/.test(l)).forEach(l => console.log('  · ' + l));
  const estado = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('orihuela.state')).data;
    const c = d.clients.find(c => c.positions.some(p => p.ticker === 'TSTA3'));
    return {
      pos: c.positions.filter(p => /^TST/.test(p.ticker)).map(p => p.ticker + ' ' + p.qty + ' @ ' + p.avgPrice),
      ops: c.transactions.length,
      cot: ['TSTA3', 'TSTB11', 'TSTC34'].map(t => t + '=' + (d.quotes[t] ? d.quotes[t].price : '—')).join(' '),
      ponto: c.history[c.history.length - 1].date
    };
  });
  console.log('Posições gravadas:', estado.pos.join(' | '));
  console.log('Cotações gravadas:', estado.cot, '| ponto no gráfico:', estado.ponto);
  if (!estado.pos.some(p => p.includes('TSTA3 100 @ 20.69358'))) errors.push('preço médio preciso não foi preservado');
  if (!estado.pos.some(p => p.includes('TSTB11 -40'))) errors.push('posição vendida não entrou negativa');
  console.log('Operação desmarcada não foi lançada:', estado.ops === 0 ? 'sim' : 'NÃO (' + estado.ops + ' operações)');
  if (estado.ops !== 0) errors.push('linha desmarcada foi aplicada mesmo assim');

  // 5) chave recusada
  mode = 'auth';
  await page.click('.tabbar button:has-text("Início")');
  await page.click('#actionbar button[aria-label="Ler um print"]');
  const [ch2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#actionbar button:has-text("Escolher prints")')
  ]);
  await ch2.setFiles(path.join(__dirname, '..', 'icons', 'icon-512.png'));
  await page.waitForSelector('.shot-thumb img');
  await page.click('#actionbar button:has-text("Ler com a IA")');
  await page.waitForSelector('.banner', { timeout: 10000 });
  console.log('Chave recusada:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());

  // 6) resposta sem JSON
  mode = 'lixo';
  await page.click('#actionbar button:has-text("Ler com a IA")');
  await page.waitForFunction(() => /JSON/.test(document.querySelector('.banner') ? document.querySelector('.banner').textContent : ''), null, { timeout: 10000 }).catch(() => {});
  console.log('Resposta sem JSON:', (await page.textContent('.banner')).replace(/\s+/g, ' ').trim());

  // 7) Ajustes: testar a chave
  mode = 'ok';
  await page.click('.tabbar button:has-text("Ajustes")');
  await page.waitForSelector('.card:has-text("Leitura de prints")');
  await page.evaluate(() => { document.querySelector('#toast-root').innerHTML = ''; });
  await page.click('.card:has-text("Leitura de prints") button:text-is("Testar")');
  await page.waitForSelector('.toast', { timeout: 8000 }).catch(() => {});
  console.log('Teste em Ajustes:', await page.textContent('.toast').catch(() => '(sem toast)'));
  console.log('Chamadas à API no teste todo:', chamadas);
  await page.screenshot({ path: path.join(OUT, 'r-settings.png'), fullPage: true });

  console.log('\nErros:', errors.length ? errors : 'nenhum');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
