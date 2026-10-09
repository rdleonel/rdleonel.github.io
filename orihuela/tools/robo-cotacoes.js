#!/usr/bin/env node
/*
 * Robô de cotações do Orihuela Consulting.
 * Roda no GitHub Actions todo dia útil depois do fechamento (.github/workflows/orihuela-cotacoes.yml),
 * mas também funciona à mão:  BRAPI_TOKEN=... node orihuela/tools/robo-cotacoes.js [--dry-run]
 *
 * 1. Busca na brapi a cotação de cada papel que está em alguma carteira (um papel por
 *    consulta, que é o que o plano gratuito permite), com o fechamento anterior.
 * 2. Grava as cotações em orihuela/data.json usando o mesmo core.js do app e do CLI.
 * 3. Registra o ponto do pregão no gráfico de todos os clientes. A data do ponto é a do
 *    pregão informado pela brapi, então rodar num feriado só regrava o ponto do último pregão.
 *
 * Sai com código 0 mesmo se alguns papéis faltarem (eles são listados); sai com erro só se
 * nada vier, para o workflow não gravar um arquivo sem mudança real.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../core.js');

const FILE = path.join(__dirname, '..', 'data.json');
const TOKEN = process.env.BRAPI_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const API = 'https://brapi.dev/api/quote/';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOne(ticker) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res, json = null;
    try {
      res = await fetch(API + encodeURIComponent(ticker), { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
      try { json = await res.json(); } catch (e) { /* corpo vazio */ }
    } catch (e) {
      if (attempt === 3) return { error: 'sem conexão: ' + e.message };
      await sleep(1500 * attempt); continue;
    }
    if (res.status === 429 || res.status >= 500) { if (attempt === 3) return { error: 'HTTP ' + res.status }; await sleep(3000 * attempt); continue; }
    if (!res.ok) return { error: 'HTTP ' + res.status + (json && json.message ? ' ' + json.message : ''), fatal: res.status === 401 };
    const r = json && Array.isArray(json.results) ? json.results.find(x => C.normTicker(x.symbol) === ticker) || json.results[0] : null;
    if (!r || !(r.regularMarketPrice > 0)) return { error: 'sem preço na resposta' };
    // fechamento anterior = preço − variação do dia. O campo regularMarketPreviousClose da
    // brapi às vezes traz o preço do after-market, então só serve de reserva.
    const prev = Number.isFinite(r.regularMarketChange) ? r.regularMarketPrice - r.regularMarketChange
      : r.regularMarketPreviousClose > 0 ? r.regularMarketPreviousClose : undefined;
    return {
      price: r.regularMarketPrice,
      prev: prev > 0 ? Math.round(prev * 100) / 100 : undefined,
      at: r.regularMarketTime || new Date().toISOString(),
      remaining: res.headers.get('ratelimit-remaining')
    };
  }
  return { error: 'falhou' };
}

(async () => {
  if (!TOKEN) console.warn('Aviso: BRAPI_TOKEN vazio; sem token a brapi só responde PETR4, MGLU3, VALE3 e ITUB4.');
  const data = C.normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  const wanted = C.tickers(data);
  const got = {}, failed = [];
  let remaining = null;
  for (const t of wanted) {
    const r = await fetchOne(t);
    if (r.error) {
      failed.push(t + ' (' + r.error + ')');
      if (r.fatal) { console.error('Token recusado pela brapi. Confira o secret BRAPI_TOKEN.'); process.exit(1); }
    } else { got[t] = { price: r.price, prev: r.prev, at: r.at }; if (r.remaining != null) remaining = r.remaining; }
    await sleep(250);
  }
  const n = Object.keys(got).length;
  console.log('Cotações: ' + n + ' de ' + wanted.length + (failed.length ? ' · faltaram: ' + failed.join(', ') : ''));
  if (remaining != null) console.log('Consultas restantes no plano: ' + remaining);
  if (!n) { console.error('Nenhuma cotação recebida; nada foi gravado.'); process.exit(1); }

  // data do pregão = a mais comum entre os horários informados
  const count = {};
  Object.values(got).forEach(q => { const d = C.tradingDate(q.at); if (d) count[d] = (count[d] || 0) + 1; });
  const session = Object.keys(count).sort((a, b) => count[b] - count[a] || (a < b ? 1 : -1))[0] || C.localDateISO();

  C.setQuotes(data, got);
  C.snapshotAll(data, session);
  console.log('Ponto do pregão de ' + session + ' registrado para ' + data.clients.length + ' clientes.');
  C.computeAll(data).forEach(r => console.log('  ' + r.name.padEnd(10) + C.fmtBRL(r.total).padStart(18) + '  ' +
    'dia ' + (r.dayPct == null ? '—' : C.fmtPct(r.dayPct)).padStart(8) + '  acum. ' + C.fmtPct(r.ret)));
  if (DRY) { console.log('(--dry-run: nada gravado)'); return; }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
})().catch(e => { console.error(e); process.exit(1); });
