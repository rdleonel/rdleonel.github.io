/*
 * Orihuela Consulting — núcleo de cálculo.
 * Funções puras, sem DOM. Usado pelo app (navegador) e pelo tools/cli.js (Node),
 * para que os números sejam idênticos nos dois lugares.
 *
 * Modelo de dados (data.json):
 * {
 *   version: 1,
 *   updatedAt: ISO string (qualquer alteração em qualquer lugar atualiza),
 *   quotes: { "PETR4": { price: 38.12, at: ISO } , ... },
 *   clients: [{
 *     id, name,
 *     cash: saldo em dinheiro na conta (soma ao patrimônio),
 *     capital: capital aportado (base da rentabilidade acumulada;
 *              inicia como custo das ações + caixa, e só muda com aporte/retirada),
 *     bonusBase: { value, date } | null  (valor da carteira no último bônus),
 *     positions: [{ ticker, qty, avgPrice }],
 *     transactions: [{ id, date, type, ticker, qty, price, value, result, note, prev }],
 *     history: [{ date, total, invested, cash, capital, ret }]
 *   }]
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrihuelaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- utilidades ----------
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function num(v, fallback) {
    const n = typeof v === 'number' ? v : parseNum(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function localDateISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function normTicker(t) { return String(t || '').trim().toUpperCase(); }
  function isISODate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

  // "38,12" -> 38.12 ; "1.234,56" -> 1234.56 ; "1234.56" -> 1234.56 ; "1.234" -> 1234
  function parseNum(s) {
    if (typeof s === 'number') return s;
    if (s == null) return NaN;
    let t = String(s).trim().replace(/\s/g, '').replace(/^R\$/, '').replace(/%$/, '');
    if (!t) return NaN;
    if (t.indexOf(',') >= 0) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      const dots = (t.match(/\./g) || []).length;
      if (dots > 1) t = t.replace(/\./g, '');
      else if (dots === 1 && /\.\d{3}$/.test(t) && !/^\d\.\d{3}$/.test(t)) {
        // "12.345" -> milhar ; "1.234" (um dígito antes) fica como decimal? Em pt-BR, 1.234 = mil.
        t = t.replace('.', '');
      } else if (dots === 1 && /^\d\.\d{3}$/.test(t)) {
        t = t.replace('.', '');
      }
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  // ---------- formatação pt-BR ----------
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dec2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  function fmtBRL(n) { return Number.isFinite(n) ? brl.format(n) : '—'; }
  function fmtNum(n) { return Number.isFinite(n) ? dec2.format(n) : '—'; }
  function fmtInt(n) { return Number.isFinite(n) ? int0.format(n) : '—'; }
  function fmtSignedBRL(n) {
    if (!Number.isFinite(n)) return '—';
    const s = brl.format(Math.abs(n));
    return (n < 0 ? '-' : n > 0 ? '+' : '') + s;
  }
  function fmtPct(x, digits) {
    if (!Number.isFinite(x)) return '—';
    const d = digits == null ? 2 : digits;
    const v = (x * 100).toFixed(d).replace('.', ',');
    return (x > 0 ? '+' : '') + v + '%';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const s = String(iso);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s;
    return m[3] + '/' + m[2] + '/' + m[1];
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // ---------- estrutura ----------
  function emptyData() {
    return { version: 1, updatedAt: new Date().toISOString(), quotes: {}, clients: [] };
  }
  function newClient(name) {
    return {
      id: uid('c'), name: String(name || 'Novo cliente').trim() || 'Novo cliente',
      cash: 0, capital: 0, bonusBase: null, positions: [], transactions: [], history: []
    };
  }
  function normalizeClient(c) {
    c.id = c.id || uid('c');
    c.name = String(c.name || 'Cliente');
    c.cash = round2(num(c.cash));
    c.capital = round2(num(c.capital));
    if (c.bonusBase && Number.isFinite(num(c.bonusBase.value, NaN))) {
      c.bonusBase = { value: round2(num(c.bonusBase.value)), date: c.bonusBase.date || null };
    } else c.bonusBase = null;
    c.positions = (c.positions || []).map(p => ({
      ticker: normTicker(p.ticker), qty: num(p.qty), avgPrice: num(p.avgPrice)
    })).filter(p => p.ticker && p.qty > 0);
    c.transactions = (c.transactions || []).map(t => Object.assign({ id: uid('t') }, t));
    c.history = (c.history || []).filter(h => isISODate(h.date)).map(h => ({
      date: h.date, total: num(h.total), invested: num(h.invested), cash: num(h.cash),
      capital: num(h.capital), ret: Number.isFinite(h.ret) ? h.ret : num(h.ret, 0)
    })).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    // Cliente sem capital definido: assume custo das ações + caixa.
    if (!(c.capital > 0)) c.capital = round2(investedOf(c) + c.cash);
    return c;
  }
  function normalize(data) {
    const d = data && typeof data === 'object' ? data : emptyData();
    d.version = d.version || 1;
    d.updatedAt = d.updatedAt || new Date().toISOString();
    const q = {};
    Object.keys(d.quotes || {}).forEach(k => {
      const t = normTicker(k); const v = d.quotes[k];
      const price = typeof v === 'number' ? v : num(v && v.price, NaN);
      if (t && Number.isFinite(price)) q[t] = { price, at: (v && v.at) || d.updatedAt };
    });
    d.quotes = q;
    d.clients = (d.clients || []).map(normalizeClient);
    return d;
  }
  function touch(data) { data.updatedAt = new Date().toISOString(); return data; }

  function findClient(data, ref) {
    if (!ref) return null;
    const r = String(ref).trim().toLowerCase();
    return data.clients.find(c => c.id === ref) ||
      data.clients.find(c => c.name.toLowerCase() === r) ||
      data.clients.find(c => c.name.toLowerCase().startsWith(r)) || null;
  }

  // ---------- cálculo ----------
  function investedOf(client) {
    return client.positions.reduce((s, p) => s + p.qty * p.avgPrice, 0);
  }

  // Todas as ações que aparecem em pelo menos uma carteira, com agregados.
  function tickerSummary(data) {
    const map = {};
    data.clients.forEach(c => c.positions.forEach(p => {
      const e = map[p.ticker] || (map[p.ticker] = { ticker: p.ticker, clients: 0, qty: 0 });
      e.clients += 1; e.qty += p.qty;
    }));
    return Object.keys(map).sort().map(t => {
      const q = data.quotes[t];
      return Object.assign(map[t], { price: q ? q.price : null, at: q ? q.at : null });
    });
  }
  function tickers(data) { return tickerSummary(data).map(t => t.ticker); }
  function missingQuotes(data) { return tickerSummary(data).filter(t => t.price == null).map(t => t.ticker); }

  function computeClient(client, quotes) {
    quotes = quotes || {};
    const positions = client.positions.map(p => {
      const q = quotes[p.ticker];
      const hasQuote = !!q;
      const price = hasQuote ? q.price : p.avgPrice; // sem cotação: vale o custo (lucro zero) e sinaliza
      const invested = p.qty * p.avgPrice;
      const value = p.qty * price;
      const profit = value - invested;
      return {
        ticker: p.ticker, qty: p.qty, avgPrice: p.avgPrice, price, hasQuote,
        quoteAt: hasQuote ? q.at : null,
        value: round2(value), invested: round2(invested), profit: round2(profit),
        profitPct: invested > 0 ? profit / invested : 0
      };
    }).sort((a, b) => b.value - a.value);
    const invested = positions.reduce((s, p) => s + p.invested, 0);
    const stocks = positions.reduce((s, p) => s + p.value, 0);
    const cash = client.cash || 0;
    const total = stocks + cash;
    const profit = stocks - invested;
    const capital = client.capital > 0 ? client.capital : (invested + cash);
    const ret = capital > 0 ? total / capital - 1 : 0;
    const bb = client.bonusBase;
    const vsBonus = bb && bb.value > 0 ? total / bb.value - 1 : null;
    return {
      id: client.id, name: client.name, positions,
      invested: round2(invested), stocks: round2(stocks), cash: round2(cash),
      total: round2(total), profit: round2(profit),
      profitPct: invested > 0 ? profit / invested : 0,
      capital: round2(capital), ret, bonusBase: bb, vsBonus,
      missingQuotes: positions.filter(p => !p.hasQuote).map(p => p.ticker)
    };
  }
  function computeAll(data) { return data.clients.map(c => computeClient(c, data.quotes)); }

  // ---------- cotações e histórico ----------
  function setQuotes(data, map, at) {
    at = at || new Date().toISOString();
    let n = 0;
    Object.keys(map || {}).forEach(k => {
      const t = normTicker(k); const price = num(map[k], NaN);
      if (!t || !Number.isFinite(price) || price < 0) return;
      data.quotes[t] = { price: round2(price), at }; n++;
    });
    touch(data);
    return n;
  }
  // Remove cotações de ações que não estão em nenhuma carteira.
  function pruneQuotes(data) {
    const keep = new Set(tickers(data));
    Object.keys(data.quotes).forEach(t => { if (!keep.has(t)) delete data.quotes[t]; });
    return data;
  }
  function upsertHistory(client, point) {
    const i = client.history.findIndex(h => h.date === point.date);
    if (i >= 0) client.history[i] = point; else client.history.push(point);
    client.history.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return point;
  }
  // Um ponto novo no gráfico de cada cliente (um por data; a mesma data substitui).
  function snapshotAll(data, date) {
    date = isISODate(date) ? date : localDateISO();
    data.clients.forEach(c => {
      const r = computeClient(c, data.quotes);
      upsertHistory(c, { date, total: r.total, invested: r.invested, cash: r.cash, capital: r.capital, ret: r.ret });
    });
    touch(data);
    return date;
  }
  function snapshotClient(data, client, date) {
    date = isISODate(date) ? date : localDateISO();
    const r = computeClient(client, data.quotes);
    const p = upsertHistory(client, { date, total: r.total, invested: r.invested, cash: r.cash, capital: r.capital, ret: r.ret });
    touch(data);
    return p;
  }

  // ---------- operações ----------
  const TX_TYPES = { buy: 'Compra', sell: 'Venda', deposit: 'Aporte', withdraw: 'Retirada', bonus: 'Bônus (nova base)' };

  function findPosition(client, ticker) { return client.positions.find(p => p.ticker === ticker) || null; }

  // Aplica uma operação e a registra. Lança Error com mensagem legível se inválida.
  // tx: { type, date, ticker, qty, price, value, note }
  function applyTransaction(data, client, tx) {
    const type = tx.type;
    if (!TX_TYPES[type]) throw new Error('Tipo de operação inválido: ' + type);
    const date = isISODate(tx.date) ? tx.date : localDateISO();
    const rec = { id: uid('t'), date, type, note: String(tx.note || '').trim(), prev: {} };
    const prevCash = client.cash;

    if (type === 'buy' || type === 'sell') {
      const ticker = normTicker(tx.ticker);
      const qty = num(tx.qty, NaN), price = num(tx.price, NaN);
      if (!ticker) throw new Error('Informe o código da ação.');
      if (!(qty > 0)) throw new Error('Quantidade deve ser maior que zero.');
      if (!(price >= 0)) throw new Error('Preço inválido.');
      rec.ticker = ticker; rec.qty = qty; rec.price = round2(price); rec.value = round2(qty * price);
      const pos = findPosition(client, ticker);
      rec.prev = { qty: pos ? pos.qty : 0, avgPrice: pos ? pos.avgPrice : 0, cash: prevCash };
      if (type === 'buy') {
        if (pos) {
          pos.avgPrice = (pos.qty * pos.avgPrice + qty * price) / (pos.qty + qty);
          pos.qty += qty;
        } else client.positions.push({ ticker, qty, avgPrice: price });
        client.cash = round2(client.cash - qty * price);
        if (!(data.quotes[ticker])) data.quotes[ticker] = { price: round2(price), at: new Date().toISOString() };
      } else {
        if (!pos) throw new Error(client.name + ' não possui ' + ticker + '.');
        if (qty > pos.qty + 1e-9) throw new Error('Quantidade maior que a posição (' + pos.qty + ').');
        rec.avgPrice = round2(pos.avgPrice);
        rec.result = round2((price - pos.avgPrice) * qty);
        rec.resultPct = pos.avgPrice > 0 ? price / pos.avgPrice - 1 : 0;
        pos.qty -= qty;
        if (pos.qty <= 1e-9) client.positions = client.positions.filter(p => p !== pos);
        client.cash = round2(client.cash + qty * price);
      }
    } else if (type === 'deposit' || type === 'withdraw') {
      const value = num(tx.value, NaN);
      if (!(value > 0)) throw new Error('Valor deve ser maior que zero.');
      rec.value = round2(value);
      rec.prev = { cash: prevCash, capital: client.capital };
      const sign = type === 'deposit' ? 1 : -1;
      client.cash = round2(client.cash + sign * value);
      client.capital = round2(client.capital + sign * value);
    } else if (type === 'bonus') {
      const r = computeClient(client, data.quotes);
      const value = Number.isFinite(num(tx.value, NaN)) && num(tx.value) > 0 ? num(tx.value) : r.total;
      rec.value = round2(value);
      rec.prev = { bonusBase: client.bonusBase ? Object.assign({}, client.bonusBase) : null };
      client.bonusBase = { value: round2(value), date };
    }
    client.transactions.push(rec);
    touch(data);
    return rec;
  }

  function isLastTransaction(client, txId) {
    const t = client.transactions;
    return t.length > 0 && t[t.length - 1].id === txId;
  }

  // Remove do registro; se revert=true (só permitido para a última operação), desfaz os efeitos.
  function removeTransaction(data, client, txId, revert) {
    const i = client.transactions.findIndex(t => t.id === txId);
    if (i < 0) throw new Error('Operação não encontrada.');
    const rec = client.transactions[i];
    if (revert) {
      if (i !== client.transactions.length - 1) throw new Error('Só a última operação pode ser desfeita.');
      const prev = rec.prev || {};
      if (rec.type === 'buy' || rec.type === 'sell') {
        client.positions = client.positions.filter(p => p.ticker !== rec.ticker);
        if (prev.qty > 0) client.positions.push({ ticker: rec.ticker, qty: prev.qty, avgPrice: prev.avgPrice });
        if (Number.isFinite(prev.cash)) client.cash = prev.cash;
      } else if (rec.type === 'deposit' || rec.type === 'withdraw') {
        if (Number.isFinite(prev.cash)) client.cash = prev.cash;
        if (Number.isFinite(prev.capital)) client.capital = prev.capital;
      } else if (rec.type === 'bonus') {
        client.bonusBase = prev.bonusBase || null;
      }
    }
    client.transactions.splice(i, 1);
    touch(data);
    return rec;
  }

  // ---------- edição direta ----------
  // Enquanto o cliente ainda não tem operações registradas (fase de cadastro), o capital
  // aportado acompanha automaticamente investido + caixa. Depois disso, só muda com
  // aporte/retirada ou edição explícita.
  function autoCapital(client) {
    if (!client.transactions.length) client.capital = round2(investedOf(client) + (client.cash || 0));
    return client.capital;
  }
  function setPosition(data, client, ticker, qty, avgPrice) {
    ticker = normTicker(ticker); qty = num(qty, NaN); avgPrice = num(avgPrice, NaN);
    if (!ticker) throw new Error('Informe o código da ação.');
    if (!(qty >= 0)) throw new Error('Quantidade inválida.');
    if (!(avgPrice >= 0)) throw new Error('Preço médio inválido.');
    const pos = findPosition(client, ticker);
    if (qty === 0) { client.positions = client.positions.filter(p => p.ticker !== ticker); }
    else if (pos) { pos.qty = qty; pos.avgPrice = avgPrice; }
    else client.positions.push({ ticker, qty, avgPrice });
    autoCapital(client);
    touch(data);
    return findPosition(client, ticker);
  }
  function removePosition(data, client, ticker) {
    ticker = normTicker(ticker);
    client.positions = client.positions.filter(p => p.ticker !== ticker);
    autoCapital(client);
    touch(data);
  }
  function addClient(data, name) {
    const c = newClient(name);
    data.clients.push(c);
    touch(data);
    return c;
  }
  function removeClient(data, id) {
    data.clients = data.clients.filter(c => c.id !== id);
    touch(data);
  }
  function updateClient(data, client, fields) {
    if (fields.name != null) client.name = String(fields.name).trim() || client.name;
    if (fields.cash != null) client.cash = round2(num(fields.cash, client.cash));
    if (fields.capital != null && num(fields.capital, NaN) !== client.capital) client.capital = round2(num(fields.capital, client.capital));
    else if (fields.cash != null) autoCapital(client);
    if (fields.bonusBase !== undefined) {
      const b = fields.bonusBase;
      client.bonusBase = b && num(b.value, NaN) > 0 ? { value: round2(num(b.value)), date: b.date || null } : null;
    }
    touch(data);
    return client;
  }

  // Resumo em texto (usado pelo CLI e útil para depurar).
  function summaryText(data) {
    const lines = [];
    lines.push('Atualizado em: ' + fmtDateTime(data.updatedAt));
    lines.push('Cotações (' + tickerSummary(data).length + ' ações em carteira):');
    tickerSummary(data).forEach(t => lines.push('  ' + t.ticker.padEnd(7) + (t.price == null ? 'SEM COTAÇÃO' : fmtNum(t.price).padStart(10)) + '  (' + t.clients + ' cliente' + (t.clients === 1 ? '' : 's') + ', ' + fmtInt(t.qty) + ' cotas)'));
    computeAll(data).forEach(r => {
      lines.push('');
      lines.push(r.name + ' [' + r.id + ']');
      lines.push('  Patrimônio ' + fmtBRL(r.total) + ' | Caixa ' + fmtBRL(r.cash) + ' | Investido ' + fmtBRL(r.invested) + ' | Lucro ' + fmtSignedBRL(r.profit) + ' | Rentab. ' + fmtPct(r.ret) + (r.bonusBase ? ' | Base bônus ' + fmtBRL(r.bonusBase.value) + ' (' + fmtDate(r.bonusBase.date) + ') ' + fmtPct(r.vsBonus) : ' | sem base de bônus'));
      r.positions.forEach(p => lines.push('  ' + p.ticker.padEnd(7) + String(p.qty).padStart(7) + '  ' + fmtBRL(p.value).padStart(16) + '  ' + fmtBRL(p.invested).padStart(16) + '  ' + fmtSignedBRL(p.profit).padStart(17) + (p.hasQuote ? '' : '  (sem cotação)')));
      lines.push('  Histórico: ' + r.positions.length + ' posições, ' + (data.clients.find(c => c.id === r.id).history.length) + ' pontos');
    });
    return lines.join('\n');
  }

  return {
    round2, num, parseNum, localDateISO, uid, normTicker, isISODate,
    fmtBRL, fmtNum, fmtInt, fmtSignedBRL, fmtPct, fmtDate, fmtDateTime,
    emptyData, newClient, normalize, touch, findClient,
    investedOf, tickerSummary, tickers, missingQuotes, computeClient, computeAll,
    setQuotes, pruneQuotes, snapshotAll, snapshotClient, upsertHistory,
    TX_TYPES, applyTransaction, isLastTransaction, removeTransaction,
    autoCapital, setPosition, removePosition, addClient, removeClient, updateClient,
    summaryText
  };
});
