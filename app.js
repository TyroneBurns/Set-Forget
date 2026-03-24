const state = {
  clientId: localStorage.getItem('saf-client-id') || null,
  appName: 'Set & Forget',
  selectedPairKey: null,
  selectedSignal: null,
  latestMap: {},
  watchlist: [],
  trades: [],
  history: [],
  positions: {},
  account: { startingBalance: 10000, realizedPnl: 0 },
  settings: {},
  push: { configured: false, publicKey: null },
  realtime: { enabled: false, authUrl: null },
  swRegistration: null,
  refreshTimer: null,
  ably: null,
  realtimeChannels: [],
};

const els = {
  pairSelect: document.getElementById('pairSelect'),
  tradeSizeInput: document.getElementById('tradeSizeInput'),
  settingsToggle: document.getElementById('settingsToggle'),
  settingsClose: document.getElementById('settingsClose'),
  settingsPanel: document.getElementById('settingsPanel'),
  watchSymbolInput: document.getElementById('watchSymbolInput'),
  watchIntervalInput: document.getElementById('watchIntervalInput'),
  addWatchBtn: document.getElementById('addWatchBtn'),
  autoTradeToggle: document.getElementById('autoTradeToggle'),
  exitOnChopToggle: document.getElementById('exitOnChopToggle'),
  pushBtn: document.getElementById('pushBtn'),
  minConfidenceInput: document.getElementById('minConfidenceInput'),
  lengthInput: document.getElementById('lengthInput'),
  bullStayInput: document.getElementById('bullStayInput'),
  bearStayInput: document.getElementById('bearStayInput'),
  chopStayInput: document.getElementById('chopStayInput'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  heroPairText: document.getElementById('heroPairText'),
  signalBadge: document.getElementById('signalBadge'),
  lastPriceText: document.getElementById('lastPriceText'),
  regimeText: document.getElementById('regimeText'),
  updatedText: document.getElementById('updatedText'),
  bullPct: document.getElementById('bullPct'),
  bearPct: document.getElementById('bearPct'),
  chopPct: document.getElementById('chopPct'),
  buyBtn: document.getElementById('buyBtn'),
  sellBtn: document.getElementById('sellBtn'),
  closeBtn: document.getElementById('closeBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  modeText: document.getElementById('modeText'),
  confidenceText: document.getElementById('confidenceText'),
  realizedText: document.getElementById('realizedText'),
  positionText: document.getElementById('positionText'),
  positionCard: document.getElementById('positionCard'),
  watchlistGrid: document.getElementById('watchlistGrid'),
  historyList: document.getElementById('historyList'),
  tradeList: document.getElementById('tradeList'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  tabPanels: Array.from(document.querySelectorAll('.tab-panel')),
  statusBar: document.getElementById('statusBar'),
};

function showStatus(message, tone = 'info', persistMs = 2600) {
  if (!message) {
    els.statusBar.textContent = '';
    els.statusBar.className = 'status-bar hidden';
    return;
  }
  els.statusBar.textContent = message;
  els.statusBar.className = `status-bar ${tone === 'error' ? 'error' : tone === 'success' ? 'success' : ''}`.trim();
  if (persistMs > 0) {
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => showStatus(''), persistMs);
  }
}

function fmtNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  if (Math.abs(num) < 1) return fmtNumber(num, 6);
  if (Math.abs(num) < 100) return fmtNumber(num, 4);
  return fmtNumber(num, 2);
}

function fmtPct(value) { return `${fmtNumber(value, 2)}%`; }
function fmtDate(value) {
  const date = new Date(value);
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function localClientId() {
  if (!state.clientId) {
    state.clientId = `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('saf-client-id', state.clientId);
  }
  return state.clientId;
}

function getSelectedPair() {
  const fallback = state.selectedPairKey || els.pairSelect.value || 'BTCUSDT|15m';
  const [symbol, interval] = fallback.split('|');
  return { symbol, interval, pairKey: fallback };
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function renderPairSelect() {
  els.pairSelect.innerHTML = '';
  state.watchlist.forEach(item => {
    const key = `${item.symbol}|${item.interval}`;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${item.symbol} · ${item.interval}`;
    option.selected = key === state.selectedPairKey;
    els.pairSelect.appendChild(option);
  });
}

function renderSignal() {
  const pair = getSelectedPair();
  const latest = state.latestMap[pair.pairKey];
  els.heroPairText.textContent = `${pair.symbol} · ${pair.interval}`;

  if (!latest) {
    els.signalBadge.textContent = 'FLAT';
    els.signalBadge.className = 'signal-badge neutral';
    els.lastPriceText.textContent = '-';
    els.regimeText.textContent = 'Waiting for live market data';
    els.updatedText.textContent = 'Not updated yet';
    els.bullPct.textContent = '0%';
    els.bearPct.textContent = '0%';
    els.chopPct.textContent = '0%';
    els.confidenceText.textContent = '-';
    return;
  }

  const tone = latest.signal === 'LONG' ? 'long' : latest.signal === 'SHORT' ? 'short' : 'neutral';
  els.signalBadge.textContent = latest.signal;
  els.signalBadge.className = `signal-badge ${tone}`;
  els.lastPriceText.textContent = fmtPrice(latest.price);
  els.regimeText.textContent = `${latest.regime} · ${fmtPct(latest.confidence)} confidence`;
  els.updatedText.textContent = `Updated ${fmtDate(latest.time || latest.ts || Date.now())}`;
  els.bullPct.textContent = fmtPct(latest.bull);
  els.bearPct.textContent = fmtPct(latest.bear);
  els.chopPct.textContent = fmtPct(latest.chop);
  els.confidenceText.textContent = fmtPct(latest.confidence);
  state.selectedSignal = latest.signal;
}

function renderWatchlist() {
  els.watchlistGrid.innerHTML = '';
  state.watchlist.forEach(item => {
    const key = `${item.symbol}|${item.interval}`;
    const latest = state.latestMap[key];
    const selected = key === state.selectedPairKey;
    const el = document.createElement('article');
    el.className = `watch-item ${selected ? 'selected' : ''}`;
    const tone = latest ? latest.signal : 'FLAT';
    el.innerHTML = `
      <div class="watch-head">
        <div>
          <strong>${item.symbol}</strong>
          <div class="small-meta">${item.interval}</div>
        </div>
        <span class="feed-pill">${tone}</span>
      </div>
      <p class="feed-copy">${latest ? `${latest.regime} · ${fmtPct(latest.confidence)} · ${fmtPrice(latest.price)}` : 'No live read yet'}</p>
      <div class="watch-actions">
        <button class="inline-btn" data-action="select" data-key="${key}">Open</button>
        <button class="inline-btn" data-action="remove" data-key="${key}">Remove</button>
      </div>
    `;
    els.watchlistGrid.appendChild(el);
  });
}

function renderHistory() {
  els.historyList.innerHTML = '';
  if (!state.history.length) {
    els.historyList.innerHTML = `<article class="feed-item"><p class="feed-copy">No saved signal flips yet.</p></article>`;
    return;
  }
  state.history.forEach(item => {
    const el = document.createElement('article');
    el.className = 'feed-item';
    el.innerHTML = `
      <div class="feed-top">
        <strong>${item.symbol} · ${item.interval}</strong>
        <span class="feed-pill">${item.signal}</span>
      </div>
      <p class="feed-copy"><strong>${item.regime}</strong> at ${fmtPrice(item.price)} · ${fmtPct(item.confidence)} confidence</p>
      <p class="small-meta">${fmtDate(item.ts || item.time || Date.now())}</p>
    `;
    els.historyList.appendChild(el);
  });
}

function renderTrades() {
  els.tradeList.innerHTML = '';
  if (!state.trades.length) {
    els.tradeList.innerHTML = `<article class="feed-item"><p class="feed-copy">No trades yet. Manual and auto trades will land here.</p></article>`;
    return;
  }
  state.trades.forEach(item => {
    const pnl = Number(item.realizedPnl || 0);
    const pnlText = pnl ? ` · PnL ${fmtNumber(pnl, 2)}` : '';
    const el = document.createElement('article');
    el.className = 'feed-item';
    el.innerHTML = `
      <div class="feed-top">
        <strong>${item.action} · ${item.symbol} ${item.interval}</strong>
        <span class="feed-pill">${item.mode}</span>
      </div>
      <p class="feed-copy">${item.side || ''} at <strong>${fmtPrice(item.price)}</strong> · size <strong>${fmtNumber(item.sizeQuote, 2)}</strong>${pnlText}</p>
      <p class="small-meta">${fmtDate(item.ts)}</p>
    `;
    els.tradeList.appendChild(el);
  });
}

function updateOverview() {
  const pair = getSelectedPair();
  const position = state.positions[pair.pairKey];
  els.modeText.textContent = state.settings.autoTrade ? 'Auto' : 'Manual';
  els.realizedText.textContent = fmtNumber(state.account.realizedPnl || 0, 2);
  els.positionText.textContent = position ? `${position.side} · ${fmtPrice(position.entryPrice)}` : 'None';

  if (!position) {
    els.positionCard.className = 'position-card empty';
    els.positionCard.textContent = 'No open position.';
  } else {
    els.positionCard.className = 'position-card';
    els.positionCard.innerHTML = `
      <div class="feed-top">
        <strong>${position.side}</strong>
        <span class="feed-pill">${fmtNumber(position.sizeQuote, 2)} size</span>
      </div>
      <p class="feed-copy">Entry <strong>${fmtPrice(position.entryPrice)}</strong> · Qty <strong>${fmtNumber(position.qty, 6)}</strong></p>
    `;
  }

  renderWatchlist();
  renderTrades();
}

async function loadAppState() {
  const data = await api(`/api/state?clientId=${encodeURIComponent(localClientId())}`);
  state.clientId = data.clientId;
  localStorage.setItem('saf-client-id', data.clientId);
  state.appName = data.appName || 'Set & Forget';
  state.watchlist = data.watchlist || [];
  state.selectedPairKey = data.selectedPairKey || (state.watchlist[0] ? `${state.watchlist[0].symbol}|${state.watchlist[0].interval}` : 'BTCUSDT|15m');
  state.trades = data.trades || [];
  state.positions = data.positions || {};
  state.account = data.account || state.account;
  state.settings = data.settings || {};
  state.push = data.push || state.push;
  state.realtime = data.realtime || state.realtime;

  document.title = data.appName || 'Set & Forget';
  els.tradeSizeInput.value = data.tradeSize || 100;
  els.autoTradeToggle.checked = !!state.settings.autoTrade;
  els.exitOnChopToggle.checked = state.settings.exitOnChop !== false;
  els.minConfidenceInput.value = state.settings.minConfidence || 55;
  els.lengthInput.value = state.settings.length || 20;
  els.bullStayInput.value = state.settings.pStayBull || 0.8;
  els.bearStayInput.value = state.settings.pStayBear || 0.8;
  els.chopStayInput.value = state.settings.pStayChop || 0.6;
  renderPairSelect();
  renderSignal();
  updateOverview();
}

async function fetchSignal(pairKey) {
  const data = await api(`/api/signal?clientId=${encodeURIComponent(localClientId())}&pairKey=${encodeURIComponent(pairKey)}`);
  state.latestMap[pairKey] = data.latest;
  return data.latest;
}

async function refreshSelectedSignal() {
  const pair = getSelectedPair();
  await fetchSignal(pair.pairKey);
  renderSignal();
  updateOverview();
}

async function refreshWatchSignals() {
  await Promise.all(state.watchlist.map(async item => {
    const key = `${item.symbol}|${item.interval}`;
    try {
      await fetchSignal(key);
    } catch (error) {
      console.error(error);
    }
  }));
  renderSignal();
  updateOverview();
}

async function loadHistory() {
  const pair = getSelectedPair();
  const data = await api(`/api/history?clientId=${encodeURIComponent(localClientId())}&pairKey=${encodeURIComponent(pair.pairKey)}`);
  state.history = data.history || [];
  renderHistory();
}

async function savePrefs(payload = {}) {
  const response = await api('/api/preferences', {
    method: 'POST',
    body: JSON.stringify({ clientId: localClientId(), ...payload }),
  });
  state.settings = response.settings || state.settings;
  return response;
}

async function saveTradeSize() {
  await savePrefs({ tradeSize: Number(els.tradeSizeInput.value || 100) });
  showStatus('Trade size saved', 'success');
}

async function addWatch() {
  const symbol = (els.watchSymbolInput.value || '').trim().toUpperCase();
  const interval = els.watchIntervalInput.value || '15m';
  if (!symbol) return;
  const data = await api('/api/watchlist', {
    method: 'POST',
    body: JSON.stringify({ clientId: localClientId(), action: 'add', symbol, interval }),
  });
  state.watchlist = data.watchlist || state.watchlist;
  state.selectedPairKey = data.selectedPairKey || state.selectedPairKey;
  renderPairSelect();
  els.watchSymbolInput.value = '';
  await refreshWatchSignals();
  await loadHistory();
  subscribeRealtime();
  showStatus(`${symbol} added to watchlist`, 'success');
}

async function removeWatch(pairKey) {
  const data = await api('/api/watchlist', {
    method: 'POST',
    body: JSON.stringify({ clientId: localClientId(), action: 'remove', pairKey }),
  });
  state.watchlist = data.watchlist || state.watchlist;
  state.selectedPairKey = data.selectedPairKey || state.selectedPairKey;
  renderPairSelect();
  await refreshWatchSignals();
  await loadHistory();
  subscribeRealtime();
  showStatus('Pair removed', 'success');
}

async function selectPair(pairKey) {
  state.selectedPairKey = pairKey;
  els.pairSelect.value = pairKey;
  await savePrefs({ selectedPairKey: pairKey });
  await refreshSelectedSignal();
  await loadHistory();
  subscribeRealtime();
}

function activateTab(name) {
  els.tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === name));
  els.tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
}

async function executeTrade(action) {
  const pair = getSelectedPair();
  const latest = state.latestMap[pair.pairKey];
  if (!latest) {
    showStatus('Load a signal first', 'error');
    return;
  }
  const data = await api('/api/trades', {
    method: 'POST',
    body: JSON.stringify({
      clientId: localClientId(),
      symbol: pair.symbol,
      interval: pair.interval,
      action,
      price: latest.price,
      sizeQuote: Number(els.tradeSizeInput.value || 100),
    }),
  });
  state.trades = data.trades || [];
  state.positions = data.positions || {};
  state.account = data.account || state.account;
  updateOverview();
  if (navigator.vibrate) navigator.vibrate(16);
  showStatus(`${action} logged`, 'success');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    state.swRegistration = await navigator.serviceWorker.register('/service-worker.js');
  } catch (error) {
    console.error(error);
  }
}

async function enablePush() {
  if (!state.push.configured) {
    showStatus('Push not configured on the server yet', 'error', 3600);
    return;
  }
  if (!state.swRegistration) await setupServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    showStatus('Notifications are blocked on this device', 'error', 3600);
    return;
  }
  const existing = await state.swRegistration.pushManager.getSubscription();
  const subscription = existing || await state.swRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(state.push.publicKey),
  });
  await api('/api/push-subscribe', {
    method: 'POST',
    body: JSON.stringify({ clientId: localClientId(), subscription }),
  });
  els.pushBtn.textContent = 'Push enabled';
  showStatus('Background push enabled', 'success');
}

async function saveSettings() {
  await savePrefs({
    tradeSize: Number(els.tradeSizeInput.value || 100),
    settings: {
      autoTrade: els.autoTradeToggle.checked,
      exitOnChop: els.exitOnChopToggle.checked,
      minConfidence: Number(els.minConfidenceInput.value || 55),
      length: Number(els.lengthInput.value || 20),
      pStayBull: Number(els.bullStayInput.value || 0.8),
      pStayBear: Number(els.bearStayInput.value || 0.8),
      pStayChop: Number(els.chopStayInput.value || 0.6),
    },
  });
  await scanNow();
  showStatus('Settings saved', 'success');
}

function clearRealtimeChannels() {
  if (!state.ably || !state.realtimeChannels.length) return;
  state.realtimeChannels.forEach(channel => {
    try {
      channel.unsubscribe();
      state.ably.channels.release(channel.name);
    } catch (error) {
      console.error(error);
    }
  });
  state.realtimeChannels = [];
}

async function setupRealtime() {
  if (!state.realtime.enabled || !window.Ably || state.ably) return;
  state.ably = new window.Ably.Realtime.Promise({
    authUrl: `${state.realtime.authUrl}?clientId=${encodeURIComponent(localClientId())}`,
    clientId: localClientId(),
    autoConnect: true,
  });
  subscribeRealtime();
}

function subscribeRealtime() {
  if (!state.ably) return;
  clearRealtimeChannels();

  const clientChannel = state.ably.channels.get(`client:${localClientId()}`);
  clientChannel.subscribe('refresh', async () => {
    try {
      await loadAppState();
      await loadHistory();
      await refreshSelectedSignal();
    } catch (error) {
      console.error(error);
    }
  });
  state.realtimeChannels.push(clientChannel);

  const pair = getSelectedPair();
  const pairChannel = state.ably.channels.get(`pair:${pair.pairKey}`);
  pairChannel.subscribe('signal', async message => {
    try {
      if (message && message.data && message.data.latest) state.latestMap[pair.pairKey] = message.data.latest;
      await refreshSelectedSignal();
      await loadHistory();
    } catch (error) {
      console.error(error);
    }
  });
  state.realtimeChannels.push(pairChannel);
}

async function scanNow() {
  const data = await api(`/api/scan?clientId=${encodeURIComponent(localClientId())}`);
  state.latestMap = { ...state.latestMap, ...(data.latestMap || {}) };
  state.trades = data.trades || state.trades;
  state.positions = data.positions || state.positions;
  state.account = data.account || state.account;
  renderSignal();
  updateOverview();
}

async function refreshAll() {
  await refreshWatchSignals();
  await scanNow();
  await loadHistory();
}

function bindEvents() {
  els.settingsToggle.addEventListener('click', () => els.settingsPanel.classList.toggle('hidden'));
  els.settingsClose.addEventListener('click', () => els.settingsPanel.classList.add('hidden'));
  els.addWatchBtn.addEventListener('click', () => addWatch().catch(handleError));
  els.pushBtn.addEventListener('click', () => enablePush().catch(handleError));
  els.saveSettingsBtn.addEventListener('click', () => saveSettings().catch(handleError));
  els.tradeSizeInput.addEventListener('change', () => saveTradeSize().catch(handleError));
  els.pairSelect.addEventListener('change', () => selectPair(els.pairSelect.value).catch(handleError));
  els.buyBtn.addEventListener('click', () => executeTrade('BUY').catch(handleError));
  els.sellBtn.addEventListener('click', () => executeTrade('SELL').catch(handleError));
  els.closeBtn.addEventListener('click', () => executeTrade('CLOSE').catch(handleError));
  els.refreshBtn.addEventListener('click', () => refreshAll().catch(handleError));
  els.tabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

  els.watchlistGrid.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const key = button.dataset.key;
    if (action === 'select') {
      selectPair(key).then(() => activateTab('overview')).catch(handleError);
    } else if (action === 'remove') {
      removeWatch(key).catch(handleError);
    }
  });
}

function handleError(error) {
  console.error(error);
  showStatus(error.message || 'Something went wrong', 'error', 5000);
}

async function boot() {
  bindEvents();
  await setupServiceWorker();
  await loadAppState();
  await refreshWatchSignals();
  await scanNow();
  await loadHistory();
  await setupRealtime();
  activateTab('overview');

  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    refreshAll().catch(console.error);
  }, 20000);

  const params = new URLSearchParams(window.location.search);
  const pair = params.get('pair');
  if (pair) await selectPair(pair);

  showStatus('App ready', 'success');
}

boot().catch(handleError);
