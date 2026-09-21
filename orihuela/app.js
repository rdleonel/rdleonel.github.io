/* Orihuela Consulting — interface (PWA). Depende de core.js (OrihuelaCore). */
(function () {
  'use strict';
  const C = window.OrihuelaCore;
  const APP_VERSION = '1.2.0';
  const LS = { state: 'orihuela.state', pin: 'orihuela.pin', gh: 'orihuela.gh', ui: 'orihuela.ui', qp: 'orihuela.quotes' };
  const DEFAULT_GH = { owner: 'rdleonel', repo: 'rdleonel.github.io', branch: 'main', path: 'orihuela/data.json', token: '' };
  // Serviço de cotações. {TICKERS} e {TOKEN} são trocados na hora da busca.
  const DEFAULT_QP = { url: 'https://brapi.dev/api/quote/{TICKERS}?token={TOKEN}', token: '', sep: ',', auth: '' };
  const LOCK_AFTER_MS = 2 * 60 * 1000;

  // ---------- armazenamento ----------
  function load(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem espaço ou modo privado */ } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { } }

  let state = load(LS.state) || { data: null, baseUpdatedAt: null, dirty: false, sha: null, lastSync: null };
  if (state.data) state.data = C.normalize(state.data);
  let gh = Object.assign({}, DEFAULT_GH, load(LS.gh) || {});
  let qp = Object.assign({}, DEFAULT_QP, load(LS.qp) || {});
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

  function setHeader(title, sub) {
    $('#title').textContent = title;
    $('#subtitle').textContent = sub || '';
  }

  // ---------- navegação inferior (tudo ao alcance do polegar) ----------
  // O iPhone torna o topo da tela difícil de alcançar, então nada clicável mora lá:
  // abas fixas no rodapé, ações da tela logo acima delas e gesto de arrastar para voltar.
  const TABS = [
    { key: 'home', label: 'Início', hash: '#/', icon: 'home' },
    { key: 'quotes', label: 'Cotações', hash: '#/quotes', icon: 'chart' },
    { key: 'clients', label: 'Clientes', hash: '#/clients', icon: 'people' },
    { key: 'performance', label: 'Desempenho', hash: '#/performance', icon: 'bars' },
    { key: 'settings', label: 'Ajustes', hash: '#/settings', icon: 'sliders' }
  ];
  const ICONS = {
    home: ['M3 10.7 12 3.6l9 7.1', 'M5.4 9.6V20.4h13.2V9.6', 'M9.7 20.4v-5.3h4.6v5.3'],
    chart: ['M3 16.8 8.6 11l3.4 3 6.4-7.4', 'M14.6 6.1h4.4v4.4'],
    people: ['M9.2 11.4a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Z', 'M2.8 19.8c0-3.2 2.9-4.9 6.4-4.9s6.4 1.7 6.4 4.9', 'M16.6 5.3a3.2 3.2 0 0 1 0 6.2', 'M17.8 15.2c2.1.5 3.4 2 3.4 4.6'],
    bars: ['M3 20.4h18', 'M6.4 20.4v-6.2', 'M12 20.4V6.6', 'M17.6 20.4v-9.3'],
    sliders: ['M3.4 7.2h9.2', 'M17.4 7.2h3.2', 'M3.4 16.8h3.2', 'M11.4 16.8h9.2', 'M15 4.6v5.2', 'M9 14.2v5.2']
  };
  function tabIcon(name) {
    return svgEl.apply(null, [ 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' } ]
      .concat(ICONS[name].map(d => svgEl('path', { d }))));
  }
  // A carteira de um cliente é filha da aba Clientes; tocar nela volta para a lista.
  function activeTab(routeName) { return routeName === 'client' ? 'clients' : routeName; }
  function renderTabbar(routeName) {
    const bar = $('#tabbar');
    bar.innerHTML = '';
    const active = activeTab(routeName);
    TABS.forEach(t => {
      bar.appendChild(h('button', {
        class: t.key === active ? 'on' : '', 'aria-label': t.label,
        'aria-current': t.key === active ? 'page' : null,
        onClick: () => { if (location.hash === t.hash || (t.key === 'home' && !location.hash)) window.scrollTo(0, 0); go(t.hash); }
      }, tabIcon(t.icon), h('span', { text: t.label }),
        t.key === 'settings' && state.dirty ? h('i', { class: 'dot' }) : null));
    });
  }
  // Barra de ação da tela, fixa logo acima das abas. Sem conteúdo, some.
  function setActionBar(content) {
    const ab = $('#actionbar');
    ab.innerHTML = '';
    if (!content) {
      ab.classList.add('hidden');
      document.documentElement.style.setProperty('--actionbar-h', '0px');
      return;
    }
    append(ab, content);
    ab.classList.remove('hidden');
    const measure = () => document.documentElement.style.setProperty('--actionbar-h', ab.offsetHeight + 'px');
    measure();
    requestAnimationFrame(measure);
  }
  function actionRow() {
    return h('div', { class: 'row' }, Array.prototype.slice.call(arguments));
  }

  // No iOS o teclado cobre elementos fixos: acompanha a janela visível para que a
  // barra de ação (Salvar, Cancelar) fique sempre logo acima do teclado.
  (function trackKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const overlap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb', overlap + 'px');
      document.body.classList.toggle('kb-open', overlap > 120);
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
  })();

  // Voltar: arrastar da borda esquerda, como nos apps nativos.
  function goBack() {
    const r = route();
    if (r.name === 'client') go('#/clients');
    else if (r.name !== 'home') go('#/');
  }
  let swipeX = null, swipeY = null;
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { swipeX = null; return; }
    const t = e.touches[0];
    swipeX = t.clientX <= 30 ? t.clientX : null;
    swipeY = t.clientY;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (swipeX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeX, dy = Math.abs(t.clientY - swipeY);
    swipeX = null;
    if (dx > 70 && dy < 60) goBack();
  }, { passive: true });

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
  let lastRouteKey = null;
  function render() {
    const r = route();
    renderTabbar(r.name);
    if (!state.data) { setHeader('Orihuela Consulting'); setActionBar(null); renderLoading(); return; }
    const view = $('#view');
    view.innerHTML = '';
    setActionBar(null);
    const banner = renderBanner();
    if (banner) view.appendChild(banner);
    switch (r.name) {
      case 'quotes': setHeader('Cotações'); viewQuotes(view); break;
      case 'clients': setHeader('Clientes', state.data.clients.length + (state.data.clients.length === 1 ? ' carteira' : ' carteiras')); viewClients(view); break;
      case 'client': {
        const c = state.data.clients.find(x => x.id === r.id);
        if (!c) { go('#/clients'); return; }
        setHeader(c.name, 'carteira'); viewClient(view, c); break;
      }
      case 'performance': setHeader('Desempenho'); viewPerformance(view); break;
      case 'settings': setHeader('Ajustes'); viewSettings(view); break;
      default: setHeader('Orihuela Consulting', 'carteiras · XP'); viewHome(view);
    }
    // Só volta ao topo quando a tela muda; um redesenho após editar mantém a rolagem.
    const key = r.name + '/' + (r.id || '');
    if (key !== lastRouteKey) { window.scrollTo(0, 0); lastRouteKey = key; }
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
    if (updateReady) {
      return h('div', { class: 'banner info' },
        h('p', { text: 'Há uma versão nova do aplicativo. Atualizar não apaga nada: as carteiras ficam guardadas.' }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', text: 'Agora não', onClick: () => { updateReady = false; render(); } }),
          h('button', { class: 'btn sm primary', text: 'Atualizar agora', onClick: applyUpdate })));
    }
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

    // Leitura em cima, toque embaixo: no iPhone o polegar alcança bem só a metade inferior.
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

    // Atualizar cotações é o que mais se faz: fica sempre no rodapé, ao alcance do polegar.
    setActionBar(actionRow(
      h('button', { class: 'btn primary grow', text: 'Atualizar cotações', onClick: () => startQuotesUpdate() }),
      h('button', { class: 'btn', style: 'width:56px;flex:none', 'aria-label': 'Atualizar usando um print', onClick: () => { quotesEditing = true; go('#/quotes'); pickShot(); } },
        svgEl('svg', { viewBox: '0 0 24 24', class: 'ic24' },
          svgEl('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
          svgEl('circle', { cx: 8.5, cy: 10, r: 1.6 }),
          svgEl('path', { d: 'M4 17l5-4.5 3.5 3L16 12l4 4' })))));

    view.appendChild(h('div', { class: 'nav-grid' },
      navCard('📈', 'Cotações', ts.length + (ts.length === 1 ? ' ação' : ' ações') + (lastQuote ? ' · ' + C.fmtDate(lastQuote) : ''), '#/quotes'),
      navCard('👥', 'Clientes', d.clients.length + (d.clients.length === 1 ? ' carteira' : ' carteiras'), '#/clients'),
      navCard('🏁', 'Desempenho', 'Todos lado a lado', '#/performance')));
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
  // Três caminhos para atualizar tudo: buscar de um serviço de cotações, conferir
  // olhando um print dentro do próprio app, ou digitar.
  let quotesEditing = false;
  let shot = null;          // { url, name } print anexado à conferência
  let shotOpen = 'aberto';   // aberto | grande | fechado
  let fetchInfo = null;     // { state, msg, got: {ticker: preço}, at }

  function quoteInputs(ts, map) {
    const inputs = {};
    const order = [];
    const list = h('div', { class: 'card tight' });
    ts.forEach(t => {
      const got = map && map[t.ticker];
      const inp = h('input', {
        type: 'text', inputmode: 'decimal', placeholder: '0,00', enterkeyhint: 'next',
        value: got != null ? C.fmtNum(got) : (t.price == null ? '' : C.fmtNum(t.price))
      });
      inp.addEventListener('focus', () => inp.select());
      // Enter pula para o próximo papel: dá para digitar a lista inteira sem tirar a mão do teclado.
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const i = order.indexOf(inp);
        const next = order[i + 1];
        if (next) { next.focus(); next.scrollIntoView({ block: 'center' }); } else inp.blur();
      });
      order.push(inp);
      inputs[t.ticker] = inp;
      const before = t.price == null ? 'sem cotação' : 'antes ' + C.fmtNum(t.price);
      const delta = got != null && t.price ? (got / t.price - 1) : null;
      list.appendChild(h('div', { class: 'quote-row' + (got != null ? ' filled' : '') },
        h('div', { class: 'tk' }, t.ticker,
          h('small', {}, before, delta != null ? h('span', { class: signCls(delta), text: '  ' + C.fmtPct(delta) }) : null)),
        inp));
    });
    return { inputs, list };
  }

  function viewQuotes(view) {
    const d = state.data;
    const ts = C.tickerSummary(d);
    if (!ts.length) {
      view.appendChild(h('div', { class: 'card' }, h('div', { class: 'empty', text: 'Nenhuma ação nas carteiras ainda. Adicione posições em um cliente.' })));
      return;
    }
    if (!quotesEditing) {
      setActionBar(actionRow(h('button', { class: 'btn primary grow', text: 'Atualizar cotações', onClick: () => startQuotesUpdate() })));
      const list = h('div', { class: 'card tight' });
      ts.forEach(t => {
        list.appendChild(h('button', { class: 'quote-row', style: 'width:100%;text-align:left', onClick: () => editSingleQuote(t.ticker) },
          h('div', { class: 'tk' }, t.ticker, h('small', { text: t.clients + (t.clients === 1 ? ' cliente' : ' clientes') + ' · ' + C.fmtInt(t.qty) + ' cotas' })),
          h('div', { class: 'price' },
            h('div', { class: 'v', text: t.price == null ? 'sem cotação' : C.fmtBRL(t.price) }),
            h('div', { class: 'd', text: t.at ? C.fmtDateTime(t.at) : 'toque para informar' }))));
      });
      view.appendChild(list);
      view.appendChild(h('p', { class: 'small muted', text: 'Todas as ações presentes em pelo menos uma carteira. Toque em uma linha para corrigir uma cotação isolada.' }));
      return;
    }

    // ----- modo conferência -----
    const { inputs, list } = quoteInputs(ts, fetchInfo && fetchInfo.got);

    // painel do print, grudado no topo enquanto a lista rola
    if (shot) {
      const img = h('img', { src: shot.url, alt: 'print das cotações' });
      const panel = h('div', { class: 'shot ' + shotOpen }, // aberto | grande | fechado
        h('div', { class: 'shot-img' }, img),
        h('div', { class: 'shot-bar' },
          h('button', { class: 'btn sm ghost', text: shotOpen === 'fechado' ? 'Mostrar' : shotOpen === 'grande' ? 'Menor' : 'Maior', onClick: () => { shotOpen = shotOpen === 'aberto' ? 'grande' : shotOpen === 'grande' ? 'fechado' : 'aberto'; render(); } }),
          h('button', { class: 'btn sm ghost', text: 'Trocar', onClick: () => pickShot() }),
          h('button', { class: 'btn sm ghost', text: 'Remover', onClick: () => { clearShot(); render(); } })));
      view.appendChild(panel);
    }

    // como preencher
    const tools = h('div', { class: 'btn-row' },
      h('button', { class: 'btn', text: 'Buscar cotações', onClick: e => runFetch(e.currentTarget) }),
      h('button', { class: 'btn', text: shot ? 'Trocar print' : 'Usar um print', onClick: () => pickShot() }));
    view.appendChild(tools);
    if (fetchInfo) {
      const cls = fetchInfo.state === 'ok' ? 'banner info' : fetchInfo.state === 'partial' ? 'banner' : 'banner';
      view.appendChild(h('div', { class: cls }, h('p', { text: fetchInfo.msg })));
    }

    view.appendChild(list);

    const dateInp = h('input', { type: 'date', value: C.localDateISO() });
    const snapChk = h('input', { type: 'checkbox', checked: true });
    const err = h('div', { class: 'form-error' });
    setActionBar([
      h('div', { class: 'row' }, h('div', { class: 'field inline' }, snapChk, h('label', { text: 'Registrar ponto em' })), dateInp),
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn', style: 'flex:1', text: 'Cancelar', onClick: () => { endQuotesUpdate(); render(); } }),
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
          endQuotesUpdate();
          toast(Object.keys(map).length + ' cotações salvas' + (snapChk.checked ? ' e ponto registrado.' : '.'));
          render();
        } }))
    ]);
  }

  function startQuotesUpdate() {
    quotesEditing = true; fetchInfo = null;
    go('#/quotes');
    render();
    // Com serviço pronto, já busca: o caminho de um toque só. Sem token configurado,
    // espera o usuário pedir, para não abrir a tela com um erro.
    if (quotesReady() && navigator.onLine) runFetch(null);
  }
  function endQuotesUpdate() { quotesEditing = false; fetchInfo = null; clearShot(); }
  function clearShot() { if (shot) { try { URL.revokeObjectURL(shot.url); } catch (e) { } } shot = null; shotOpen = 'aberto'; }

  // Print da corretora: fica visível no topo enquanto você confere os valores.
  function pickShot() {
    const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      clearShot();
      shot = { url: URL.createObjectURL(f), name: f.name || 'print' };
      shotOpen = 'aberto';
      if (!quotesEditing) { quotesEditing = true; }
      render();
    });
    inp.click();
  }

  function quotesReady() { return !!qp.url && (!!qp.token || qp.url.indexOf('{TOKEN}') < 0); }
  async function runFetch(btn) {
    if (!quotesReady()) {
      fetchInfo = { state: 'err', msg: 'Serviço de cotações sem token. Abra Ajustes, informe o token e volte aqui. Enquanto isso, use um print ou digite os preços.' };
      render(); return;
    }
    const wanted = C.tickers(state.data);
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
    fetchInfo = { state: 'loading', msg: 'Buscando cotações…' };
    try {
      const got = await fetchQuotes(wanted);
      const found = Object.keys(got);
      const missing = wanted.filter(t => got[t] == null);
      if (!found.length) fetchInfo = { state: 'err', msg: 'O serviço respondeu, mas nenhuma cotação foi reconhecida. Confira o endereço em Ajustes ou preencha pelo print.' };
      else fetchInfo = {
        state: missing.length ? 'partial' : 'ok', got,
        msg: found.length + ' de ' + wanted.length + ' cotações preenchidas.' + (missing.length ? ' Faltam: ' + missing.join(', ') + '. Preencha pelo print ou à mão.' : ' Confira e salve.')
      };
    } catch (e) {
      fetchInfo = { state: 'err', msg: 'Não foi possível buscar: ' + e.message };
    }
    render();
  }

  // Busca no serviço configurado e extrai os preços de forma tolerante ao formato.
  async function fetchQuotes(tickers) {
    const url = qp.url.replace('{TICKERS}', tickers.join(qp.sep || ',')).replace('{TOKEN}', encodeURIComponent(qp.token || ''));
    let res;
    try {
      res = await fetch(url, { cache: 'no-store', headers: qp.auth ? { Authorization: qp.auth } : undefined });
    } catch (e) {
      throw new Error('o serviço não respondeu ou recusou a conexão do app (CORS).');
    }
    if (!res.ok) throw new Error('o serviço respondeu ' + res.status + (res.status === 401 || res.status === 403 ? ' (token inválido?)' : ''));
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('a resposta não é JSON.'); }
    return extractQuotes(json, tickers);
  }
  // Procura, em qualquer formato de resposta, objetos que tenham um código e um preço.
  const SYM_KEYS = ['symbol', 'ticker', 'code', 'stock', 'papel', 'sigla'];
  const PRICE_KEYS = ['regularmarketprice', 'price', 'lastprice', 'last', 'close', 'closingprice', 'preco', 'preço', 'valor', 'cotacao', 'cotação', 'c', 'pu'];
  function extractQuotes(json, wanted) {
    const want = new Set(wanted.map(C.normTicker));
    const out = {};
    const seen = new Set();
    (function walk(node, keyHint) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { node.forEach(n => walk(n, keyHint)); return; }
      const keys = Object.keys(node);
      // objeto com código + preço
      let sym = null, price = null;
      keys.forEach(k => {
        const lk = k.toLowerCase();
        if (sym == null && SYM_KEYS.indexOf(lk) >= 0 && typeof node[k] === 'string') sym = C.normTicker(node[k]);
        if (price == null && PRICE_KEYS.indexOf(lk) >= 0) {
          const v = typeof node[k] === 'number' ? node[k] : C.parseNum(node[k]);
          if (Number.isFinite(v) && v > 0) price = v;
        }
      });
      // formato { "PETR4": 38.12 } ou { "PETR4": { price: ... } }
      keys.forEach(k => {
        const t = C.normTicker(k);
        if (want.has(t) && out[t] == null) {
          const v = node[k];
          if (typeof v === 'number' && v > 0) out[t] = v;
          else if (typeof v === 'string') { const n = C.parseNum(v); if (Number.isFinite(n) && n > 0) out[t] = n; }
        }
      });
      if (sym && price != null && want.has(sym) && out[sym] == null) out[sym] = price;
      keys.forEach(k => walk(node[k], k));
    })(json, null);
    return out;
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
    setActionBar(actionRow(h('button', { class: 'btn primary grow', text: '+ Novo cliente', onClick: () => addClientDialog() })));
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
        h('div', { class: 'delta num ' + signCls(r.ret), text: r.ret == null ? 'Rentabilidade indefinida: defina o capital aportado em Editar' : 'Rentabilidade acumulada ' + C.fmtPct(r.ret) })),
      h('div', { class: 'stats' },
        stat('Caixa', C.fmtBRL(r.cash)),
        stat('Investido', C.fmtBRL(r.invested), 'preço médio × cotas'),
        stat('Lucro em ações', C.fmtSignedBRL(r.profit), C.fmtPct(r.profitPct), signCls(r.profit))),
      h('div', { class: 'bonus-block' },
        stat('Carteira no último bônus', r.bonusBase ? C.fmtBRL(r.bonusBase.value) : '—', r.bonusBase && r.bonusBase.date ? 'em ' + C.fmtDate(r.bonusBase.date) : 'toque em Editar', '', 'big'),
        stat('vs. último bônus', r.vsBonus == null ? '—' : C.fmtPct(r.vsBonus), r.bonusBase ? C.fmtSignedBRL(r.total - r.bonusBase.value) : '', signCls(r.vsBonus), 'big'))));

    setActionBar(actionRow(
      h('button', { class: 'btn primary grow', text: 'Nova operação', onClick: () => txDialog(c) }),
      h('button', { class: 'btn', style: 'width:56px;flex:none', text: '•••', 'aria-label': 'Mais ações', onClick: () => clientMenu(c) })));

    // tabela de posições
    const tbl = h('div', { class: 'card tight' });
    if (!r.positions.length) tbl.appendChild(h('div', { class: 'empty', text: 'Sem ações na carteira. Use "+ Ação" ou registre uma compra.' }));
    else {
      const tbody = h('tbody');
      const money = n => C.fmtNum(n);
      const signed = n => (n > 0 ? '+' : n < 0 ? '-' : '') + C.fmtNum(Math.abs(n));
      r.positions.forEach(p => {
        tbody.appendChild(h('tr', { class: 'clickable', onClick: () => positionDialog(c, p.ticker) },
          h('td', {}, h('div', { class: 'tk' }, p.ticker,
            p.short ? h('span', { class: 'tag', text: 'vendida' }) : null,
            p.hasQuote ? null : h('span', { class: 'tag warn', text: 'sem cotação' }),
            h('small', {}, h('span', { class: 'qty-inline', text: C.fmtInt(p.qty) + ' cotas · ' }), 'PM ' + C.fmtNum(p.avgPrice), p.hasQuote ? h('span', { class: 'price-inline', text: ' · cot. ' + C.fmtNum(p.price) }) : null))),
          h('td', { class: 'num col-qty', text: C.fmtInt(p.qty) }),
          h('td', { class: 'num', text: money(p.value) }),
          h('td', { class: 'num', text: money(p.invested) }),
          h('td', { class: 'num ' + signCls(p.profit) }, signed(p.profit), h('span', { class: 'sub ' + signCls(p.profit), text: C.fmtPct(p.profitPct) }))));
      });
      tbl.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Ação' }), h('th', { class: 'col-qty', text: 'Cotas' }), h('th', {}, 'Valor ', h('span', { class: 'unit', text: 'R$' })), h('th', {}, 'Investido ', h('span', { class: 'unit', text: 'R$' })), h('th', {}, 'Lucro ', h('span', { class: 'unit', text: 'R$' })))),
        tbody,
        h('tfoot', {}, h('tr', {}, h('td', { text: 'Total' }), h('td', { class: 'col-qty' }), h('td', { class: 'num', text: money(r.stocks) }), h('td', { class: 'num', text: money(r.invested) }), h('td', { class: 'num ' + signCls(r.profit) }, signed(r.profit), h('span', { class: 'sub ' + signCls(r.profit), text: C.fmtPct(r.profitPct) })))))));
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
        const isTrade = !!C.TRADE_TYPES[t.type];
        list.appendChild(h('button', { class: 'list-item', onClick: () => txDetailDialog(c, t) },
          h('div', { class: 'main' },
            h('div', { class: 't1' }, h('span', { class: 'tx-type ' + t.type, text: C.TX_TYPES[t.type] }), isTrade ? t.ticker : (t.type === 'bonus' ? 'Nova base' : '')),
            h('div', { class: 't2', text: C.fmtDate(t.date) + (isTrade ? ' · ' + C.fmtInt(t.qty) + ' × ' + C.fmtNum(t.price) : '') + (t.note ? ' · ' + t.note : '') })),
          h('div', { class: 'right' },
            h('div', { class: 'v1 num', text: C.fmtBRL(t.value) }),
            t.result != null ? h('div', { class: 'v2 num ' + signCls(t.result), text: (t.cover ? 'recompra · resultado ' : 'resultado ') + C.fmtSignedBRL(t.result) + ' (' + C.fmtPct(t.resultPct) + ')' }) : null)));
      });
      txCard.appendChild(list);
    }
    view.appendChild(txCard);
  }
  // Ações secundárias da carteira, numa folha que sobe do rodapé.
  function clientMenu(c) {
    const item = (icon, label, sub, onClick) => h('button', { onClick: () => { closeModal(); onClick(); } },
      h('span', { class: 'ic', text: icon }),
      h('span', {}, label, sub ? h('span', { class: 'sub', text: sub }) : null));
    openModal(c.name, [
      h('div', { class: 'sheet-menu' },
        item('＋', 'Adicionar ação', 'cotas e preço médio, sem mexer no caixa', () => positionDialog(c, null)),
        item('✎', 'Editar cliente', 'nome, caixa, capital e base do bônus', () => editClientDialog(c)),
        item('◉', 'Registrar ponto agora', 'novo ponto no gráfico com a data de hoje', () => { mutate(data => C.snapshotClient(data, c)); toast('Ponto de hoje registrado.'); }),
        item('▤', 'Ponto manual', 'patrimônio de uma data passada', () => manualPointDialog(c)),
        item('‹', 'Voltar para os clientes', '', () => go('#/clients'))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', style: 'flex:1', text: 'Fechar', onClick: closeModal }))
    ]);
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
        let ret = v.ret.trim() ? C.parseNum(v.ret) / 100 : (c.capital > 0 ? total / c.capital - 1 : null);
        if (ret !== null && !Number.isFinite(ret)) throw new Error('Rentabilidade inválida.');
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
        { key: 'qty', label: 'Quantidade de cotas', type: 'decimal', value: pos ? String(pos.qty) : '', hint: 'Negativa = posição vendida (aluguel tomador).' },
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
        { key: 'ticker', label: 'Ação', type: 'ticker', value: '', placeholder: 'Ex.: PETR4', showIf: v => !!C.TRADE_TYPES[v.type] },
        { key: 'qty', label: 'Quantidade', type: 'decimal', value: '', showIf: v => !!C.TRADE_TYPES[v.type], hint: 'Para recomprar uma posição vendida, registre uma Compra.' },
        { key: 'price', label: 'Preço por ação (R$)', type: 'decimal', value: '', showIf: v => !!C.TRADE_TYPES[v.type] },
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
        if (rec.result != null) toast((rec.cover ? 'Recompra' : 'Venda') + ' registrada. Resultado: ' + C.fmtSignedBRL(rec.result) + ' (' + C.fmtPct(rec.resultPct) + ').');
        else toast(C.TX_TYPES[rec.type] + ' registrada.');
      }
    });
  }
  function txDetailDialog(c, t) {
    const isLast = C.isLastTransaction(c, t.id);
    const rows = [['Tipo', C.TX_TYPES[t.type]], ['Data', C.fmtDate(t.date)]];
    if (t.ticker) rows.push(['Ação', t.ticker], ['Quantidade', C.fmtInt(t.qty)], ['Preço', C.fmtBRL(t.price)]);
    rows.push(['Valor', C.fmtBRL(t.value)]);
    if (t.result != null) rows.push([t.cover ? 'Preço médio da venda' : 'Preço médio na venda', C.fmtBRL(t.avgPrice)], ['Resultado', C.fmtSignedBRL(t.result) + ' (' + C.fmtPct(t.resultPct) + ')']);
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
      ret: (a, b) => (b.ret == null ? -Infinity : b.ret) - (a.ret == null ? -Infinity : a.ret),
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

    // Serviço de cotações
    const q = {};
    const qCard = h('div', { class: 'card' }, h('h2', { text: 'Serviço de cotações' }),
      h('p', { class: 'small dim', style: 'margin-bottom:10px', text: 'Com um serviço configurado, o botão "Atualizar cotações" na tela inicial busca todos os preços de uma vez. O padrão é a brapi.dev, que cobre ações, BDRs, ETFs e fundos imobiliários da B3: crie uma conta gratuita lá e cole o token abaixo. {TICKERS} e {TOKEN} são substituídos na hora da busca.' }));
    q.url = h('input', { type: 'text', value: qp.url, autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    qCard.appendChild(h('div', { class: 'field' }, h('label', { text: 'Endereço' }), q.url));
    q.token = h('input', { type: 'password', value: qp.token, placeholder: 'token do serviço', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    qCard.appendChild(h('div', { class: 'field' }, h('label', { text: 'Token' }), q.token,
      h('div', { class: 'hint', text: 'Fica apenas neste aparelho.' })));
    const qMsg = h('div', { class: 'form-error' });
    qCard.appendChild(qMsg);
    qCard.appendChild(h('div', { class: 'btn-row', style: 'margin:0' },
      h('button', { class: 'btn primary', text: 'Salvar', onClick: () => {
        qp.url = q.url.value.trim(); qp.token = q.token.value.trim();
        save(LS.qp, qp); toast('Serviço salvo.');
      } }),
      h('button', { class: 'btn', text: 'Testar', onClick: async e => {
        qp.url = q.url.value.trim(); qp.token = q.token.value.trim();
        const tk = C.tickers(state.data).slice(0, 3);
        if (!tk.length) { qMsg.textContent = 'Cadastre ao menos uma ação antes de testar.'; return; }
        qMsg.textContent = 'Testando com ' + tk.join(', ') + '…';
        try {
          const got = await fetchQuotes(tk);
          const n = Object.keys(got).length;
          qMsg.textContent = n ? '' : 'Respondeu, mas nenhum preço foi reconhecido.';
          if (n) toast(n + ' de ' + tk.length + ' reconhecidos: ' + Object.keys(got).map(t => t + ' ' + C.fmtNum(got[t])).join(', '));
        } catch (err) { qMsg.textContent = 'Falha: ' + err.message; }
      } })));
    view.appendChild(qCard);

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

    view.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Versão do aplicativo' }),
      h('div', { class: 'status-line', style: 'flex-direction:column;gap:4px;margin-bottom:12px' },
        h('span', {}, 'Orihuela Consulting · versão ', h('b', { text: APP_VERSION })),
        h('span', { text: updateReady ? 'Versão nova pronta para instalar.' : 'Atualizar troca só o código; as carteiras continuam salvas.' })),
      h('div', { class: 'btn-row', style: 'margin:0' },
        updateReady
          ? h('button', { class: 'btn primary', text: 'Instalar versão nova', onClick: applyUpdate })
          : h('button', { class: 'btn', text: 'Procurar atualização', onClick: () => checkUpdate(true) }))));

    view.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Sobre' }),
      h('div', { class: 'status-line', style: 'flex-direction:column;gap:4px' },
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
      const lpts = pts.filter(p => Number.isFinite(p[key])); // pontos com valor nesta camada
      const g = svgEl('g');
      g.appendChild(svgEl('text', { x: ML, y: top + 12, class: 'panel-title' }, s.label.toUpperCase()));
      if (!lpts.length) {
        g.appendChild(svgEl('text', { x: ML, y: top + MT + 40, class: 'axis' }, key === 'ret' ? 'Sem rentabilidade: defina o capital aportado em Editar.' : 'Sem dados.'));
        svg.appendChild(g);
        panelsMeta.push({ key, Y: () => top + MT, top, empty: true });
        return;
      }
      const lxs = lpts.map(p => new Date(p.date + 'T12:00:00').getTime());
      const vals = lpts.map(p => p[key]);
      let vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals);
      if (key === 'ret') { vmin = Math.min(vmin, 0); vmax = Math.max(vmax, 0); }
      const nt = niceTicks(vmin, vmax, 4);
      const Y = v => top + MT + (1 - (v - nt.lo) / ((nt.hi - nt.lo) || 1)) * (PH - MT - 6);
      // grade + eixo y
      const grid = svgEl('g', { class: 'grid' }), axis = svgEl('g', { class: 'axis' });
      nt.ticks.forEach(v => {
        grid.appendChild(svgEl('line', { x1: ML, x2: W - MR, y1: Y(v), y2: Y(v), class: key === 'ret' && Math.abs(v) < 1e-12 ? 'zero' : '' }));
        axis.appendChild(svgEl('text', { x: ML - 6, y: Y(v) + 3, 'text-anchor': 'end' }, s.tick(v)));
      });
      g.appendChild(grid); g.appendChild(axis);
      // área e linha
      if (lpts.length > 1) {
        const d = lpts.map((p, j) => (j ? 'L' : 'M') + X(lxs[j]).toFixed(1) + ' ' + Y(p[key]).toFixed(1)).join(' ');
        const base = Y(key === 'ret' ? Math.max(nt.lo, Math.min(0, nt.hi)) : nt.lo);
        g.appendChild(svgEl('path', { class: 'area', fill: s.color, d: d + ' L' + X(lxs[lxs.length - 1]).toFixed(1) + ' ' + base.toFixed(1) + ' L' + X(lxs[0]).toFixed(1) + ' ' + base.toFixed(1) + ' Z' }));
        g.appendChild(svgEl('path', { class: 'line', stroke: s.color, d }));
      }
      const last = lpts[lpts.length - 1];
      g.appendChild(svgEl('circle', { class: 'dot', cx: X(lxs[lxs.length - 1]), cy: Y(last[key]), r: 4, fill: s.color }));
      // rótulo do último valor
      const lx = X(lxs[lxs.length - 1]), ly = Y(last[key]);
      const label = s.fmt(last[key]);
      const anchor = lx > W - MR - 90 ? 'end' : 'start';
      const labelY = ly - 8 < top + MT + 4 ? ly + 16 : ly - 8; // perto do topo do painel, escreve abaixo do ponto
      g.appendChild(svgEl('text', { class: 'end-label', x: anchor === 'end' ? lx - 8 : lx + 8, y: labelY, 'text-anchor': anchor }, label));
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
      panelsMeta.forEach((m, i) => {
        if (m.empty || !Number.isFinite(p[m.key])) { dots[i].style.display = 'none'; return; }
        dots[i].setAttribute('cx', cx); dots[i].setAttribute('cy', m.Y(p[m.key])); dots[i].style.display = '';
      });
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
  // ---------- atualização do app ----------
  // Os dados moram no localStorage e no data.json do servidor, então recarregar para
  // pegar uma versão nova nunca apaga carteira: só troca o código do app.
  let swReg = null, updateReady = false, checking = false;
  function setupUpdates() {
    if (!('serviceWorker' in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
      swReg = reg;
      if (reg.waiting && hadController) { updateReady = true; render(); }
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) { updateReady = true; render(); }
        });
      });
    }).catch(() => { });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) { updateReady = true; render(); }
      hadController = true;
    });
    // procura versão nova ao voltar para o app e de tempos em tempos
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
    setInterval(checkUpdate, 30 * 60 * 1000);
  }
  function checkUpdate(manual) {
    if (!swReg || !navigator.onLine) { if (manual) toast('Sem conexão para procurar atualização.', true); return; }
    if (checking) return;
    checking = true;
    swReg.update().then(() => {
      setTimeout(() => {
        checking = false;
        if (manual && !updateReady) toast('Você já está na versão mais recente.');
      }, 2500);
    }).catch(() => { checking = false; if (manual) toast('Não foi possível procurar atualização.', true); });
  }
  function applyUpdate() {
    // Edições locais ainda não enviadas ficam no localStorage e sobrevivem ao reload.
    if (swReg && swReg.waiting) { try { swReg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { } }
    setTimeout(() => location.reload(), 150);
  }

  function init() {
    setupUpdates();
    if (!pinCfg.get()) showLock('setup'); else showLock('unlock');
    render();
    syncFromRemote({});
  }
  init();
})();
