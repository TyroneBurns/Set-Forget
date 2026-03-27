const el = {
  appName:q('#appName'), pairBig:q('#pairBig'), stateBadge:q('#stateBadge'), lastPrice:q('#lastPrice'), statusText:q('#statusText'),
  bullPct:q('#bullPct'), bearPct:q('#bearPct'), chopPct:q('#chopPct'), qualityValue:q('#qualityValue'), adaptiveValue:q('#adaptiveValue'),
  equityStat:q('#equityStat'), cashStat:q('#cashStat'), openPnlStat:q('#openPnlStat'), exposureStat:q('#exposureStat'),
  realisedStat:q('#realisedStat'), positionStat:q('#positionStat'), dayReturnStat:q('#dayReturnStat'), weekReturnStat:q('#weekReturnStat'),
  winRateStat:q('#winRateStat'), tradeCountStat:q('#tradeCountStat'), marketsList:q('#marketsList'), signalsList:q('#signalsList'),
  livePositionsList:q('#livePositionsList'), liveCount:q('#liveCount'), nextRunPill:q('#nextRunPill'),
  equityHeadline:q('#equityHeadline'), equityMeta:q('#equityMeta'), equityCanvas:q('#equityCanvas'),
  settingsToggle:q('#settingsToggle'), settingsPanel:q('#settingsPanel'), settingsClose:q('#settingsClose'), settingsSave:q('#settingsSave'), saveNote:q('#saveNote'),
  marketDataSource:q('#marketDataSource'), symbols:q('#symbols'), interval:q('#interval'), refreshSeconds:q('#refreshSeconds'),
  lookbackPeriod:q('#lookbackPeriod'), minConfidencePct:q('#minConfidencePct'), pBullBull:q('#pBullBull'), pBearBear:q('#pBearBear'),
  pChopChop:q('#pChopChop'), startBalance:q('#startBalance'), riskPerTradePct:q('#riskPerTradePct'),
  stopLossPct:q('#stopLossPct'), takeProfitPct:q('#takeProfitPct'), exitOnChop:q('#exitOnChop'),
  maxOpenPositions:q('#maxOpenPositions'), maxCorrelatedPositions:q('#maxCorrelatedPositions'), sizingMode:q('#sizingMode'),
  autoOptimise:q('#autoOptimise'), autoRiskAdjust:q('#autoRiskAdjust'), autoThresholdAdjust:q('#autoThresholdAdjust'),
  optimiserLookbackDays:q('#optimiserLookbackDays'), optimiserTitle:q('#optimiserTitle'), optimiserSummary:q('#optimiserSummary'),
  effectiveConfidenceStat:q('#effectiveConfidenceStat'), effectiveRiskStat:q('#effectiveRiskStat'), effectiveRiskPill:q('#effectiveRiskPill'),
  closedTodayStat:q('#closedTodayStat'), winsTodayStat:q('#winsTodayStat'), lossesTodayStat:q('#lossesTodayStat'), netTodayStat:q('#netTodayStat'),
  tradeOpenList:q('#tradeOpenList'), tradeClosedList:q('#tradeClosedList')
};

let nextRunSeconds = 300;
let nextRunTimer = null;

async function boot() {
  bindTabs();
  bindSettings();
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

function bindSettings() {
  el.settingsToggle.addEventListener('click', () => el.settingsPanel.classList.toggle('hidden'));
  el.settingsClose.addEventListener('click', () => el.settingsPanel.classList.add('hidden'));
  el.settingsSave.addEventListener('click', saveConfig);
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const payload = await res.json();
  el.appName.textContent = payload.appName || 'Set & Forget';
  fillConfig(payload.config || {});
  renderEffectiveConfig(payload.effectiveConfig || payload.config || {}, payload.config || {});
  nextRunSeconds = Number((payload.effectiveConfig || payload.config || {}).refreshSeconds || 300);
  startNextRunCountdown();
}

function fillConfig(cfg) {
  el.marketDataSource.value = cfg.marketDataSource || 'Binance public candles';
  el.symbols.value = Array.isArray(cfg.symbols) ? cfg.symbols.join(',') : 'BTCUSDT,ETHUSDT,SOLUSDT';
  el.interval.value = cfg.interval || '15m';
  el.refreshSeconds.value = cfg.refreshSeconds ?? 300;
  el.lookbackPeriod.value = cfg.lookbackPeriod ?? 20;
  el.minConfidencePct.value = cfg.minConfidencePct ?? 68;
  el.pBullBull.value = cfg.pBullBull ?? 0.8;
  el.pBearBear.value = cfg.pBearBear ?? 0.8;
  el.pChopChop.value = cfg.pChopChop ?? 0.6;
  el.startBalance.value = cfg.startBalance ?? 1000;
  el.riskPerTradePct.value = cfg.riskPerTradePct ?? 10;
  el.stopLossPct.value = cfg.stopLossPct ?? 2;
  el.takeProfitPct.value = cfg.takeProfitPct ?? 4;
  el.exitOnChop.checked = Boolean(cfg.exitOnChop);
  el.maxOpenPositions.value = cfg.maxOpenPositions ?? 3;
  el.maxCorrelatedPositions.value = cfg.maxCorrelatedPositions ?? 3;
  el.sizingMode.value = cfg.sizingMode || 'confidence_weighted';
  el.autoOptimise.checked = Boolean(cfg.autoOptimise);
  el.autoRiskAdjust.checked = Boolean(cfg.autoRiskAdjust);
  el.autoThresholdAdjust.checked = Boolean(cfg.autoThresholdAdjust);
  el.optimiserLookbackDays.value = cfg.optimiserLookbackDays ?? 7;
}

function renderEffectiveConfig(effective, userCfg) {
  const autoOn = Boolean(userCfg.autoOptimise);
  el.optimiserTitle.textContent = autoOn ? 'Auto-optimiser on' : 'Manual mode';
  el.optimiserSummary.textContent = autoOn
    ? `Running with effective threshold ${effective.minConfidencePct}% and risk ${effective.riskPerTradePct}% per trade.`
    : 'Auto-optimiser is off. Effective settings match your saved controls.';
  el.effectiveConfidenceStat.textContent = `${Number(effective.minConfidencePct || 0).toFixed(0)}%`;
  el.effectiveRiskStat.textContent = `${Number(effective.riskPerTradePct || 0).toFixed(2)}%`;
  el.effectiveRiskPill.textContent = `Risk ${Number(effective.riskPerTradePct || 0).toFixed(2)}%`;
}

async function saveConfig() {
  const body = {
    marketDataSource: el.marketDataSource.value,
    symbols: el.symbols.value,
    interval: el.interval.value,
    refreshSeconds: Number(el.refreshSeconds.value),
    lookbackPeriod: Number(el.lookbackPeriod.value),
    minConfidencePct: Number(el.minConfidencePct.value),
    pBullBull: Number(el.pBullBull.value),
    pBearBear: Number(el.pBearBear.value),
    pChopChop: Number(el.pChopChop.value),
    startBalance: Number(el.startBalance.value),
    riskPerTradePct: Number(el.riskPerTradePct.value),
    stopLossPct: Number(el.stopLossPct.value),
    takeProfitPct: Number(el.takeProfitPct.value),
    exitOnChop: el.exitOnChop.checked,
    maxOpenPositions: Number(el.maxOpenPositions.value),
    maxCorrelatedPositions: Number(el.maxCorrelatedPositions.value),
    sizingMode: el.sizingMode.value,
    autoOptimise: el.autoOptimise.checked,
    autoRiskAdjust: el.autoRiskAdjust.checked,
    autoThresholdAdjust: el.autoThresholdAdjust.checked,
    optimiserLookbackDays: Number(el.optimiserLookbackDays.value)
  };
  el.saveNote.textContent = 'Saving...';
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const out = await res.json();
  if (!res.ok) {
    el.saveNote.textContent = out.error || 'Save failed';
    return;
  }
  fillConfig(out.config);
  renderEffectiveConfig(out.config, out.config);
  nextRunSeconds = Number(out.config.refreshSeconds || 300);
  startNextRunCountdown();
  el.saveNote.textContent = 'Saved. Northflank will use these controls on the next run.';
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
    const [stateRes, marketsRes, signalsRes] = await Promise.all([
      fetch('/api/state'),
      fetch('/api/markets'),
      fetch('/api/signals')
    ]);
    const state = await stateRes.json();
    const markets = await marketsRes.json();
    const signals = await signalsRes.json();

    renderEffectiveConfig(state.effectiveConfig || state.config || {}, state.config || {});
    renderState(state);
    renderMarkets(state.readyMarkets || markets, state.openPositions || []);
    renderTrades(state.trades || [], state.openPositions || [], state.tradeSummary || {});
    renderSignals(signals);
    renderEquityChart(state.equityHistory || [], state.metrics || {});
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
      <div class="small" style="margin-top:8px">Why opened: ${p.opened_reason || 'Signal entry'}</div>
      <div class="small" style="margin-top:4px">Exit plan: ${p.next_action || 'Hold until exit signal'}</div>
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
      <div class="trade-topline">
        <div class="trade-main">
          <div class="trade-headline">${m.pair}</div>
          <div class="trade-subline">${m.timeframe} • ${m.last_price ? fmtNum(m.last_price) : '–'}</div>
        </div>
        <div class="pill ${cls}">${status}</div>
      </div>
      <div class="trade-results">
        <div class="small">Quality ${fmtNum(m.quality_score)} • Conf ${fmtNum(m.confidence_pct)}%</div>
        <div class="trade-type-pill">${m.decision}</div>
      </div>
    `;
    el.marketsList.appendChild(card);
  });
}

function tradeReasonClass(reason = '') {
  const r = String(reason).toLowerCase();
  if (r.includes('take_profit') || r === 'tp') return 'tp';
  if (r.includes('stop_loss') || r === 'sl') return 'sl';
  if (r.includes('signal_flip')) return 'flip';
  if (r.includes('chop')) return 'chop';
  return '';
}

function tradeReasonLabel(reason = '', type = '') {
  if (type === 'OPEN') return 'OPEN';
  const r = String(reason).toLowerCase();
  if (r.includes('take_profit') || r === 'tp') return 'TP';
  if (r.includes('stop_loss') || r === 'sl') return 'SL';
  if (r.includes('signal_flip')) return 'SIGNAL FLIP';
  if (r.includes('chop')) return 'CHOP EXIT';
  return reason ? String(reason).replaceAll('_', ' ').toUpperCase() : type;
}

function renderTrades(rows, openPositions, summary) {
  el.tradeOpenList.innerHTML = '';
  el.tradeClosedList.innerHTML = '';

  el.closedTodayStat.textContent = String(summary.closedToday || 0);
  el.winsTodayStat.textContent = String(summary.winsToday || 0);
  el.lossesTodayStat.textContent = String(summary.lossesToday || 0);
  el.netTodayStat.textContent = gbp(summary.netRealisedToday || 0);
  setGoodBad(el.netTodayStat, summary.netRealisedToday || 0);

  const openCards = openPositions || [];
  if (!openCards.length) {
    const empty = document.createElement('div');
    empty.className = 'trade-card';
    empty.innerHTML = `<div class="small">No open trades right now.</div>`;
    el.tradeOpenList.appendChild(empty);
  } else {
    openCards.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'trade-card';
      item.innerHTML = `
        <div class="trade-topline">
          <div class="trade-left">
            <div class="trade-icon open">↗</div>
            <div class="trade-main">
              <div class="trade-headline">${p.side} ${p.pair}</div>
              <div class="trade-subline">${new Date(p.opened_at).toLocaleString()} • ${fmtDuration(p.duration_minutes || 0)}</div>
              <div class="trade-subline">Why opened: ${p.opened_reason || 'Signal entry'}</div>
            </div>
          </div>
          <div class="trade-stamp">${p.last_price ? fmtNum(p.last_price) : fmtNum(p.entry_price)}</div>
        </div>
        <div class="trade-results">
          <div>
            <div class="trade-pnl-wrap">
              <div class="trade-pnl ${Number(p.open_pnl_gbp || 0) >= 0 ? 'good' : 'bad'}">${gbp(p.open_pnl_gbp || 0)}</div>
              <div class="trade-pct ${Number(p.open_pnl_gbp || 0) >= 0 ? 'good' : 'bad'}">${fmtPct(p.open_pnl_pct || 0)}</div>
            </div>
            <div class="trade-subline">Open trade</div>
          </div>
          <div class="trade-type-pill">${p.signal_decision || 'LIVE'}</div>
        </div>
        <div class="trade-details">
          <div class="trade-detail"><div class="k">Size</div><div class="v">${gbp(p.notional_gbp || 0)}</div></div>
          <div class="trade-detail"><div class="k">Entry</div><div class="v">${fmtNum(p.entry_price)}</div></div>
          <div class="trade-detail"><div class="k">Last</div><div class="v">${p.last_price ? fmtNum(p.last_price) : '–'}</div></div>
          <div class="trade-detail"><div class="k">Exit plan</div><div class="v">${p.next_action || 'Hold'}</div></div>
        </div>
      `;
      el.tradeOpenList.appendChild(item);
    });
  }

  const closed = rows.filter(t => t.type === 'CLOSE');
  if (!closed.length) {
    const empty = document.createElement('div');
    empty.className = 'trade-card';
    empty.innerHTML = `<div class="small">No closed trades yet.</div>`;
    el.tradeClosedList.appendChild(empty);
    return;
  }

  closed.forEach((t) => {
    const pnl = Number(t.pnl_gbp || 0);
    const pct = Number(t.notional_gbp || 0) && t.pnl_gbp != null ? (Number(t.pnl_gbp) / Number(t.notional_gbp)) * 100 : 0;
    const isWin = pnl >= 0;
    const item = document.createElement('div');
    item.className = `trade-card ${isWin ? 'trade-win' : 'trade-loss'}`;
    const reasonClass = tradeReasonClass(t.reason, t.type);
    const reasonLabel = tradeReasonLabel(t.reason, t.type);

    item.innerHTML = `
      <div class="trade-topline">
        <div class="trade-left">
          <div class="trade-icon ${isWin ? 'win' : 'loss'}">${isWin ? '↗' : '↘'}</div>
          <div class="trade-main">
            <div class="trade-headline">${t.side} ${t.pair}</div>
            <div class="trade-subline">${new Date(t.created_at).toLocaleString()}</div>
            <div class="trade-subline">${reasonLabel}</div>
          </div>
        </div>
        <div class="trade-stamp">${fmtNum(t.exit_price || t.entry_price)}</div>
      </div>

      <div class="trade-results">
        <div>
          <div class="trade-pnl-wrap">
            <div class="trade-pnl ${isWin ? 'good' : 'bad'}">${gbp(pnl)}</div>
            <div class="trade-pct ${isWin ? 'good' : 'bad'}">${fmtPct(pct)}</div>
          </div>
          <div class="trade-subline">${isWin ? 'Closed in profit' : 'Closed in loss'}</div>
        </div>
        <div class="pill ${reasonClass}">${reasonLabel}</div>
      </div>

      <div class="trade-details">
        <div class="trade-detail"><div class="k">Size</div><div class="v">${gbp(t.notional_gbp || 0)}</div></div>
        <div class="trade-detail"><div class="k">Duration</div><div class="v">${fmtDuration(calcDurationMinutes(t.opened_at, t.closed_at || t.created_at))}</div></div>
        <div class="trade-detail"><div class="k">Entry</div><div class="v">${t.entry_price ? fmtNum(t.entry_price) : '–'}</div></div>
        <div class="trade-detail"><div class="k">Exit</div><div class="v">${t.exit_price ? fmtNum(t.exit_price) : '–'}</div></div>
      </div>
    `;
    el.tradeClosedList.appendChild(item);
  });
}

function renderSignals(rows) {
  el.signalsList.innerHTML = '';
  rows.slice(0, 50).forEach((s) => {
    const item = document.createElement('div');
    item.className = 'trade-card';
    item.innerHTML = `
      <div class="trade-topline">
        <div class="trade-main">
          <div class="trade-headline">${s.pair}</div>
          <div class="trade-subline">${new Date(s.created_at).toLocaleString()}</div>
        </div>
        <div class="pill">${s.state}</div>
      </div>
      <div class="trade-results">
        <div class="small">Q ${fmtNum(s.quality_score)} • Thr ${fmtNum(s.adaptive_threshold)} • Bull ${fmtNum(s.bull_pct)}%</div>
        <div class="trade-type-pill">${s.decision}</div>
      </div>
    `;
    el.signalsList.appendChild(item);
  });
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
    y: bottom - ((v - paddedMin) / (paddedMax - paddedMin)) * chartH
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
    ? `${history.length} snapshots • 1 day ${fmtPct(metrics.dayReturnPct || 0)} • 7 day ${fmtPct(metrics.weekReturnPct || 0)}`
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
  return h <= 0 ? `${m}m` : `${h}h ${m}m`;
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
