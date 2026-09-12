#!/usr/bin/env node
/*
 * CLI do Orihuela Consulting — atualiza orihuela/data.json usando o mesmo core.js do app.
 * É a ferramenta usada pelo Claude quando recebe prints de cotações ou operações.
 *
 * Uso (na raiz do repositório):
 *   node orihuela/tools/cli.js show
 *   node orihuela/tools/cli.js quotes PETR4=38,12 VALE3=61,30 [--date 2026-09-12] [--no-snapshot]
 *   node orihuela/tools/cli.js snapshot [--date 2026-09-12]
 *   node orihuela/tools/cli.js client add "Apelido" [--cash 0] [--bonus 36000 --bonus-date 2026-06-30]
 *   node orihuela/tools/cli.js client edit "Apelido" [--name "Novo"] [--cash X] [--capital X] [--bonus X] [--bonus-date D]
 *   node orihuela/tools/cli.js client remove "Apelido"
 *   node orihuela/tools/cli.js position set "Apelido" PETR4 200 31,40
 *   node orihuela/tools/cli.js position remove "Apelido" PETR4
 *   node orihuela/tools/cli.js tx "Apelido" buy PETR4 100 30,50 [--date D] [--note "..."]
 *   node orihuela/tools/cli.js tx "Apelido" sell PETR4 100 40,00 [--date D]
 *   node orihuela/tools/cli.js tx "Apelido" short BOVA11 100 160,00 [--date D]   (venda a descoberto / aluguel tomador)
 *   node orihuela/tools/cli.js tx "Apelido" buy BOVA11 100 150,00                (em posição vendida = recompra, com resultado)
 *   node orihuela/tools/cli.js position set "Apelido" BOVA11 -182 110,40         (quantidade negativa = posição vendida)
 *   node orihuela/tools/cli.js tx "Apelido" deposit 1000 [--date D]
 *   node orihuela/tools/cli.js tx "Apelido" withdraw 1000 [--date D]
 *   node orihuela/tools/cli.js tx "Apelido" bonus [valor] [--date D]
 *   node orihuela/tools/cli.js tx "Apelido" undo            (desfaz a última operação)
 *   node orihuela/tools/cli.js point "Apelido" 2026-06-30 36000 [--ret 5,2]
 *   node orihuela/tools/cli.js point remove "Apelido" 2026-06-30
 *   node orihuela/tools/cli.js validate
 *
 * Opção global: --file caminho/para/data.json (padrão: orihuela/data.json ao lado deste script).
 * Números aceitam vírgula ou ponto decimal ("38,12" ou "38.12"); "1.234,56" também funciona.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

const argv = process.argv.slice(2);
const opts = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (key === 'no-snapshot') opts.snapshot = false;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
    else opts[key] = true;
  } else args.push(a);
}
const FILE = path.resolve(opts.file || path.join(__dirname, '..', 'data.json'));

function loadData() {
  if (!fs.existsSync(FILE)) return C.emptyData();
  return C.normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
}
function saveData(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n');
}
function fail(msg) { console.error('Erro: ' + msg); process.exit(1); }
function needNum(v, what) { const n = C.parseNum(v); if (!Number.isFinite(n)) fail(what + ' inválido: ' + v); return n; }
function getClient(d, ref) {
  const c = C.findClient(d, ref);
  if (!c) fail('cliente não encontrado: "' + ref + '". Clientes: ' + d.clients.map(x => x.name).join(', '));
  return c;
}
function dateOpt() {
  if (!opts.date) return C.localDateISO();
  if (!C.isISODate(opts.date)) fail('data deve ser AAAA-MM-DD: ' + opts.date);
  return opts.date;
}

const cmd = args[0];
const d = loadData();

switch (cmd) {
  case 'show': {
    console.log(C.summaryText(d));
    break;
  }
  case 'validate': {
    const problems = [];
    const missing = C.missingQuotes(d);
    if (missing.length) problems.push('Ações sem cotação: ' + missing.join(', '));
    d.clients.forEach(c => {
      if (!(c.capital > 0) && (c.positions.length || c.cash)) problems.push(c.name + ': capital aportado não definido');
      if (!c.bonusBase) problems.push(c.name + ': sem base de bônus');
      if (c.cash < 0) problems.push(c.name + ': caixa negativo (' + C.fmtBRL(c.cash) + ')');
    });
    const names = d.clients.map(c => c.name.toLowerCase());
    names.forEach((n, i) => { if (names.indexOf(n) !== i) problems.push('Nome repetido: ' + d.clients[i].name); });
    if (!problems.length) console.log('OK: nenhum problema encontrado.');
    else { console.log('Avisos:'); problems.forEach(p => console.log('  - ' + p)); }
    break;
  }
  case 'quotes': {
    const map = {};
    args.slice(1).forEach(pair => {
      const m = pair.match(/^([A-Za-z0-9]+)=(.+)$/);
      if (!m) fail('formato esperado TICKER=PREÇO, recebido: ' + pair);
      map[C.normTicker(m[1])] = needNum(m[2], 'preço de ' + m[1]);
    });
    if (!Object.keys(map).length) fail('informe pelo menos uma cotação (ex.: PETR4=38,12)');
    const known = new Set(C.tickers(d));
    const unknown = Object.keys(map).filter(t => !known.has(t));
    if (unknown.length) console.log('Aviso: ' + unknown.join(', ') + ' não está em nenhuma carteira (cotação salva mesmo assim).');
    const date = dateOpt();
    const at = date === C.localDateISO() ? new Date().toISOString() : new Date(date + 'T18:00:00').toISOString();
    const n = C.setQuotes(d, map, at);
    let msg = n + ' cotações atualizadas.';
    if (opts.snapshot !== false) { C.snapshotAll(d, date); msg += ' Ponto de ' + C.fmtDate(date) + ' registrado para ' + d.clients.length + ' cliente(s).'; }
    const still = C.missingQuotes(d);
    if (still.length) msg += ' AINDA SEM COTAÇÃO: ' + still.join(', ');
    saveData(d);
    console.log(msg);
    break;
  }
  case 'snapshot': {
    const date = dateOpt();
    C.snapshotAll(d, date);
    saveData(d);
    console.log('Ponto de ' + C.fmtDate(date) + ' registrado para ' + d.clients.length + ' cliente(s).');
    break;
  }
  case 'client': {
    const sub = args[1];
    if (sub === 'add') {
      const name = args[2]; if (!name) fail('informe o nome');
      if (C.findClient(d, name) && C.findClient(d, name).name.toLowerCase() === name.toLowerCase()) fail('já existe um cliente chamado ' + name);
      const c = C.addClient(d, name);
      if (opts.cash != null) c.cash = C.round2(needNum(opts.cash, 'caixa'));
      if (opts.capital != null) c.capital = C.round2(needNum(opts.capital, 'capital'));
      if (opts.bonus != null) c.bonusBase = { value: C.round2(needNum(opts.bonus, 'bônus')), date: opts['bonus-date'] || null };
      if (opts.capital == null) C.autoCapital(c);
      saveData(d);
      console.log('Cliente criado: ' + c.name + ' [' + c.id + ']');
    } else if (sub === 'edit') {
      const c = getClient(d, args[2]);
      const fields = {};
      if (opts.name != null) fields.name = opts.name;
      if (opts.cash != null) fields.cash = needNum(opts.cash, 'caixa');
      if (opts.capital != null) fields.capital = needNum(opts.capital, 'capital');
      if (opts.bonus != null) fields.bonusBase = { value: needNum(opts.bonus, 'bônus'), date: opts['bonus-date'] || (c.bonusBase && c.bonusBase.date) || null };
      else if (opts['bonus-date'] != null && c.bonusBase) fields.bonusBase = { value: c.bonusBase.value, date: opts['bonus-date'] };
      C.updateClient(d, c, fields);
      saveData(d);
      console.log('Cliente atualizado: ' + c.name);
    } else if (sub === 'remove') {
      const c = getClient(d, args[2]);
      C.removeClient(d, c.id);
      saveData(d);
      console.log('Cliente removido: ' + c.name);
    } else fail('use: client add|edit|remove');
    break;
  }
  case 'position': {
    const sub = args[1];
    const c = getClient(d, args[2]);
    if (sub === 'set') {
      const ticker = args[3], qty = needNum(args[4], 'quantidade'), avg = needNum(args[5], 'preço médio');
      C.setPosition(d, c, ticker, qty, avg);
      saveData(d);
      console.log(c.name + ': ' + C.normTicker(ticker) + ' = ' + qty + ' cotas a PM ' + C.fmtNum(avg) + (d.quotes[C.normTicker(ticker)] ? '' : '  (sem cotação ainda: use "quotes ' + C.normTicker(ticker) + '=…")'));
    } else if (sub === 'remove') {
      C.removePosition(d, c, args[3]);
      saveData(d);
      console.log(c.name + ': ' + C.normTicker(args[3]) + ' removida.');
    } else fail('use: position set|remove');
    break;
  }
  case 'tx': {
    const c = getClient(d, args[1]);
    const type = args[2];
    if (type === 'undo') {
      const last = c.transactions[c.transactions.length - 1];
      if (!last) fail('não há operações para desfazer');
      C.removeTransaction(d, c, last.id, true);
      saveData(d);
      console.log('Desfeita: ' + C.TX_TYPES[last.type] + (last.ticker ? ' ' + last.ticker : '') + ' de ' + C.fmtDate(last.date));
      break;
    }
    const tx = { type, date: dateOpt(), note: opts.note || '' };
    if (C.TRADE_TYPES[type]) {
      tx.ticker = args[3]; tx.qty = needNum(args[4], 'quantidade'); tx.price = needNum(args[5], 'preço');
    } else if (type === 'deposit' || type === 'withdraw') {
      tx.value = needNum(args[3], 'valor');
    } else if (type === 'bonus') {
      if (args[3] != null) tx.value = needNum(args[3], 'valor');
    } else fail('tipo deve ser buy|sell|short|deposit|withdraw|bonus|undo');
    let rec;
    try { rec = C.applyTransaction(d, c, tx); } catch (e) { fail(e.message); }
    saveData(d);
    let msg = c.name + ': ' + C.TX_TYPES[rec.type] + (rec.ticker ? ' ' + rec.ticker + ' ' + C.fmtInt(rec.qty) + ' × ' + C.fmtNum(rec.price) : '') + ' = ' + C.fmtBRL(rec.value) + ' em ' + C.fmtDate(rec.date) + '.';
    if (rec.result != null) msg += ' Resultado da ' + (rec.cover ? 'recompra' : 'venda') + ': ' + C.fmtSignedBRL(rec.result) + ' (' + C.fmtPct(rec.resultPct) + ', PM ' + C.fmtNum(rec.avgPrice) + ').';
    msg += ' Caixa agora: ' + C.fmtBRL(c.cash) + '.';
    console.log(msg);
    break;
  }
  case 'point': {
    if (args[1] === 'remove') {
      const c = getClient(d, args[2]);
      const date = args[3]; if (!C.isISODate(date)) fail('data deve ser AAAA-MM-DD');
      const before = c.history.length;
      c.history = c.history.filter(h => h.date !== date);
      if (c.history.length === before) fail(c.name + ' não tem ponto em ' + C.fmtDate(date));
      C.touch(d); saveData(d);
      console.log(c.name + ': ponto de ' + C.fmtDate(date) + ' removido.');
      break;
    }
    const c = getClient(d, args[1]);
    const date = args[2]; if (!C.isISODate(date)) fail('data deve ser AAAA-MM-DD');
    const total = needNum(args[3], 'patrimônio');
    const ret = opts.ret != null ? needNum(opts.ret, 'rentabilidade') / 100 : (c.capital > 0 ? total / c.capital - 1 : 0);
    C.upsertHistory(c, { date, total: C.round2(total), invested: 0, cash: 0, capital: c.capital, ret });
    C.touch(d);
    saveData(d);
    console.log(c.name + ': ponto ' + C.fmtDate(date) + ' = ' + C.fmtBRL(total) + ' (' + C.fmtPct(ret) + ')');
    break;
  }
  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith(' *') && l.trim() !== '*/').map(l => l.replace(/^ \*\s?/, '')).join('\n'));
    if (cmd) process.exit(1);
}
