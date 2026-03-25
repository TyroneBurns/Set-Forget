const el = {
  appName:q('#appName'), pairBig:q('#pairBig'), stateBadge:q('#stateBadge'), lastPrice:q('#lastPrice'), statusText:q('#statusText'),
  bullPct:q('#bullPct'), bearPct:q('#bearPct'), chopPct:q('#chopPct'), qualityValue:q('#qualityValue'), adaptiveValue:q('#adaptiveValue'),
  equityStat:q('#equityStat'), cashStat:q('#cashStat'), openPnlStat:q('#openPnlStat'), exposureStat:q('#exposureStat'),
  realisedStat:q('#realisedStat'), positionStat:q('#positionStat'), dayReturnStat:q('#dayReturnStat'), weekReturnStat:q('#weekReturnStat'),
  winRateStat:q('#winRateStat'), tradeCountStat:q('#tradeCountStat'), marketsList:q('#marketsList'), signalsList:q('#signalsList'),
  tradesList:q('#tradesList'), livePositionsList:q('#livePositionsList'), liveCount:q('#liveCount'), nextRunPill:q('#nextRunPill'),
  equityHeadline:q('#equityHeadline'), equityMeta:q('#equityMeta'), equityCanvas:q('#equityCanvas'),
  whyPair:q('#whyPair'), whyText:q('#whyText'), whyDecision:q('#whyDecision'), whyState:q('#whyState'),
  whyConfidence:q('#whyConfidence'), whyQuality:q('#whyQuality'), whyThreshold:q('#whyThreshold'), whyRegime:q('#whyRegime'),
  explainToggle:q('#explainToggle'), explainBody:q('#explainBody'), explainChevron:q('#explainChevron')
};

let nextRunSeconds = 300;
let nextRunTimer;

async function boot() {
  bindTabs();
  bindExplainer();
  await loadConfig();
  await refreshAll();
  setInterval(refreshAll, 30000);
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    q('#overviewPanel').classList.toggle('hidden', tab !== 'overview');
    q('#marketsPanel').classList.toggle('hidden', tab !== 'markets');
    q('#signalsPanel').classList.toggle('hidden', tab !== 'signals');
    q('#tradesPanel').classList.toggle('hidden', tab !== 'trades');
  }));
}

function bindExplainer() {
  el.explainToggle.addEventListener('click', () => {
    const hidden = el.explainBody.classList.toggle('hidden');
    el.explainChevron.textContent = hidden ? '＋' : '－';
  });
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  el.appName.textContent = cfg.appName || 'Set & Forget';
  nextRunSeconds = Number(cfg.nextRunSeconds || 300);
  startNextRunCountdown();
}

function startNextRunCountdown() {
  if (nextRunTimer) clearInterval(nextRunTimer);
  let remain = nextRunSeconds;
  renderNextRun(remain);
  nextRunTimer = setInterval(() => {
    remain = remain <= 0 ? nextRunSeconds : remain - 1;
    renderNextRun(remain);
  }, 1000);
}

function renderNextRun(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  el.nextRunPill.textContent = `Next run ${m}:${s}`;
}

async function refreshAll() {
  try {
    const [stateRes, marketsRes, tradesRes, signalsRes] = await Promise.all([
      fetch('/api/state'),
      fetch('/api/markets'),
      fetch('/api/trades'),
      fetch('/api/signals')
    ]);
    const state = await stateRes.json();
    const markets = await marketsRes.json();
    const trades = await tradesRes.json();
    const signals = await signalsRes.json();
    renderState(state);
    renderMarkets(state.readyMarkets || markets, state.openPositions || []);
    renderTrades(trades);
    renderSignals(signals);
    renderWhy(state.whyThisTrade);
    renderEquityChart(state.equityHistory || [], state.metrics || {});
    nextRunSeconds = 300;
    startNextRunCountdown();
  } catch {
    el.statusText.textContent = 'Failed to read backend state';
  }
}

function renderState(data) {
  const market = data.activeMarket;
  const portfolio = data.portfolio;
  const openPositions = data.openPositions || [];
  const metrics = data.metrics || {};

  el.pairBig.textContent = market ? `${market.pair} • ${market.timeframe}` : '–';
  el.stateBadge.textContent = market?.state || 'NO DATA';
  el.lastPrice.textContent = market?.last_price ? fmtNum(market.last_price) : '–';
  el.statusText.textContent = market ? `${market.decision} • Confidence ${fmtNum(market.confidence_pct)}% • Quality ${fmtNum(market.quality_score)}` : 'Waiting for worker run';

  el.bullPct.textContent = `${fmtNum(market?.bull_pct || 0)}%`;
  el.bearPct.textContent = `${fmtNum(market?.bear_pct || 0)}%`;
  el.chopPct.textContent = `${fmtNum(market?.chop_pct || 0)}%`;
  el.qualityValue.textContent = fmtNum(market?.quality_score || 0);
  el.adaptiveValue.textContent = fmtNum(market?.adaptive_threshold || 0);

  el.equityStat.textContent = gbp(metrics.currentEquity || 0);
  el.cashStat.textContent = gbp(portfolio?.cash_gbp || 0);
  el.openPnlStat.textContent = gbp(metrics.openPnl || 0);
  el.exposureStat.textContent = gbp(metrics.exposure || 0);
  el.realisedStat.textContent = gbp(portfolio?.realised_pnl_gbp || 0);
  el.positionStat.textContent = String(openPositions.length || 0);
  el.dayReturnStat.textContent = `${(metrics.dayReturnPct || 0).toFixed(2)}%`;
  el.weekReturnStat.textContent = `${(metrics.weekReturnPct || 0).toFixed(2)}%`;
  el.winRateStat.textContent = `${(metrics.winRate || 0).toFixed(1)}%`;
  el.tradeCountStat.textContent = String(metrics.tradeCount || 0);

  setGoodBad(el.openPnlStat, metrics.openPnl || 0);
  setGoodBad(el.realisedStat, Number(portfolio?.realised_pnl_gbp || 0));
  setGoodBad(el.dayReturnStat, metrics.dayReturnPct || 0);
  setGoodBad(el.weekReturnStat, metrics.weekReturnPct || 0);

  renderLivePositions(openPositions);
}

function renderLivePositions(rows) {
  el.livePositionsList.innerHTML = '';
  el.liveCount.textContent = `${rows.length} open trade${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'banner';
    empty.innerHTML = `<div class="small">No live positions yet. The engine will open trades when signal quality is above threshold.</div>`;
    el.livePositionsList.appendChild(empty);
    return;
  }
  rows.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'banner';
    const pnlClass = Number(p.open_pnl_gbp || 0) >= 0 ? 'good' : 'bad';
    card.innerHTML = `
      <div class="banner-head">
        <div>
          <div class="banner-title">${p.side} ${p.pair}</div>
          <div class="banner-sub">Entry ${fmtNum(p.entry_price)} • Last ${p.last_price ? fmtNum(p.last_price) : '–'} • ${fmtDuration(p.duration_minutes || 0)}</div>
        </div>
        <div class="pill trade">LIVE</div>
      </div>
      <div class="banner-metrics">
        <div class="metric-box"><div class="m-label">Size</div><div class="m-value">${gbp(p.notional_gbp || 0)}</div></div>
        <div class="metric-box"><div class="m-label">Signal</div><div class="m-value">${p.signal_decision || 'HOLD'}</div></div>
        <div class="metric-box"><div class="m-label">Open PnL</div><div class="m-value ${pnlClass}">${gbp(p.open_pnl_gbp || 0)}</div></div>
        <div class="metric-box"><div class="m-label">Open PnL %</div><div class="m-value ${pnlClass}">${fmtPct(p.open_pnl_pct || 0)}</div></div>
      </div>
    `;
    el.livePositionsList.appendChild(card);
  });
}

function renderMarkets(rows, openPositions) {
  const openSet = new Set((openPositions || []).map(p => p.pair));
  el.marketsList.innerHTML = '';
  rows.forEach((m) => {
    const status = m.status || (openSet.has(m.pair) ? 'IN TRADE' : ((m.decision === 'BUY' || m.decision === 'SELL') ? 'READY' : 'WAIT'));
    const cls = status === 'IN TRADE' ? 'trade' : status === 'READY' ? 'ready' : 'wait';
    const card = document.createElement('div');
    card.className = 'trade-card';
    card.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${m.pair}</div>
          <div class="meta">${m.timeframe} • ${m.last_price ? fmtNum(m.last_price) : '–'}</div>
        </div>
        <div class="pill ${cls}">${status}</div>
      </div>
      <div class="bottom">
        <div class="small">Quality ${fmtNum(m.quality_score)} • Conf ${fmtNum(m.confidence_pct)}%</div>
        <div class="rhs">
          <div class="name" style="font-size:15px">${m.state}</div>
          <div class="action">${m.decision}</div>
        </div>
      </div>
    `;
    el.marketsList.appendChild(card);
  });
}

function renderTrades(rows) {
  el.tradesList.innerHTML = '';
  rows.forEach((t) => {
    const pnl = Number(t.pnl_gbp || 0);
    const pnlClass = pnl >= 0 ? 'good' : 'bad';
    const pct = Number(t.notional_gbp || 0) && t.pnl_gbp != null ? (Number(t.pnl_gbp) / Number(t.notional_gbp)) * 100 : null;
    const duration = t.opened_at ? fmtDuration(calcDurationMinutes(t.opened_at, t.closed_at || t.created_at)) : '–';
    const item = document.createElement('div');
    item.className = 'trade-card';
    item.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${t.type} ${t.side}</div>
          <div class="meta">${t.pair} • ${t.source} • ${new Date(t.created_at).toLocaleString()}</div>
        </div>
        <div class="pill">${t.exit_price ? fmtNum(t.exit_price) : fmtNum(t.entry_price)}</div>
      </div>
      <div class="bottom">
        <div class="small">
          ${gbp(t.notional_gbp || 0)}
          ${t.entry_price ? ` • Entry ${fmtNum(t.entry_price)}` : ''}
          ${t.exit_price ? ` • Exit ${fmtNum(t.exit_price)}` : ''}
          • ${duration}
        </div>
        <div class="rhs">
          <div class="name ${pnlClass}" style="font-size:15px">${t.pnl_gbp != null ? gbp(t.pnl_gbp) : 'Open'}</div>
          <div class="action">${pct != null ? fmtPct(pct) : t.type}</div>
        </div>
      </div>
    `;
    el.tradesList.appendChild(item);
  });
}

function renderSignals(rows) {
  el.signalsList.innerHTML = '';
  rows.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'trade-card';
    item.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${s.pair}</div>
          <div class="meta">${new Date(s.created_at).toLocaleString()}</div>
        </div>
        <div class="pill">${s.state}</div>
      </div>
      <div class="bottom">
        <div class="small">Q ${fmtNum(s.quality_score)} • Thr ${fmtNum(s.adaptive_threshold)} • Bull ${fmtNum(s.bull_pct)}%</div>
        <div class="rhs">
          <div class="name" style="font-size:15px">${s.decision}</div>
          <div class="action">${s.timeframe}</div>
        </div>
      </div>
    `;
    el.signalsList.appendChild(item);
  });
}

function renderWhy(why) {
  if (!why) return;
  el.whyPair.textContent = why.pair;
  el.whyText.textContent = why.explanation;
  el.whyDecision.textContent = why.decision;
  el.whyState.textContent = why.state;
  el.whyConfidence.textContent = fmtPct(why.confidencePct);
  el.whyQuality.textContent = fmtNum(why.qualityScore);
  el.whyThreshold.textContent = fmtNum(why.threshold);
  el.whyRegime.textContent = `B ${fmtNum(why.bullPct)} / Br ${fmtNum(why.bearPct)} / C ${fmtNum(why.chopPct)}`;
}

function renderEquityChart(history, metrics) {
  const canvas = el.equityCanvas;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 440;
  const height = 170;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const points = history.length ? history.map(h => Number(h.equity || 0)) : [Number(metrics.currentEquity || 0)];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const paddedMin = min === max ? min - 1 : min - (max - min) * 0.12;
  const paddedMax = min === max ? max + 1 : max + (max - min) * 0.12;

  const left = 10, right = width - 10, top = 10, bottom = height - 16;
  const chartW = right - left, chartH = bottom - top;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = top + (chartH / 3) * i;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }

  const coords = points.map((v, i) => ({
    x: left + (points.length === 1 ? chartW / 2 : (i / (points.length - 1)) * chartW),
    y: bottom - ((v - paddedMin) / (paddedMax - paddedMin)) * chartH,
    v
  }));

  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, 'rgba(125,124,255,0.35)');
  grad.addColorStop(1, 'rgba(125,124,255,0.02)');

  ctx.beginPath();
  coords.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.lineTo(coords[coords.length - 1].x, bottom);
  ctx.lineTo(coords[0].x, bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  coords.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = '#8f88ff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const last = coords[coords.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#c8c5ff';
  ctx.fill();

  el.equityHeadline.textContent = gbp(metrics.currentEquity || 0);
  el.equityMeta.textContent = history.length
    ? `${history.length} snapshot${history.length === 1 ? '' : 's'} • 1 day ${fmtPct(metrics.dayReturnPct || 0)} • 7 day ${fmtPct(metrics.weekReturnPct || 0)}`
    : 'Waiting for more history';
}

function calcDurationMinutes(startIso, endIso = null) {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 60000));
}

function fmtDuration(minutes) {
  const mins = Number(minutes || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h <= 0 ? `${m}m live` : `${h}h ${m}m live`;
}

function setGoodBad(node, value) {
  node.classList.remove('good', 'bad');
  if (Number(value) > 0) node.classList.add('good');
  if (Number(value) < 0) node.classList.add('bad');
}

function q(sel){ return document.querySelector(sel); }
function gbp(n){ return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:2}).format(Number(n || 0)); }
function fmtNum(n){ return Number(n || 0).toLocaleString(undefined,{maximumFractionDigits: Math.abs(Number(n||0)) >= 1000 ? 2 : 4}); }
function fmtPct(n){ return `${Number(n || 0).toFixed(2)}%`; }

boot();
