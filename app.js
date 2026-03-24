import { runHmmRegime, getTradeDecision } from './signal-engine.js';

const state = {
  appName: 'Set & Forget',
  pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  currentPair: 'BTCUSDT',
  timeframe: '15m',
  size: 100,
  threshold: 65,
  refreshSeconds: 15,
  mode: 'manual',
  signal: { state: 'NO TRADE', bull: 0, bear: 0, chop: 0, confidence: 0, spread: 0, quality: 0, adaptiveThreshold: 65, decision: 'HOLD' },
  lastPrice: null,
  markets: [],
  signalHistory: load('sf_signal_history', []),
  trades: load('sf_trades', []),
  openPosition: load('sf_open_position', null),
  pnl: load('sf_realised_pnl', 0),
  ably: null,
  channel: null
};

const el = {
  appName: q('#appName'),
  pairSelect: q('#pairSelect'),
  sizeInput: q('#sizeInput'),
  timeframeSelect: q('#timeframeSelect'),
  modeSelect: q('#modeSelect'),
  thresholdInput: q('#thresholdInput'),
  refreshInput: q('#refreshInput'),
  gearBtn: q('#gearBtn'),
  settings: q('#settings'),
  pairBig: q('#pairBig'),
  stateBadge: q('#stateBadge'),
  lastPrice: q('#lastPrice'),
  statusText: q('#statusText'),
  bullPct: q('#bullPct'),
  bearPct: q('#bearPct'),
  chopPct: q('#chopPct'),
  qualityValue: q('#qualityValue'),
  adaptiveValue: q('#adaptiveValue'),
  buyBtn: q('#buyBtn'),
  sellBtn: q('#sellBtn'),
  closeBtn: q('#closeBtn'),
  refreshBtn: q('#refreshBtn'),
  notice: q('#notice'),
  modeStat: q('#modeStat'),
  confidenceStat: q('#confidenceStat'),
  qualityStat: q('#qualityStat'),
  adaptiveStat: q('#adaptiveStat'),
  pnlStat: q('#pnlStat'),
  positionStat: q('#positionStat'),
  dayReturnStat: q('#dayReturnStat'),
  weekReturnStat: q('#weekReturnStat'),
  marketsList: q('#marketsList'),
  signalsList: q('#signalsList'),
  tradesList: q('#tradesList')
};

async function boot() {
  bindUI();
  await loadConfig();
  populatePairs();
  renderAll();
  await setupAbly();
  await refreshAll();
  setInterval(() => refreshAll(), state.refreshSeconds * 1000);
}

function bindUI() {
  el.gearBtn.addEventListener('click', () => el.settings.classList.toggle('open'));
  el.pairSelect.addEventListener('change', async (e) => { state.currentPair = e.target.value; renderHero(); await refreshActivePair(); });
  el.sizeInput.addEventListener('change', (e) => { state.size = Number(e.target.value || 100); });
  el.timeframeSelect.addEventListener('change', async (e) => { state.timeframe = e.target.value; renderHero(); await refreshAll(); });
  el.modeSelect.addEventListener('change', (e) => { state.mode = e.target.value; renderOverview(); });
  el.thresholdInput.addEventListener('change', (e) => { state.threshold = Number(e.target.value || 65); });
  el.refreshInput.addEventListener('change', (e) => { state.refreshSeconds = Number(e.target.value || 15); });
  el.buyBtn.addEventListener('click', () => manualTrade('BUY'));
  el.sellBtn.addEventListener('click', () => manualTrade('SELL'));
  el.closeBtn.addEventListener('click', closePosition);
  el.refreshBtn.addEventListener('click', refreshAll);
  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Config failed');
    const cfg = await res.json();
    state.appName = cfg.appName || state.appName;
    state.pairs = cfg.defaultPairs?.length ? cfg.defaultPairs : state.pairs;
    state.currentPair = state.pairs[0];
    state.timeframe = cfg.defaultTimeframe || state.timeframe;
    el.appName.textContent = state.appName;
    el.timeframeSelect.value = state.timeframe;
  } catch {
    el.notice.textContent = 'Using local defaults. Config route not available.';
  }
}

function populatePairs() {
  el.pairSelect.innerHTML = '';
  state.pairs.forEach((pair) => {
    const option = document.createElement('option');
    option.value = pair;
    option.textContent = pair;
    el.pairSelect.appendChild(option);
  });
  el.pairSelect.value = state.currentPair;
}

async function setupAbly() {
  try {
    const res = await fetch('/api/ably-token');
    const data = await res.json();
    if (!data.enabled || !window.Ably) {
      el.notice.textContent = 'Ably not enabled. Live engine still works locally.';
      return;
    }
    state.ably = new window.Ably.Realtime({ authCallback: async (_params, cb) => cb(null, data.tokenRequest) });
    state.channel = state.ably.channels.get('signals');
    state.channel.subscribe('signal', (msg) => {
      if (msg?.data?.pair !== state.currentPair) return;
      state.signal = msg.data.signal;
      state.lastPrice = msg.data.lastPrice;
      renderHero();
    });
    el.notice.textContent = 'Ably realtime connected.';
  } catch {
    el.notice.textContent = 'Ably token route unavailable. Local mode active.';
  }
}

async function fetchKlines(symbol = 'BTCUSDT', interval = '15m', limit = 250) {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Klines failed for ${symbol}`);
  const rows = await res.json();
  return rows.map((k) => ({
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6]
  }));
}

function calculateReturnPercent(windowMs, pair = null) {
  const now = Date.now();
  const closed = state.trades.filter((t) => t.type === 'CLOSE' && (!pair || t.pair === pair) && now - new Date(t.at).getTime() <= windowMs);
  if (!closed.length) return { pct: 0, count: 0 };
  const totalPnl = closed.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
  const totalCapital = closed.reduce((sum, t) => sum + Math.abs(Number(t.entryPrice || 0) * Number(t.size || 0)), 0);
  if (!totalCapital) return { pct: 0, count: closed.length };
  return { pct: (totalPnl / totalCapital) * 100, count: closed.length };
}

function enrichSignal(signal, pair) {
  const recent = calculateReturnPercent(7 * 24 * 60 * 60 * 1000, pair);
  const decisionBundle = getTradeDecision(signal, {
    baseThreshold: state.threshold,
    recentReturnPct: recent.pct,
    recentTradeCount: recent.count
  });
  return {
    ...signal,
    quality: decisionBundle.quality,
    adaptiveThreshold: decisionBundle.adaptiveThreshold,
    decision: decisionBundle.decision
  };
}

async function refreshActivePair() {
  try {
    el.statusText.textContent = 'Refreshing active pair…';
    const candles = await fetchKlines(state.currentPair, state.timeframe, 250);
    const closed = candles.slice(0, -1);
    const baseSignal = runHmmRegime(closed);
    const signal = enrichSignal(baseSignal, state.currentPair);
    const lastPrice = closed[closed.length - 1]?.close ?? null;

    state.signal = signal;
    state.lastPrice = lastPrice;

    logSignal({ pair: state.currentPair, timeframe: state.timeframe, signal, lastPrice });
    maybeAutoTrade();
    publishSignal();
    renderAll();
  } catch (error) {
    el.statusText.textContent = error.message || 'Failed to refresh';
  }
}

async function refreshWatchlist() {
  const out = [];
  for (const pair of state.pairs) {
    try {
      const candles = await fetchKlines(pair, state.timeframe, 250);
      const closed = candles.slice(0, -1);
      const baseSignal = runHmmRegime(closed);
      const signal = enrichSignal(baseSignal, pair);
      const lastPrice = closed[closed.length - 1]?.close ?? null;
      out.push({ pair, timeframe: state.timeframe, lastPrice, signal, updatedAt: new Date().toISOString() });
    } catch (error) {
      out.push({
        pair,
        timeframe: state.timeframe,
        lastPrice: null,
        signal: { state: 'NO TRADE', bull: 0, bear: 0, chop: 0, confidence: 0, spread: 0, quality: 0, adaptiveThreshold: state.threshold, decision: 'HOLD' },
        updatedAt: new Date().toISOString(),
        error: error.message
      });
    }
  }
  state.markets = out.sort((a, b) => (b.signal.quality || 0) - (a.signal.quality || 0));
  renderMarkets();
}

async function refreshAll() {
  await refreshActivePair();
  await refreshWatchlist();
  renderAll();
}

function maybeAutoTrade() {
  if (state.mode !== 'auto') return;
  const d = state.signal.decision;
  if (d === 'BUY') executeTrade('BUY', 'auto');
  if (d === 'SELL') executeTrade('SELL', 'auto');
}

function manualTrade(side) { executeTrade(side, 'manual'); }

function executeTrade(side, source) {
  const price = state.lastPrice;
  if (!price) return;
  if (state.openPosition && state.openPosition.side === side) {
    el.notice.textContent = `Already in ${side} position.`;
    return;
  }
  if (state.openPosition && state.openPosition.side !== side) closePosition();

  state.openPosition = {
    pair: state.currentPair,
    side,
    size: state.size,
    entryPrice: price,
    openedAt: new Date().toISOString(),
    source
  };
  save('sf_open_position', state.openPosition);

  state.trades.unshift({
    type: 'OPEN',
    pair: state.currentPair,
    side,
    size: state.size,
    price,
    source,
    at: new Date().toISOString()
  });
  keepTrades();
  renderAll();
  el.notice.textContent = `${source === 'auto' ? 'Auto' : 'Manual'} ${side} opened at ${fmt(price)}.`;
}

function closePosition() {
  const pos = state.openPosition;
  if (!pos || !state.lastPrice) {
    el.notice.textContent = 'No open position to close.';
    return;
  }

  const exit = state.lastPrice;
  const pnl = pos.side === 'BUY'
    ? (exit - pos.entryPrice) * pos.size
    : (pos.entryPrice - exit) * pos.size;

  state.pnl += pnl;
  save('sf_realised_pnl', state.pnl);

  state.trades.unshift({
    type: 'CLOSE',
    pair: pos.pair,
    side: pos.side,
    size: pos.size,
    entryPrice: pos.entryPrice,
    exitPrice: exit,
    pnl,
    source: pos.source,
    at: new Date().toISOString()
  });
  keepTrades();
  state.openPosition = null;
  save('sf_open_position', null);
  renderAll();
  el.notice.textContent = `Position closed. Realised PnL ${fmt(pnl)}.`;
}

function publishSignal() {
  if (!state.channel) return;
  state.channel.publish('signal', {
    pair: state.currentPair,
    signal: state.signal,
    lastPrice: state.lastPrice,
    at: new Date().toISOString()
  });
}

function logSignal(entry) {
  state.signalHistory.unshift({ ...entry, at: new Date().toISOString() });
  state.signalHistory = state.signalHistory.slice(0, 75);
  save('sf_signal_history', state.signalHistory);
}

function keepTrades() {
  state.trades = state.trades.slice(0, 150);
  save('sf_trades', state.trades);
}

function renderAll() {
  renderHero();
  renderOverview();
  renderSignals();
  renderTrades();
  renderMarkets();
}

function renderHero() {
  el.pairBig.textContent = `${state.currentPair} • ${state.timeframe}`;
  el.stateBadge.textContent = state.signal.state;
  el.lastPrice.textContent = state.lastPrice ? fmt(state.lastPrice) : '–';
  el.statusText.textContent = state.signal.reason === 'OK'
    ? `${state.signal.decision || 'HOLD'} • Confidence ${state.signal.confidence}% • Quality ${state.signal.quality}`
    : state.signal.reason || 'Waiting for live market data';
  el.bullPct.textContent = `${state.signal.bull ?? 0}%`;
  el.bearPct.textContent = `${state.signal.bear ?? 0}%`;
  el.chopPct.textContent = `${state.signal.chop ?? 0}%`;
  el.qualityValue.textContent = `${state.signal.quality ?? 0}`;
  el.adaptiveValue.textContent = `${state.signal.adaptiveThreshold ?? state.threshold}`;
}

function renderOverview() {
  el.modeStat.textContent = state.mode[0].toUpperCase() + state.mode.slice(1);
  el.confidenceStat.textContent = state.signal.confidence ? `${state.signal.confidence}%` : '-';
  el.qualityStat.textContent = `${state.signal.quality ?? 0}`;
  el.adaptiveStat.textContent = `${state.signal.adaptiveThreshold ?? state.threshold}`;
  el.pnlStat.textContent = fmt(state.pnl);
  el.positionStat.textContent = state.openPosition ? `${state.openPosition.side} @ ${fmt(state.openPosition.entryPrice)}` : 'None';

  const dayRet = calculateReturnPercent(24 * 60 * 60 * 1000).pct;
  const weekRet = calculateReturnPercent(7 * 24 * 60 * 60 * 1000).pct;
  el.dayReturnStat.textContent = `${dayRet.toFixed(2)}%`;
  el.weekReturnStat.textContent = `${weekRet.toFixed(2)}%`;
  el.dayReturnStat.className = `big ${dayRet >= 0 ? 'good' : 'bad'}`;
  el.weekReturnStat.className = `big ${weekRet >= 0 ? 'good' : 'bad'}`;
}

function renderMarkets() {
  el.marketsList.innerHTML = '';
  state.markets.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row">
        <div>
          <div><strong>${m.pair}</strong></div>
          <div class="small muted">${m.timeframe} • ${m.lastPrice ? fmt(m.lastPrice) : '–'}</div>
        </div>
        <div class="pill">${m.signal.state}</div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="small muted">Quality ${m.signal.quality} • Confidence ${m.signal.confidence}%</div>
        <div class="small ${m.signal.decision === 'BUY' ? 'good' : m.signal.decision === 'SELL' ? 'bad' : 'muted'}">${m.signal.decision}</div>
      </div>
    `;
    el.marketsList.appendChild(item);
  });
}

function renderSignals() {
  el.signalsList.innerHTML = '';
  state.signalHistory.slice(0, 25).forEach((s) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row">
        <div>
          <div><strong>${s.pair}</strong></div>
          <div class="small muted">${new Date(s.at).toLocaleString()}</div>
        </div>
        <div class="pill">${s.signal.state}</div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="small muted">Q ${s.signal.quality} • Thr ${s.signal.adaptiveThreshold} • Bull ${s.signal.bull}% • Bear ${s.signal.bear}%</div>
        <div class="small muted">${s.signal.decision || 'HOLD'}</div>
      </div>
    `;
    el.signalsList.appendChild(item);
  });
}

function renderTrades() {
  el.tradesList.innerHTML = '';
  state.trades.slice(0, 25).forEach((t) => {
    const price = t.price ?? t.exitPrice ?? t.entryPrice;
    const extra = t.type === 'CLOSE' ? ` • PnL ${fmt(t.pnl)}` : '';
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row">
        <div>
          <div><strong>${t.type} ${t.side}</strong></div>
          <div class="small muted">${t.pair} • ${t.source} • ${new Date(t.at).toLocaleString()}</div>
        </div>
        <div class="pill">${fmt(price)}</div>
      </div>
      <div class="small muted" style="margin-top:10px">Size ${t.size}${extra}</div>
    `;
    el.tradesList.appendChild(item);
  });
}

function setTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  q('#overviewPanel').classList.toggle('hidden', tab !== 'overview');
  q('#marketsPanel').classList.toggle('hidden', tab !== 'markets');
  q('#signalsPanel').classList.toggle('hidden', tab !== 'signals');
  q('#tradesPanel').classList.toggle('hidden', tab !== 'trades');
  q('#howPanel').classList.toggle('hidden', tab !== 'how');
}

function q(sel) { return document.querySelector(sel); }
function fmt(n) {
  return Number(n).toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(Number(n)) >= 1000 ? 2 : 4
  });
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

boot();
