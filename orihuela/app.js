/* Orihuela Consulting — interface (PWA). Depende de core.js (OrihuelaCore). */
(function () {
  'use strict';
  const C = window.OrihuelaCore;
  const APP_VERSION = '1.0.0';
  const LS = { state: 'orihuela.state', pin: 'orihuela.pin', gh: 'orihuela.gh', ui: 'orihuela.ui' };
  const DEFAULT_GH = { owner: 'rdleonel', repo: 'rdleonel.github.io', branch: 'main', path: 'orihuela/data.json', token: '' };
  const LOCK_AFTER_MS = 2 * 60 * 1000;

  // ---------- armazenamento ----------
  function load(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem espaço ou modo privado */ } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { } }

  let state = load(LS.state) || { data: null, baseUpdatedAt: null, dirty: false, sha: null, lastSync: null };
  if (state.data) state.data = C.normalize(state.data);
  let gh = Object.assign({}, DEFAULT_GH, load(LS.gh) || {});
  let ui = Object.assign({ chart: { total: true, ret: true }, perfSort: 'name' }, load(LS.ui) || {});
  let pendingRemote = null;   // versão do servidor que conflita com edições locais
  let syncStatus = 'idle';    // idle | syncing | offline | error | ok
  let syncError = '';
  function persist() { save(LS.state, state); }
  function persistUI() { save(LS.ui, ui); }

  // ---------- DOM ----------
  const $ = s => document.querySelector(s);
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // só com strings fixas do código
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style') el.style.cssText = v;
      else if (k in el && k !== 'list' && typeof v !== 'object') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
      else el.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(c => append(el, c));
    else if (typeof child === 'string' || typeof child === 'number') el.appendChild(document.createTextNode(String(child)));
    else el.appendChild(child);
  }
  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function signCls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }
  function toast(msg, isErr) {
    const root = $('#toast-root');
    root.innerHTML = '';
    const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg });
    root.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, isErr ? 4000 : 2600);
  }

  // ---------- rotas ----------
  function route() {
    const p = location.hash.replace(/^#\/?/, '').split('/');
    return { name: p[0] || 'home', id: p[1] ? decodeURIComponent(p[1]) : null };
  }
  function go(hash) { location.hash = hash; }
  window.addEventListener('hashchange', render);
  $('#btn-back').addEventListener('click', () => {
    const r = route();
    if (r.name === 'client') go('#/clients'); else go('#/');
  });
  $('#btn-gear').addEventListener('click', () => go('#/settings'));

  function setHeader(title, hasBack) {
    $('#title').textContent = title;
    $('#header').classList.toggle('has-back', !!hasBack);
    $('#btn-gear').classList.toggle('dirty', !!state.dirty);
  }

  // ---------- mutações ----------
  // Toda alteração local passa por aqui: marca como pendente, salva e (se configurado) envia ao GitHub.
  function mutate(fn) {
    let result;
    try { result = fn(state.data); }
    catch (e) { throw e; }
    state.dirty = true;
    persist();
    render();
    schedulePush();
    return result;
  }

  // ---------- render ----------
  function render() {
    if (!state.data) { setHeader('Orihuela Consulting', false); renderLoading(); return; }
    const r = route();
    const view = $('#view');
    view.innerHTML = '';
    const banner = renderBanner();
    if (banner) view.appendChild(banner);
    switch (r.name) {
      case 'quotes': setHeader('Cotações', true); viewQuotes(view); break;
      case 'clients': setHeader('Clientes', true); viewClients(view); break;
      case 'client': {
        const c = state.data.clients.find(x => x.id === r.id);
        if (!c) { go('#/clients'); return; }
        setHeader(c.name, true); viewClient(view, c); break;
      }
      case 'performance': setHeader('Desempenho', true); viewPerformance(view); break;
      case 'settings': setHeader('Configurações', true); viewSettings(view); break;
      default: setHeader('Orihuela Consulting', false); viewHome(view);
    }
    window.scrollTo(0, 0);
  }
  function renderLoading() {
    const view = $('#view');
    view.innerHTML = '';
    view.appendChild(h('div', { class: 'card' },
      h('p', { text: syncStatus === 'offline' || syncStatus === 'error'
        ? 'Não foi possível carregar os dados. Verifique a conexão e tente novamente.'
        : 'Carregando dados...' }),
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { class: 'btn primary', text: 'Tentar novamente', onClick: () => syncFromRemote({ force: true }) }),
        h('button', { class: 'btn', text: 'Começar vazio', onClick: () => { adopt(C.emptyData(), null); state.dirty = true; persist(); render(); } }))));
  }
  function renderBanner() {
    if (pendingRemote) {
      return h('div', { class: 'banner' },
        h('p', { text: 'Há dados mais novos no servidor (' + C.fmtDateTime(pendingRemote.data.updatedAt) + '), mas você tem edições locais ainda não enviadas. O que fazer?' }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', text: 'Usar os do servidor', onClick: async () => {
            if (await confirmDialog('Descartar as edições locais e usar os dados do servidor?')) { adopt(pendingRemote.data, pendingRemote.sha); toast('Dados do servidor carregados.'); }
          } }),
          h('button', { class: 'btn primary', text: 'Manter os meus', onClick: async () => {
            if (gh.token) {
              try { await pushToRemote({ force: true }); toast('Suas edições foram enviadas.'); }
              catch (e) { toast('Falha ao enviar: ' + e.message, true); }
            } else { pendingRemote = null; render(); toast('Mantidas as edições locais. Exporte em Configurações para enviar.'); }
          } })));
    }
    return null;
  }

  // ---------- HOME ----------
  function viewHome(view) {
    const d = state.data;
    const all = C.computeAll(d);
    const aum = all.reduce((s, r) => s + r.total, 0);
    const ts = C.tickerSummary(d);
    const lastQuote = Object.keys(d.quotes).map(k => d.quotes[k].at).sort().pop();
    const missing = C.missingQuotes(d);

    view.appendChild(h('div', { class: 'brand' },
      h('div', { class: 'name' }, 'Orihuela ', h('span', { text: 'Consulting' })),
      h('div', { class: 'sub', text: 'Gestão de carteiras · XP' })));

    view.appendChild(h('div', { class: 'nav-grid' },
      navCard('📈', 'Cotações', ts.length + (ts.length === 1 ? ' ação' : ' ações') + (lastQuote ? ' · ' + C.fmtDate(lastQuote) : ''), '#/quotes'),
      navCard('👥', 'Clientes', d.clients.length + (d.clients.length === 1 ? ' carteira' : ' carteiras'), '#/clients'),
      navCard('🏁', 'Desempenho', 'Todos lado a lado', '#/performance')));

    view.appendChild(h('div', { class: 'card' },
      h('div', { class: 'hero' },
        h('div', { class: 'label', text: 'Patrimônio sob gestão' }),
        h('div', { class: 'value num', text: C.fmtBRL(aum) })),
      h('div', { class: 'status-line' },
        h('span', {}, 'Cotações de ', h('b', { text: lastQuote ? C.fmtDateTime(lastQuote) : '—' })),
        h('span', {}, 'Dados de ', h('b', { text: C.fmtDateTime(d.updatedAt) })))));

    if (missing.length) view.appendChild(h('div', { class: 'banner' },
      h('p', { text: (missing.length === 1 ? 'Ação sem cotação: ' : 'Ações sem cotação: ') + missing.join(', ') + '. Enquanto isso valem pelo preço médio.' }),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn sm', text: 'Informar cotações', onClick: () => go('#/quotes') }))));

    view.appendChild(syncCard());
  }
  function navCard(icon, title, desc, hash) {
    return h('button', { class: 'nav-card', onClick: () => go(hash) },
      h('div', { class: 'ico', text: icon }),
      h('div', {}, h('div', { class: 'ttl', text: title }), h('div', { class: 'desc', text: desc })),
      h('div', { class: 'chev', text: '›' }));
  }
  function syncCard() {
    const online = navigator.onLine;
    const lines = [];
    lines.push(h('span', {}, online ? 'Online' : 'Sem conexão (mostrando a última versão salva)'));
    lines.push(h('span', {}, 'Última sincronização: ', h('b', { text: state.lastSync ? C.fmtDateTime(state.lastSync) : 'nunca' })));
    if (state.dirty) lines.push(h('span', { class: 'pos' }, gh.token ? 'Edições locais aguardando envio' : 'Edições locais não enviadas ao servidor'));
    if (syncStatus === 'error' && syncError) lines.push(h('span', { class: 'neg', text: syncError }));
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { text: 'Sincronização' }),
        h('button', { class: 'btn sm', text: syncStatus === 'syncing' ? 'Sincronizando…' : 'Sincronizar', disabled: syncStatus === 'syncing', onClick: () => fullSync() })),
      h('div', { class: 'status-line', style: 'flex-direction:column;gap:4px' }, lines));
  }

  // ---------- COTAÇÕES ----------
  let quotesEditing = false;
  function viewQuotes(view) {
    const d = state.data;
    const ts = C.tickerSummary(d);
    if (!ts.length) {
      view.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty', text: 'Nenhuma ação nas carteiras ainda. Adicione posições em um cliente.' })));
      return;
    }
    if (!quotesEditing) {
      view.appendChild(h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', text: 'Atualizar todas as cotações', onClick: () => { quotesEditing = true; render(); } })));
      const list = h('div', { class: 'card tight' });
      ts.forEach(t => {
        list.appendChild(h('button', { class: 'quote-row', style: 'width:100%;text-align:left', onClick: () => editSingleQuote(t.ticker) },
          h('div', { class: 'tk' }, t.ticker, h('small', { text: t.clients + (t.clients === 1 ? ' cliente' : ' clientes') + ' · ' + C.fmtInt(t.qty) + ' cotas' })),
          h('div', { class: 'price' },
            h('div', { class: 'v', text: t.price == null ? 'sem cotação' : C.fmtBRL(t.price) }),
            h('div', { class: 'd', text: t.at ? C.fmtDateTime(t.at) : 'toque para informar' }))));
      });
      view.appendChild(list);
      view.appendChild(h('p', { class: 'small muted', text: 'Lista de todas as ações presentes em pelo menos uma carteira. Toque em uma linha para corrigir uma cotação isolada; use o botão acima para a atualização completa, que registra um ponto novo no gráfico de cada cliente.' }));
      return;
    }
    // modo de edição em lote
    const inputs = {};
    const list = h('div', { class: 'card tight' });
    ts.forEach(t => {
      const inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: t.price == null ? '' : C.fmtNum(t.price) });
      inp.addEventListener('focus', () => inp.select());
      inputs[t.ticker] = inp;
      list.appendChild(h('div', { class: 'quote-row' },
        h('div', { class: 'tk' }, t.ticker, h('small', { text: t.price == null ? 'sem cotação' : 'antes ' + C.fmtNum(t.price) })),
        inp));
    });
    view.appendChild(list);
    const dateInp = h('input', { type: 'date', value: C.localDateISO() });
    const snapChk = h('input', { type: 'checkbox', checked: true });
    const err = h('div', { class: 'form-error' });
    view.appendChild(h('div', { class: 'sticky-bar' },
      h('div', { class: 'field inline', style: 'margin-bottom:8px' }, snapChk, h('label', { text: 'Registrar ponto no histórico de cada cliente' })),
      h('div', { class: 'row', style: 'margin-bottom:8px' }, h('label', { class: 'small dim', text: 'Data do ponto' }), dateInp),
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn', style: 'flex:1', text: 'Cancelar', onClick: () => { quotesEditing = false; render(); } }),
        h('button', { class: 'btn primary', style: 'flex:2', text: 'Salvar cotações', onClick: () => {
          const map = {}; const bad = [];
          Object.keys(inputs).forEach(t => {
            const raw = inputs[t].value.trim();
            if (!raw) return;
            const n = C.parseNum(raw);
            if (!Number.isFinite(n) || n < 0) bad.push(t); else map[t] = n;
          });
          if (bad.length) { err.textContent = 'Valor inválido em: ' + bad.join(', '); return; }
          if (!Object.keys(map).length) { err.textContent = 'Nenhuma cotação informada.'; return; }
          const date = dateInp.value;
          mutate(data => {
            C.setQuotes(data, map, C.isISODate(date) && date !== C.localDateISO() ? new Date(date + 'T12:00:00').toISOString() : new Date().toISOString());
            if (snapChk.checked) C.snapshotAll(data, date);
          });
          quotesEditing = false;
          toast(Object.keys(map).length + ' cotações salvas' + (snapChk.checked ? ' e ponto registrado.' : '.'));
          render();
        } }))));
  }
  function editSingleQuote(ticker) {
    const q = state.data.quotes[ticker];
    openForm({
      title: 'Cotação de ' + ticker,
      fields: [
        { key: 'price', label: 'Última cotação (R$)', type: 'decimal', value: q ? C.fmtNum(q.price) : '' },
        { key: 'snap', label: 'Registrar ponto no histórico (hoje)', type: 'checkbox', value: false }
      ],
      submitLabel: 'Salvar',
      onSubmit: v => {
        const n = C.parseNum(v.price);
        if (!Number.isFinite(n) || n < 0) throw new Error('Cotação inválida.');
        mutate(data => { const m = {}; m[ticker] = n; C.setQuotes(data, m); if (v.snap) C.snapshotAll(data); });
        toast(ticker + ' atualizada.');
      }
    });
  }

  // ---------- CLIENTES ----------
  function viewClients(view) {
    const d = state.data;
    view.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', text: '+ Novo cliente', onClick: () => addClientDialog() })));
    if (!d.clients.length) {
      view.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty', text: 'Nenhum cliente ainda. Toque em "Novo cliente".' })));
      return;
    }
    const all = C.computeAll(d).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    let filter = '';
    const list = h('div', { class: 'card tight' });
    function fill() {
      list.innerHTML = '';
      const f = filter.trim().toLowerCase();
      const rows = all.filter(r => !f || r.name.toLowerCase().includes(f));
      if (!rows.length) list.appendChild(h('div', { class: 'empty', text: 'Nenhum cliente encontrado.' }));
      rows.forEach(r => list.appendChild(h('button', { class: 'list-item', onClick: () => go('#/client/' + encodeURIComponent(r.id)) },
        h('div', { class: 'main' },
          h('div', { class: 't1', text: r.name }),
          h('div', { class: 't2', text: r.positions.length + (r.positions.length === 1 ? ' ação' : ' ações') + ' · caixa ' + C.fmtBRL(r.cash) })),
        h('div', { class: 'right' },
          h('div', { class: 'v1 num', text: C.fmtBRL(r.total) }),
          h('div', { class: 'v2 num ' + signCls(r.vsBonus), text: r.vsBonus == null ? 'sem base de bônus' : C.fmtPct(r.vsBonus) + ' vs. bônus' })),
        h('div', { class: 'chev', text: '›' }))));
    }
    if (all.length > 6) {
      const s = h('input', { type: 'search', placeholder: 'Buscar cliente…', style: 'margin-bottom:12px' });
      s.addEventListener('input', () => { filter = s.value; fill(); });
      view.appendChild(s);
    }
    fill();
    view.appendChild(list);
  }
  function addClientDialog() {
    openForm({
      title: 'Novo cliente',
      fields: [
        { key: 'name', label: 'Nome ou apelido', type: 'text', value: '', placeholder: 'Ex.: JR' },
        { key: 'cash', label: 'Saldo em caixa (R$)', type: 'decimal', value: '0,00' },
        { key: 'bonusValue', label: 'Valor da carteira no último bônus (R$)', type: 'decimal', value: '', placeholder: 'opcional' },
        { key: 'bonusDate', label: 'Data do último bônus', type: 'date', value: '' }
      ],
      submitLabel: 'Criar',
      onSubmit: v => {
        if (!v.name.trim()) throw new Error('Informe um nome.');
        const c = mutate(data => {
          const nc = C.addClient(data, v.name);
          C.updateClient(data, nc, {
            cash: C.parseNum(v.cash) || 0,
            bonusBase: v.bonusValue ? { value: C.parseNum(v.bonusValue), date: v.bonusDate || null } : null
          });
          return nc;
        });
        go('#/client/' + encodeURIComponent(c.id));
        toast('Cliente criado. Adicione as ações da carteira.');
      }
    });
  }

  // ---------- CARTEIRA DO CLIENTE ----------
  function viewClient(view, c) {
    const d = state.data;
    const r = C.computeClient(c, d.quotes);

    // bloco de resumo
    view.appendChild(h('div', { class: 'card' },
      h('div', { class: 'hero' },
        h('div', { class: 'label', text: 'Patrimônio total' }),
        h('div', { class: 'value num', text: C.fmtBRL(r.total) }),
        h('div', { class: 'delta num ' + signCls(r.ret), text: 'Rentabilidade acumulada ' + C.fmtPct(r.ret) })),
      h('div', { class: 'stats' },
        stat('Caixa', C.fmtBRL(r.cash)),
        stat('Investido', C.fmtBRL(r.invested), 'preço médio × cotas'),
        stat('Lucro em ações', C.fmtSignedBRL(r.profit), C.fmtPct(r.profitPct), signCls(r.profit))),
      h('div', { class: 'bonus-block' },
        stat('Carteira no último bônus', r.bonusBase ? C.fmtBRL(r.bonusBase.value) : '—', r.bonusBase && r.bonusBase.date ? 'em ' + C.fmtDate(r.bonusBase.date) : 'toque em Editar para definir', '', 'big'),
        stat('vs. último bônus', r.vsBonus == null ? '—' : C.fmtPct(r.vsBonus), r.bonusBase ? C.fmtSignedBRL(r.total - r.bonusBase.value) : '', signCls(r.vsBonus), 'big'))));

    view.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', text: 'Nova operação', onClick: () => txDialog(c) }),
      h('button', { class: 'btn', text: '+ Ação', onClick: () => positionDialog(c, null) }),
      h('button', { class: 'btn', text: 'Editar', onClick: () => editClientDialog(c) })));

    // tabela de posições
    const tbl = h('div', { class: 'card tight' });
    if (!r.positions.length) tbl.appendChild(h('div', { class: 'empty', text: 'Sem ações na carteira. Use "+ Ação" ou registre uma compra.' }));
    else {
      const tbody = h('tbody');
      const money = n => C.fmtNum(n);
      const signed = n => (n > 0 ? '+' : n < 0 ? '-' : '') + C.fmtNum(Math.abs(n));
      r.positions.forEach(p => {
        tbody.appendChild(h('tr', { class: 'clickable', onClick: () => positionDialog(c, p.ticker) },
          h('td', {}, h('div', { class: 'tk' }, p.ticker, h('small', { text: (p.hasQuote ? C.fmtNum(p.price) : 'sem cotação') + ' · PM ' + C.fmtNum(p.avgPrice) }))),
          h('td', { class: 'num', text: C.fmtInt(p.qty) }),
          h('td', { class: 'num', text: money(p.value) }),
          h('td', { class: 'num', text: money(p.invested) }),
          h('td', { class: 'num ' + signCls(p.profit) }, signed(p.profit), h('span', { class: 'sub ' + signCls(p.profit), text: C.fmtPct(p.profitPct) }))));
      });
      tbl.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Ação' }), h('th', { text: 'Cotas' }), h('th', {}, 'Valor ', h('span', { class: 'unit', text: 'R$' })), h('th', {}, 'Investido ', h('span', { class: 'unit', text: 'R$' })), h('th', {}, 'Lucro ', h('span', { class: 'unit', text: 'R$' })))),
        tbody,
        h('tfoot', {}, h('tr', {}, h('td', { text: 'Total' }), h('td', {}), h('td', { class: 'num', text: money(r.stocks) }), h('td', { class: 'num', text: money(r.invested) }), h('td', { class: 'num ' + signCls(r.profit) }, signed(r.profit), h('span', { class: 'sub ' + signCls(r.profit), text: C.fmtPct(r.profitPct) })))))));
    }
    view.appendChild(tbl);

    // gráfico
    const chartCard = h('div', { class: 'card' });
    const chips = h('div', { class: 'chips' },
      chip('Patrimônio', 'var(--blue)', ui.chart.total, () => { ui.chart.total = !ui.chart.total; if (!ui.chart.total && !ui.chart.ret) ui.chart.ret = true; persistUI(); render(); }),
      chip('Rentabilidade', 'var(--aqua)', ui.chart.ret, () => { ui.chart.ret = !ui.chart.ret; if (!ui.chart.total && !ui.chart.ret) ui.chart.total = true; persistUI(); render(); }));
    chartCard.appendChild(h('div', { class: 'card-head' }, h('h2', { text: 'Track record' }),
      h('button', { class: 'btn sm ghost', text: ui.showPoints ? 'Ocultar pontos' : 'Ver pontos', onClick: () => { ui.showPoints = !ui.showPoints; persistUI(); render(); } })));
    chartCard.appendChild(chips);
    const chartBox = h('div', { class: 'chart' });
    chartCard.appendChild(chartBox);
    if (ui.showPoints) chartCard.appendChild(pointsTable(c));
    chartCard.appendChild(h('div', { class: 'btn-row', style: 'margin:10px 0 0' },
      h('button', { class: 'btn sm', text: 'Registrar ponto agora', onClick: () => { mutate(data => C.snapshotClient(data, c)); toast('Ponto de hoje registrado.'); } }),
      h('button', { class: 'btn sm', text: 'Ponto manual', onClick: () => manualPointDialog(c) })));
    view.appendChild(chartCard);
    requestAnimationFrame(() => renderChart(chartBox, c.history, ui.chart));

    // operações
    const txCard = h('div', { class: 'card tight' });
    txCard.appendChild(h('div', { class: 'card-head', style: 'padding:12px 14px 0' }, h('h2', { text: 'Operações' })));
    if (!c.transactions.length) txCard.appendChild(h('div', { class: 'empty', text: 'Nenhuma operação registrada.' }));
    else {
      const list = h('div', { class: 'list' });
      c.transactions.slice().reverse().forEach(t => {
        const isTrade = t.type === 'buy' || t.type === 'sell';
        list.appendChild(h('button', { class: 'list-item', onClick: () => txDetailDialog(c, t) },
          h('div', { class: 'main' },
            h('div', { class: 't1' }, h('span', { class: 'tx-type ' + t.type, text: C.TX_TYPES[t.type] }), isTrade ? t.ticker : (t.type === 'bonus' ? 'Nova base' : '')),
            h('div', { class: 't2', text: C.fmtDate(t.date) + (isTrade ? ' · ' + C.fmtInt(t.qty) + ' × ' + C.fmtNum(t.price) : '') + (t.note ? ' · ' + t.note : '') })),
          h('div', { class: 'right' },
            h('div', { class: 'v1 num', text: C.fmtBRL(t.value) }),
            t.type === 'sell' ? h('div', { class: 'v2 num ' + signCls(t.result), text: 'resultado ' + C.fmtSignedBRL(t.result) + ' (' + C.fmtPct(t.resultPct) + ')' }) : null)));
      });
      txCard.appendChild(list);
    }
    view.appendChild(txCard);
  }
  function stat(label, value, sub, cls, extra) {
    return h('div', { class: 'stat ' + (extra || '') },
      h('div', { class: 'label', text: label }),
      h('div', { class: 'value ' + (cls || ''), text: value }),
      sub ? h('div', { class: 'sub', text: sub }) : null);
  }
  function chip(label, color, on, onClick) {
    return h('button', { class: 'chip' + (on ? ' on' : ''), onClick },
      h('span', { class: 'key', style: 'background:' + color }), label);
  }
  function pointsTable(c) {
    if (!c.history.length) return h('div', { class: 'chart-empty', text: 'Sem pontos ainda.' });
    const tbody = h('tbody');
    c.history.slice().reverse().forEach(p => {
      tbody.appendChild(h('tr', {},
        h('td', { text: C.fmtDate(p.date) }),
        h('td', { class: 'num', text: C.fmtBRL(p.total) }),
        h('td', { class: 'num ' + signCls(p.ret), text: C.fmtPct(p.ret) }),
        h('td', {}, h('button', { class: 'btn sm ghost', text: '✕', 'aria-label': 'Excluir ponto', onClick: async () => {
          if (await confirmDialog('Excluir o ponto de ' + C.fmtDate(p.date) + '?')) {
            mutate(() => { c.history = c.history.filter(x => x.date !== p.date); C.touch(state.data); });
          }
        } }))));
    });
    return h('div', { class: 'tbl-wrap', style: 'margin-top:10px' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Data' }), h('th', { text: 'Patrimônio' }), h('th', { text: 'Rentab.' }), h('th', {}))), tbody));
  }
  function manualPointDialog(c) {
    openForm({
      title: 'Ponto manual no histórico',
      fields: [
        { key: 'date', label: 'Data', type: 'date', value: C.localDateISO() },
        { key: 'total', label: 'Patrimônio total (R$)', type: 'decimal', value: '' },
        { key: 'ret', label: 'Rentabilidade acumulada (%)', type: 'decimal', value: '', placeholder: 'opcional; vazio = calcula pelo capital' }
      ],
      submitLabel: 'Salvar ponto',
      onSubmit: v => {
        if (!C.isISODate(v.date)) throw new Error('Data inválida.');
        const total = C.parseNum(v.total);
        if (!Number.isFinite(total)) throw new Error('Patrimônio inválido.');
        let ret = v.ret.trim() ? C.parseNum(v.ret) / 100 : (c.capital > 0 ? total / c.capital - 1 : 0);
        if (!Number.isFinite(ret)) throw new Error('Rentabilidade inválida.');
        mutate(data => { C.upsertHistory(c, { date: v.date, total: C.round2(total), invested: 0, cash: 0, capital: c.capital, ret }); C.touch(data); });
        toast('Ponto salvo.');
      }
    });
  }
  function editClientDialog(c) {
    openForm({
      title: 'Editar cliente',
      fields: [
        { key: 'name', label: 'Nome ou apelido', type: 'text', value: c.name },
        { key: 'cash', label: 'Saldo em caixa (R$)', type: 'decimal', value: C.fmtNum(c.cash) },
        { key: 'capital', label: 'Capital aportado (R$)', type: 'decimal', value: C.fmtNum(c.capital), hint: c.transactions.length ? 'Base da rentabilidade acumulada. Muda só com aporte, retirada ou edição aqui.' : 'Base da rentabilidade acumulada. Enquanto não houver operações registradas, acompanha automaticamente investido + caixa.' },
        { key: 'bonusValue', label: 'Valor da carteira no último bônus (R$)', type: 'decimal', value: c.bonusBase ? C.fmtNum(c.bonusBase.value) : '', placeholder: 'vazio = sem base' },
        { key: 'bonusDate', label: 'Data do último bônus', type: 'date', value: c.bonusBase && c.bonusBase.date ? c.bonusBase.date : '' }
      ],
      submitLabel: 'Salvar',
      danger: { label: 'Excluir cliente', onClick: async () => {
        if (await confirmDialog('Excluir "' + c.name + '" e todo o seu histórico? Isso não pode ser desfeito.')) {
          closeModal();
          mutate(data => C.removeClient(data, c.id));
          go('#/clients');
          toast('Cliente excluído.');
        }
      } },
      onSubmit: v => {
        if (!v.name.trim()) throw new Error('Informe um nome.');
        const cash = C.parseNum(v.cash), capital = C.parseNum(v.capital);
        if (!Number.isFinite(cash)) throw new Error('Caixa inválido.');
        if (!Number.isFinite(capital)) throw new Error('Capital inválido.');
        const bv = v.bonusValue.trim() ? C.parseNum(v.bonusValue) : null;
        if (bv != null && !(bv > 0)) throw new Error('Valor do bônus inválido.');
        mutate(data => C.updateClient(data, c, { name: v.name, cash, capital, bonusBase: bv ? { value: bv, date: v.bonusDate || null } : null }));
        toast('Cliente atualizado.');
      }
    });
  }
  function positionDialog(c, ticker) {
    const pos = ticker ? c.positions.find(p => p.ticker === ticker) : null;
    openForm({
      title: pos ? 'Editar ' + pos.ticker : 'Adicionar ação',
      fields: [
        { key: 'ticker', label: 'Código da ação', type: 'ticker', value: pos ? pos.ticker : '', placeholder: 'Ex.: PETR4', readOnly: !!pos },
        { key: 'qty', label: 'Quantidade de cotas', type: 'decimal', value: pos ? String(pos.qty) : '' },
        { key: 'avg', label: 'Preço médio de aquisição (R$)', type: 'decimal', value: pos ? C.fmtNum(pos.avgPrice) : '' },
        pos ? null : { key: 'price', label: 'Cotação atual (R$)', type: 'decimal', value: '', placeholder: 'opcional, se ainda não houver' }
      ].filter(Boolean),
      submitLabel: 'Salvar',
      danger: pos ? { label: 'Remover da carteira', onClick: async () => {
        if (await confirmDialog('Remover ' + pos.ticker + ' da carteira de ' + c.name + '? (Não altera o caixa; para uma venda, use "Nova operação".)')) {
          closeModal(); mutate(data => C.removePosition(data, c, pos.ticker)); toast(pos.ticker + ' removida.');
        }
      } } : null,
      onSubmit: v => {
        mutate(data => {
          C.setPosition(data, c, v.ticker, C.parseNum(v.qty), C.parseNum(v.avg));
          if (v.price && v.price.trim()) { const m = {}; m[C.normTicker(v.ticker)] = C.parseNum(v.price); C.setQuotes(data, m); }
        });
        toast('Posição salva.');
      }
    });
  }
  function txDialog(c) {
    const r = C.computeClient(c, state.data.quotes);
    openForm({
      title: 'Nova operação · ' + c.name,
      fields: [
        { key: 'type', label: 'Tipo', type: 'select', value: 'buy', options: Object.keys(C.TX_TYPES).map(k => ({ value: k, label: C.TX_TYPES[k] })) },
        { key: 'date', label: 'Data', type: 'date', value: C.localDateISO() },
        { key: 'ticker', label: 'Ação', type: 'ticker', value: '', placeholder: 'Ex.: PETR4', showIf: v => v.type === 'buy' || v.type === 'sell' },
        { key: 'qty', label: 'Quantidade', type: 'decimal', value: '', showIf: v => v.type === 'buy' || v.type === 'sell' },
        { key: 'price', label: 'Preço por ação (R$)', type: 'decimal', value: '', showIf: v => v.type === 'buy' || v.type === 'sell' },
        { key: 'value', label: 'Valor (R$)', type: 'decimal', value: '', showIf: v => v.type === 'deposit' || v.type === 'withdraw' },
        { key: 'bonusValue', label: 'Nova base (R$)', type: 'decimal', value: C.fmtNum(r.total), hint: 'Padrão: patrimônio total de hoje.', showIf: v => v.type === 'bonus' },
        { key: 'note', label: 'Observação', type: 'text', value: '', placeholder: 'opcional' }
      ],
      submitLabel: 'Registrar',
      onSubmit: v => {
        const rec = mutate(data => C.applyTransaction(data, c, {
          type: v.type, date: v.date, ticker: v.ticker, qty: v.qty, price: v.price,
          value: v.type === 'bonus' ? v.bonusValue : v.value, note: v.note
        }));
        if (rec.type === 'sell') toast('Venda registrada. Resultado: ' + C.fmtSignedBRL(rec.result) + ' (' + C.fmtPct(rec.resultPct) + ').');
        else toast(C.TX_TYPES[rec.type] + ' registrada.');
      }
    });
  }
  function txDetailDialog(c, t) {
    const isLast = C.isLastTransaction(c, t.id);
    const rows = [['Tipo', C.TX_TYPES[t.type]], ['Data', C.fmtDate(t.date)]];
    if (t.ticker) rows.push(['Ação', t.ticker], ['Quantidade', C.fmtInt(t.qty)], ['Preço', C.fmtBRL(t.price)]);
    rows.push(['Valor', C.fmtBRL(t.value)]);
    if (t.type === 'sell') rows.push(['Preço médio na venda', C.fmtBRL(t.avgPrice)], ['Resultado', C.fmtSignedBRL(t.result) + ' (' + C.fmtPct(t.resultPct) + ')']);
    if (t.note) rows.push(['Observação', t.note]);
    const kv = h('div', { class: 'kv' });
    rows.forEach(([k, v]) => { kv.appendChild(h('div', { text: k })); kv.appendChild(h('div', { text: v })); });
    openModal('Operação', [
      kv,
      h('p', { class: 'small', text: isLast ? 'Esta é a última operação do cliente: pode ser desfeita (posições e caixa voltam ao estado anterior).' : 'Não é a última operação: só pode ser apagada do registro, sem alterar posições e caixa. Ajuste a carteira manualmente se necessário.' }),
      h('div', { class: 'actions' },
        isLast ? h('button', { class: 'btn danger', text: 'Desfazer e excluir', onClick: async () => {
          if (await confirmDialog('Desfazer esta operação e removê-la do registro?')) { closeModal(); mutate(data => C.removeTransaction(data, c, t.id, true)); toast('Operação desfeita.'); }
        } }) : null,
        h('button', { class: 'btn', text: 'Excluir só do registro', onClick: async () => {
          if (await confirmDialog('Apagar do registro sem alterar posições e caixa?')) { closeModal(); mutate(data => C.removeTransaction(data, c, t.id, false)); toast('Removida do registro.'); }
        } }),
        h('button', { class: 'btn primary', text: 'Fechar', onClick: closeModal }))
    ]);
  }

  // ---------- DESEMPENHO ----------
  function viewPerformance(view) {
    const d = state.data;
    if (!d.clients.length) { view.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty', text: 'Nenhum cliente ainda.' }))); return; }
    const all = C.computeAll(d);
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
      total: (a, b) => b.total - a.total,
      ret: (a, b) => b.ret - a.ret,
      bonus: (a, b) => (b.vsBonus == null ? -Infinity : b.vsBonus) - (a.vsBonus == null ? -Infinity : a.vsBonus)
    };
    const labels = { name: 'Nome', total: 'Patrimônio', ret: 'Rentabilidade', bonus: 'vs. bônus' };
    view.appendChild(h('div', { class: 'chips', style: 'margin-bottom:12px' },
      Object.keys(labels).map(k => h('button', { class: 'chip' + (ui.perfSort === k ? ' on' : ''), text: labels[k], onClick: () => { ui.perfSort = k; persistUI(); render(); } }))));
    all.sort(sorters[ui.perfSort] || sorters.name);
    const tbody = h('tbody');
    all.forEach(r => tbody.appendChild(h('tr', { class: 'clickable', onClick: () => go('#/client/' + encodeURIComponent(r.id)) },
      h('td', {}, h('div', { class: 'tk' }, r.name, h('small', { text: r.positions.length + (r.positions.length === 1 ? ' ação' : ' ações') }))),
      h('td', { class: 'num', text: C.fmtBRL(r.total) }),
      h('td', { class: 'num ' + signCls(r.ret), text: C.fmtPct(r.ret) }),
      h('td', { class: 'num ' + signCls(r.vsBonus), text: r.vsBonus == null ? '—' : C.fmtPct(r.vsBonus) }))));
    const aum = all.reduce((s, r) => s + r.total, 0);
    const cap = all.reduce((s, r) => s + r.capital, 0);
    view.appendChild(h('div', { class: 'card tight' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Cliente' }), h('th', { text: 'Patrimônio' }), h('th', { text: 'Rentab.' }), h('th', { text: 'vs. bônus' }))),
      tbody,
      h('tfoot', {}, h('tr', {}, h('td', { text: all.length + ' clientes' }), h('td', { class: 'num', text: C.fmtBRL(aum) }), h('td', { class: 'num ' + signCls(aum - cap), text: cap > 0 ? C.fmtPct(aum / cap - 1) : '—' }), h('td', {})))))));
    view.appendChild(h('p', { class: 'small muted', text: 'Rentabilidade acumulada = patrimônio total ÷ capital aportado − 1. "vs. bônus" compara o patrimônio de hoje com o valor da carteira no último bônus recebido.' }));
  }

  // ---------- CONFIGURAÇÕES ----------
  function viewSettings(view) {
    // segurança
    view.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Segurança' }),
      h('div', { class: 'btn-row', style: 'margin:0' },
        h('button', { class: 'btn', text: 'Alterar PIN', onClick: () => showLock('change') }))));

    // GitHub
    const f = {};
    const ghCard = h('div', { class: 'card' }, h('h2', { text: 'Sincronização com o GitHub' }),
      h('p', { class: 'small dim', style: 'margin-bottom:10px', text: 'Com um token, cada edição feita aqui é gravada em data.json no repositório, e as atualizações feitas pelo Claude a partir dos prints chegam ao app automaticamente. Sem token, o app apenas lê o arquivo publicado e as suas edições ficam só neste aparelho (use Exportar para enviá-las).' }));
    [['owner', 'Usuário/organização'], ['repo', 'Repositório'], ['branch', 'Branch'], ['path', 'Caminho do arquivo']].forEach(([k, label]) => {
      f[k] = h('input', { type: 'text', value: gh[k], autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
      ghCard.appendChild(h('div', { class: 'field' }, h('label', { text: label }), f[k]));
    });
    f.token = h('input', { type: 'password', value: gh.token, placeholder: 'github_pat_…', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    ghCard.appendChild(h('div', { class: 'field' }, h('label', { text: 'Token de acesso (fine-grained)' }), f.token,
      h('div', { class: 'hint', text: 'GitHub → Settings → Developer settings → Fine-grained tokens → só este repositório → permissão Contents: Read and write. O token fica apenas neste aparelho.' })));
    const ghMsg = h('div', { class: 'form-error' });
    ghCard.appendChild(ghMsg);
    ghCard.appendChild(h('div', { class: 'btn-row', style: 'margin:0' },
      h('button', { class: 'btn primary', text: 'Salvar', onClick: () => {
        Object.keys(f).forEach(k => gh[k] = f[k].value.trim());
        save(LS.gh, gh); toast('Configuração salva.'); state.sha = null; persist(); render();
      } }),
      h('button', { class: 'btn', text: 'Testar conexão', onClick: async () => {
        Object.keys(f).forEach(k => gh[k] = f[k].value.trim());
        ghMsg.textContent = 'Testando…';
        try { const r = await ghGetFile(); ghMsg.textContent = ''; toast('Conectado. Arquivo no servidor de ' + C.fmtDateTime(r.data.updatedAt)); }
        catch (e) { ghMsg.textContent = 'Falha: ' + e.message; }
      } })));
    view.appendChild(ghCard);

    // dados
    view.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Dados' }),
      h('div', { class: 'status-line', style: 'flex-direction:column;gap:4px;margin-bottom:12px' },
        h('span', {}, 'Versão local: ', h('b', { text: C.fmtDateTime(state.data.updatedAt) })),
        h('span', {}, 'Base do servidor: ', h('b', { text: state.baseUpdatedAt ? C.fmtDateTime(state.baseUpdatedAt) : '—' })),
        h('span', {}, state.dirty ? 'Há edições locais não enviadas.' : 'Sem edições pendentes.')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: 'Baixar do servidor', onClick: async () => {
          if (state.dirty && !(await confirmDialog('Isso substitui os dados locais (inclusive edições não enviadas) pela versão do servidor. Continuar?'))) return;
          await syncFromRemote({ force: true }); toast('Dados do servidor carregados.');
        } }),
        h('button', { class: 'btn', text: 'Enviar para o servidor', disabled: !gh.token, onClick: async () => {
          try { await pushToRemote({ force: true }); toast('Enviado.'); } catch (e) { toast('Falha: ' + e.message, true); }
        } })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: 'Compartilhar JSON', onClick: shareJSON }),
        h('button', { class: 'btn', text: 'Copiar JSON', onClick: async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(state.data, null, 2)); toast('JSON copiado.'); }
          catch (e) { importExportDialog(true); }
        } })),
      h('div', { class: 'btn-row', style: 'margin:0' },
        h('button', { class: 'btn', text: 'Importar JSON', onClick: () => importExportDialog(false) }),
        h('button', { class: 'btn danger', text: 'Apagar dados locais', onClick: async () => {
          if (await confirmDialog('Apagar os dados salvos neste aparelho? O arquivo no servidor não é afetado; o app vai baixá-lo de novo.')) {
            del(LS.state); state = { data: null, baseUpdatedAt: null, dirty: false, sha: null, lastSync: null }; render(); syncFromRemote({ force: true });
          }
        } }))));

    view.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Sobre' }),
      h('div', { class: 'status-line', style: 'flex-direction:column;gap:4px' },
        h('span', {}, 'Orihuela Consulting · app ', h('b', { text: APP_VERSION })),
        h('span', { text: 'Os dados ficam em data.json no repositório e em cópia local para uso off-line. O PIN bloqueia só a tela deste aparelho.' }))));
  }
  async function shareJSON() {
    const text = JSON.stringify(state.data, null, 2);
    const name = 'orihuela-' + C.localDateISO() + '.json';
    try {
      if (navigator.share) {
        const file = new File([text], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
        await navigator.share({ title: name, text }); return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    importExportDialog(true);
  }
  function importExportDialog(exportMode) {
    const ta = h('textarea', { class: 'mono', value: exportMode ? JSON.stringify(state.data, null, 2) : '', placeholder: 'Cole aqui o conteúdo do data.json' });
    const err = h('div', { class: 'form-error' });
    openModal(exportMode ? 'Exportar JSON' : 'Importar JSON', [
      exportMode ? h('p', { text: 'Selecione tudo e copie. Envie este texto ao Claude para que ele grave no repositório.' }) : h('p', { text: 'O conteúdo colado substitui todos os dados locais.' }),
      ta, err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', text: 'Fechar', onClick: closeModal }),
        exportMode ? null : h('button', { class: 'btn primary', text: 'Importar', onClick: () => {
          try {
            const parsed = JSON.parse(ta.value);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients)) throw new Error('Formato inesperado (faltam "clients").');
            closeModal();
            state.data = C.normalize(parsed); C.touch(state.data); state.dirty = true; persist(); render(); schedulePush();
            toast('Dados importados.');
          } catch (e) { err.textContent = 'JSON inválido: ' + e.message; }
        } }))
    ]);
    if (exportMode) setTimeout(() => { ta.focus(); ta.select(); }, 50);
  }

  // ---------- GRÁFICO ----------
  const SERIES = {
    total: { label: 'Patrimônio', color: '#3987e5', fmt: v => C.fmtBRL(v), tick: v => compactBRL(v) },
    ret: { label: 'Rentabilidade', color: '#2bb383', fmt: v => C.fmtPct(v), tick: v => (v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0).replace('.', ',') + '%' }
  };
  function compactBRL(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' mi';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace('.', ',') + ' mil';
    return C.fmtInt(v);
  }
  function niceTicks(min, max, count) {
    if (min === max) { min = min - (Math.abs(min) || 1) * 0.05; max = max + (Math.abs(max) || 1) * 0.05; }
    const span = max - min;
    const step0 = span / Math.max(1, count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return { lo, hi, ticks };
  }
  function renderChart(box, history, layers) {
    box.innerHTML = '';
    const pts = history.filter(p => C.isISODate(p.date));
    const active = ['total', 'ret'].filter(k => layers[k]);
    if (pts.length < 1) { box.appendChild(h('div', { class: 'chart-empty', text: 'Ainda não há pontos. Cada atualização de cotações registra um ponto.' })); return; }
    const W = Math.max(280, box.clientWidth || 320);
    const PH = 150, ML = 54, MR = 14, MT = 22, MB = 22, GAP = 10;
    const H = active.length * (PH + GAP) - GAP + MB;
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });
    const xs = pts.map(p => new Date(p.date + 'T12:00:00').getTime());
    const xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    const xr = xmax - xmin || 1;
    const X = t => ML + (t - xmin) / xr * (W - ML - MR);
    const panelsMeta = [];

    active.forEach((key, i) => {
      const s = SERIES[key];
      const top = i * (PH + GAP);
      const vals = pts.map(p => p[key]);
      let vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals);
      if (key === 'ret') { vmin = Math.min(vmin, 0); vmax = Math.max(vmax, 0); }
      const nt = niceTicks(vmin, vmax, 4);
      const Y = v => top + MT + (1 - (v - nt.lo) / ((nt.hi - nt.lo) || 1)) * (PH - MT - 6);
      const g = svgEl('g');
      // grade + eixo y
      const grid = svgEl('g', { class: 'grid' }), axis = svgEl('g', { class: 'axis' });
      nt.ticks.forEach(v => {
        grid.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: Y(v), y2: Y(v), class: key === 'ret' && Math.abs(v) < 1e-12 ? 'zero' : '' }));
        axis.appendChild(svgEl('text', { x: ML - 6, y: Y(v) + 3, 'text-anchor': 'end' }, s.tick(v)));
      });
      g.appendChild(grid); g.appendChild(axis);
      g.appendChild(svgEl('text', { x: ML, y: top + 12, class: 'panel-title' }, s.label.toUpperCase()));
      // área e linha
      if (pts.length > 1) {
        const d = pts.map((p, j) => (j ? 'L' : 'M') + X(xs[j]).toFixed(1) + ' ' + Y(p[key]).toFixed(1)).join(' ');
        const base = Y(key === 'ret' ? Math.max(nt.lo, Math.min(0, nt.hi)) : nt.lo);
        g.appendChild(svgEl('path', { class: 'area', fill: s.color, d: d + ' L' + X(xs[xs.length - 1]).toFixed(1) + ' ' + base.toFixed(1) + ' L' + X(xs[0]).toFixed(1) + ' ' + base.toFixed(1) + ' Z' }));
        g.appendChild(svgEl('path', { class: 'line', stroke: s.color, d }));
      }
      const last = pts[pts.length - 1];
      g.appendChild(svgEl('circle', { class: 'dot', cx: X(xs[xs.length - 1]), cy: Y(last[key]), r: 4, fill: s.color }));
      // rótulo do último valor
      const lx = X(xs[xs.length - 1]), ly = Y(last[key]);
      const label = s.fmt(last[key]);
      const anchor = lx > W - MR - 90 ? 'end' : 'start';
      g.appendChild(svgEl('text', { class: 'end-label', x: anchor === 'end' ? lx - 8 : lx + 8, y: ly - 8, 'text-anchor': anchor }, label));
      svg.appendChild(g);
      panelsMeta.push({ key, Y, top });
    });
    // eixo x (datas): rótulos espalhados no tempo, sem sobreposição (mínimo 64px entre eles)
    const ax = svgEl('g', { class: 'axis' });
    const LABEL_W = 64;
    let idxs;
    if (pts.length === 1) idxs = [0];
    else {
      const slots = Math.max(2, Math.min(4, Math.floor((W - ML - MR) / LABEL_W) + 1));
      const wanted = Array.from({ length: slots }, (_, i) => xmin + xr * i / (slots - 1));
      idxs = [];
      wanted.forEach(t => {
        let best = 0, bd = Infinity;
        xs.forEach((x, j) => { const d = Math.abs(x - t); if (d < bd) { bd = d; best = j; } });
        if (!idxs.includes(best)) idxs.push(best);
      });
      // remove os que ficariam colados no vizinho, preservando o primeiro e o último
      const keep = [idxs[0]];
      for (let k = 1; k < idxs.length; k++) {
        const isLast = k === idxs.length - 1;
        const prevX = X(xs[keep[keep.length - 1]]), curX = X(xs[idxs[k]]);
        if (curX - prevX >= LABEL_W) keep.push(idxs[k]);
        else if (isLast) keep[keep.length - 1] = idxs[k];
      }
      idxs = keep;
    }
    idxs.forEach((j, k) => {
      const anchor = pts.length === 1 ? 'middle' : k === 0 ? 'start' : k === idxs.length - 1 ? 'end' : 'middle';
      ax.appendChild(svgEl('text', { x: X(xs[j]), y: H - 6, 'text-anchor': anchor }, shortDate(pts[j].date)));
    });
    svg.appendChild(ax);
    // camada de interação: cruz + tooltip
    const cross = svgEl('line', { class: 'cross', x1: 0, x2: 0, y1: 0, y2: H - MB, style: 'display:none' });
    const dots = panelsMeta.map(m => { const c = svgEl('circle', { class: 'dot', r: 4, fill: SERIES[m.key].color, style: 'display:none' }); svg.appendChild(c); return c; });
    svg.appendChild(cross);
    const hit = svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
    svg.appendChild(hit);
    const tip = h('div', { class: 'tip', style: 'display:none' });
    box.appendChild(svg); box.appendChild(tip);
    function show(clientX) {
      const rect = svg.getBoundingClientRect();
      const px = (clientX - rect.left) * (W / rect.width);
      let best = 0, bd = Infinity;
      xs.forEach((t, j) => { const d = Math.abs(X(t) - px); if (d < bd) { bd = d; best = j; } });
      const p = pts[best], cx = X(xs[best]);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      panelsMeta.forEach((m, i) => { dots[i].setAttribute('cx', cx); dots[i].setAttribute('cy', m.Y(p[m.key])); dots[i].style.display = ''; });
      tip.innerHTML = '';
      tip.appendChild(h('div', { class: 'd', text: C.fmtDate(p.date) }));
      panelsMeta.forEach(m => tip.appendChild(h('div', { class: 'r' }, h('span', { class: 'key', style: 'background:' + SERIES[m.key].color }), SERIES[m.key].label, h('b', { text: SERIES[m.key].fmt(p[m.key]) }))));
      tip.style.display = '';
      const tw = tip.offsetWidth || 130;
      const left = (cx / W) * rect.width;
      tip.style.left = (left + 12 + tw > rect.width ? left - tw - 12 : left + 12) + 'px';
    }
    function hide() { cross.style.display = 'none'; dots.forEach(d => d.style.display = 'none'); tip.style.display = 'none'; }
    hit.addEventListener('pointermove', e => show(e.clientX));
    hit.addEventListener('pointerdown', e => show(e.clientX));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointerup', () => setTimeout(hide, 1500));
  }
  function shortDate(iso) { const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) : iso; }

  // ---------- MODAIS ----------
  function openModal(title, children) {
    closeModal();
    const root = $('#modal-root');
    const sheet = h('div', { class: 'sheet' }, h('h3', {}, title, h('button', { class: 'x', text: '×', 'aria-label': 'Fechar', onClick: closeModal })), children);
    const back = h('div', { class: 'modal-backdrop', onClick: e => { if (e.target === back) closeModal(); } }, sheet);
    root.appendChild(back);
    document.body.style.overflow = 'hidden';
    return sheet;
  }
  function closeModal() { $('#modal-root').innerHTML = ''; document.body.style.overflow = ''; }
  function confirmDialog(message) {
    return new Promise(resolve => {
      const sheet = openModal('Confirmar', [
        h('p', { text: message }),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', text: 'Cancelar', onClick: () => { closeModal(); resolve(false); } }),
          h('button', { class: 'btn danger', text: 'Confirmar', onClick: () => { closeModal(); resolve(true); } }))]);
      void sheet;
    });
  }
  // Formulário genérico: fields [{key,label,type,value,options,placeholder,hint,showIf,readOnly}]
  function openForm(opts) {
    const inputs = {}, wrappers = {};
    const err = h('div', { class: 'form-error' });
    const values = () => { const v = {}; Object.keys(inputs).forEach(k => { const i = inputs[k]; v[k] = i.type === 'checkbox' ? i.checked : i.value; }); return v; };
    function refresh() { const v = values(); opts.fields.forEach(f => { if (f.showIf) wrappers[f.key].classList.toggle('hidden', !f.showIf(v)); }); }
    const body = opts.fields.map(f => {
      let inp;
      if (f.type === 'select') {
        inp = h('select', {}, f.options.map(o => h('option', { value: o.value, text: o.label, selected: o.value === f.value })));
      } else if (f.type === 'checkbox') {
        inp = h('input', { type: 'checkbox', checked: !!f.value });
      } else if (f.type === 'date') {
        inp = h('input', { type: 'date', value: f.value || '' });
      } else if (f.type === 'ticker') {
        inp = h('input', { type: 'text', value: f.value || '', placeholder: f.placeholder, autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, list: 'ticker-list', readOnly: !!f.readOnly });
        inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase(); });
      } else {
        inp = h('input', { type: 'text', value: f.value == null ? '' : String(f.value), placeholder: f.placeholder, inputmode: f.type === 'decimal' ? 'decimal' : null, readOnly: !!f.readOnly });
        if (f.type === 'decimal') inp.addEventListener('focus', () => inp.select());
      }
      inp.addEventListener('change', refresh);
      inputs[f.key] = inp;
      const w = f.type === 'checkbox'
        ? h('div', { class: 'field inline' }, inp, h('label', { text: f.label }))
        : h('div', { class: 'field' }, h('label', { text: f.label }), inp, f.hint ? h('div', { class: 'hint', text: f.hint }) : null);
      wrappers[f.key] = w;
      return w;
    });
    const dl = h('datalist', { id: 'ticker-list' }, C.tickers(state.data).map(t => h('option', { value: t })));
    const submit = () => {
      err.textContent = '';
      try { opts.onSubmit(values()); closeModal(); }
      catch (e) { err.textContent = e.message || String(e); }
    };
    const form = h('form', { onSubmit: e => { e.preventDefault(); submit(); } }, body, dl, err,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', text: 'Cancelar', onClick: closeModal }),
        h('button', { class: 'btn primary', type: 'submit', text: opts.submitLabel || 'Salvar' })),
      opts.danger ? h('div', { class: 'danger-zone' }, h('button', { class: 'btn danger block', type: 'button', text: opts.danger.label, onClick: opts.danger.onClick })) : null);
    openModal(opts.title, form);
    refresh();
    const first = opts.fields.find(f => !f.readOnly && f.type !== 'checkbox' && f.type !== 'select');
    if (first && !('ontouchstart' in window)) setTimeout(() => inputs[first.key].focus(), 30);
  }

  // ---------- SINCRONIZAÇÃO ----------
  function ghHeaders() { return { Authorization: 'Bearer ' + gh.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
  function ghUrl() { return 'https://api.github.com/repos/' + encodeURIComponent(gh.owner) + '/' + encodeURIComponent(gh.repo) + '/contents/' + gh.path.split('/').map(encodeURIComponent).join('/'); }
  function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
  function b64decode(b64) { const bin = atob(String(b64).replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
  async function ghGetFile() {
    if (!gh.token) throw new Error('Token não configurado.');
    const r = await fetch(ghUrl() + '?ref=' + encodeURIComponent(gh.branch) + '&ts=' + Date.now(), { headers: ghHeaders(), cache: 'no-store' });
    if (!r.ok) { const e = new Error(r.status === 404 ? 'arquivo não encontrado (404)' : r.status === 401 ? 'token inválido (401)' : 'GitHub respondeu ' + r.status); e.status = r.status; throw e; }
    const j = await r.json();
    return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
  }
  async function ghPutFile(text, sha, message) {
    const body = { message, content: b64encode(text), branch: gh.branch };
    if (sha) body.sha = sha;
    const r = await fetch(ghUrl(), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()), body: JSON.stringify(body) });
    if (!r.ok) { const e = new Error(r.status === 409 || r.status === 422 ? 'conflito de versão' : 'GitHub respondeu ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function fetchRemote() {
    if (gh.token) {
      try { const r = await ghGetFile(); return { data: r.data, sha: r.sha, via: 'api' }; }
      catch (e) { if (e.status === 401 || e.status === 403) throw e; /* cai para o arquivo publicado */ }
    }
    const res = await fetch('./data.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { data: await res.json(), sha: null, via: 'pages' };
  }
  function adopt(data, sha) {
    state.data = C.normalize(data);
    state.baseUpdatedAt = state.data.updatedAt;
    state.dirty = false;
    if (sha) state.sha = sha;
    state.lastSync = new Date().toISOString();
    pendingRemote = null;
    persist(); render();
  }
  async function syncFromRemote(opts) {
    opts = opts || {};
    if (!navigator.onLine) { syncStatus = 'offline'; render(); return; }
    syncStatus = 'syncing'; syncError = '';
    if (route().name === 'home' && state.data) render();
    let remote;
    try { remote = await fetchRemote(); }
    catch (e) { syncStatus = 'error'; syncError = 'Falha ao buscar dados: ' + e.message; render(); return; }
    syncStatus = 'ok';
    const rd = C.normalize(remote.data);
    if (!state.data || opts.force) { adopt(rd, remote.sha); return; }
    if (remote.sha) state.sha = remote.sha;
    if (rd.updatedAt > (state.baseUpdatedAt || '')) {
      if (!state.dirty) { adopt(rd, remote.sha); toast('Dados atualizados: ' + C.fmtDateTime(rd.updatedAt)); }
      else { pendingRemote = { data: rd, sha: remote.sha }; render(); }
    } else { state.lastSync = new Date().toISOString(); persist(); render(); }
  }
  let pushTimer = null;
  function schedulePush() {
    if (!gh.token) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushToRemote({}).catch(e => { if (e.message !== 'conflito') toast('Não foi possível enviar ao GitHub: ' + e.message, true); }), 1500);
  }
  async function pushToRemote(opts) {
    opts = opts || {};
    if (!gh.token) throw new Error('token não configurado');
    if (!navigator.onLine) throw new Error('sem conexão');
    let cur = null;
    try { cur = await ghGetFile(); } catch (e) { if (e.status !== 404) throw e; }
    if (cur && !opts.force) {
      const remoteAt = (cur.data && cur.data.updatedAt) || '';
      if (remoteAt > (state.baseUpdatedAt || '') && remoteAt !== state.data.updatedAt) {
        pendingRemote = { data: C.normalize(cur.data), sha: cur.sha }; render();
        throw new Error('conflito');
      }
    }
    const text = JSON.stringify(state.data, null, 2) + '\n';
    const res = await ghPutFile(text, cur ? cur.sha : null, 'Orihuela: atualização pelo app em ' + C.fmtDateTime(new Date().toISOString()));
    state.sha = res.content && res.content.sha;
    state.baseUpdatedAt = state.data.updatedAt;
    state.dirty = false;
    state.lastSync = new Date().toISOString();
    pendingRemote = null;
    syncStatus = 'ok'; syncError = '';
    persist(); render();
  }
  async function fullSync() {
    if (state.dirty && gh.token) {
      try { await pushToRemote({}); toast('Edições enviadas.'); return; }
      catch (e) { if (e.message !== 'conflito') toast('Falha ao enviar: ' + e.message, true); return; }
    }
    await syncFromRemote({});
    if (syncStatus === 'ok' && !pendingRemote) toast('Sincronizado.');
    else if (syncStatus === 'error') toast(syncError, true);
  }
  window.addEventListener('online', () => { render(); syncFromRemote({}); });
  window.addEventListener('offline', render);

  // ---------- PIN ----------
  const pinCfg = { get: () => load(LS.pin), set: v => save(LS.pin, v), clear: () => del(LS.pin) };
  async function hashPin(pin, salt) {
    const text = salt + ':' + pin;
    if (window.crypto && crypto.subtle && window.isSecureContext) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let hsh = 2166136261; // fallback FNV-1a (só em contexto não seguro, ex.: http local)
    for (let i = 0; i < text.length; i++) { hsh ^= text.charCodeAt(i); hsh = Math.imul(hsh, 16777619) >>> 0; }
    return 'fnv:' + hsh.toString(16);
  }
  function randomSalt() { const a = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256 | 0); return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join(''); }
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && pinCfg.get()) showLock('unlock');
    if (!document.hidden) hiddenAt = null;
  });
  // mode: 'setup' (primeiro uso) | 'unlock' | 'change'
  function showLock(mode) {
    const root = $('#lock-root');
    root.innerHTML = '';
    let entered = '', stage = mode === 'unlock' ? 'verify' : mode === 'change' ? 'old' : 'new', firstPin = '';
    const cfg = pinCfg.get();
    const msg = h('div', { class: 'msg' });
    const dots = h('div', { class: 'dots' });
    const titleEl = h('div', { class: 'sub' });
    function label() {
      if (stage === 'verify') return 'Digite o PIN';
      if (stage === 'old') return 'Digite o PIN atual';
      if (stage === 'new') return mode === 'setup' ? 'Crie um PIN de 4 a 6 dígitos' : 'Novo PIN (4 a 6 dígitos)';
      return 'Repita o PIN';
    }
    function draw() {
      titleEl.textContent = label();
      dots.innerHTML = '';
      const n = Math.max(4, Math.min(6, (stage === 'verify' || stage === 'old') && cfg ? cfg.length : Math.max(4, entered.length)));
      for (let i = 0; i < n; i++) dots.appendChild(h('i', { class: i < entered.length ? 'on' : '' }));
    }
    async function submit() {
      if (stage === 'verify' || stage === 'old') {
        if (!cfg) { done(); return; }
        const hsh = await hashPin(entered, cfg.salt);
        if (hsh === cfg.hash) { if (stage === 'old') { stage = 'new'; entered = ''; msg.textContent = ''; draw(); } else done(); }
        else { msg.textContent = 'PIN incorreto.'; msg.classList.add('err'); entered = ''; draw(); }
      } else if (stage === 'new') {
        if (entered.length < 4) { msg.textContent = 'Use pelo menos 4 dígitos.'; msg.classList.add('err'); return; }
        firstPin = entered; entered = ''; stage = 'confirm'; msg.textContent = ''; msg.classList.remove('err'); draw();
      } else {
        if (entered !== firstPin) { msg.textContent = 'Os PINs não conferem. Tente de novo.'; msg.classList.add('err'); entered = ''; stage = 'new'; draw(); return; }
        const salt = randomSalt();
        pinCfg.set({ salt, hash: await hashPin(entered, salt), length: entered.length });
        toast(mode === 'setup' ? 'PIN criado.' : 'PIN alterado.');
        done();
      }
    }
    function done() { root.innerHTML = ''; }
    function press(k) {
      msg.classList.remove('err'); msg.textContent = '';
      if (k === 'del') entered = entered.slice(0, -1);
      else if (k === 'ok') { if (entered.length) submit(); return; }
      else if (entered.length < 6) entered += k;
      draw();
      const target = (stage === 'verify' || stage === 'old') && cfg ? cfg.length : null;
      if (target && entered.length === target) submit();
    }
    const pad = h('div', { class: 'keypad' });
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].forEach(k => {
      pad.appendChild(h('button', { class: k === 'del' || k === 'ok' ? 'fn' : '', text: k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k, onClick: () => press(k) }));
    });
    const forgot = mode === 'unlock' ? h('button', { class: 'forgot', text: 'Esqueci o PIN', onClick: async () => {
      done();
      if (await confirmDialog('Redefinir o PIN apaga os dados locais e o token do GitHub deste aparelho. O arquivo no servidor não é afetado. Continuar?')) {
        pinCfg.clear(); del(LS.state); del(LS.gh); location.reload();
      } else showLock('unlock');
    } }) : (mode === 'change' ? h('button', { class: 'forgot', text: 'Cancelar', onClick: done }) : null);
    root.appendChild(h('div', { class: 'lock' },
      h('div', { class: 'brand' }, h('div', { class: 'name' }, 'Orihuela ', h('span', { text: 'Consulting' })), titleEl),
      dots, msg, pad, forgot));
    draw();
    window.addEventListener('keydown', function onKey(e) {
      if (!root.firstChild) { window.removeEventListener('keydown', onKey); return; }
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Enter') press('ok');
    });
  }

  // ---------- início ----------
  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => { });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (navigator.serviceWorker.controller && !reloaded && state.data) { reloaded = true; /* nova versão pronta; recarrega na próxima abertura */ } });
    }
    if (!pinCfg.get()) showLock('setup'); else showLock('unlock');
    render();
    syncFromRemote({});
  }
  init();
})();
