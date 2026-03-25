const el = {
  appName: q('#appName'),
  pairBig: q('#pairBig'),
  stateBadge: q('#stateBadge'),
  lastPrice: q('#lastPrice'),
  statusText: q('#statusText'),
  bullPct: q('#bullPct'),
  bearPct: q('#bearPct'),
  chopPct: q('#chopPct'),
  qualityValue: q('#qualityValue'),
  adaptiveValue: q('#adaptiveValue'),
  equityStat: q('#equityStat'),
  cashStat: q('#cashStat'),
  realisedStat: q('#realisedStat'),
  positionStat: q('#positionStat'),
  dayReturnStat: q('#dayReturnStat'),
  weekReturnStat: q('#weekReturnStat'),
  winRateStat: q('#winRateStat'),
  tradeCountStat: q('#tradeCountStat'),
  marketsList: q('#marketsList'),
  signalsList: q('#signalsList'),
  tradesList: q('#tradesList')
};

async function boot() {
  bindTabs();
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
    q('#howPanel').classList.toggle('hidden', tab !== 'how');
  }));
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  el.appName.textContent = cfg.appName || 'Set & Forget';
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
    renderMarkets(markets);
    renderTrades(trades);
    renderSignals(signals);
  } catch (e) {
    el.statusText.textContent = 'Failed to read backend state';
  }
}

function renderState(data) {
  const market = data.activeMarket;
  const portfolio = data.portfolio;
  const openPos = data.openPosition;
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
  el.realisedStat.textContent = gbp(portfolio?.realised_pnl_gbp || 0);
  el.positionStat.textContent = openPos ? `${openPos.side} ${openPos.pair}` : 'None';
  el.dayReturnStat.textContent = `${(metrics.dayReturnPct || 0).toFixed(2)}%`;
  el.weekReturnStat.textContent = `${(metrics.weekReturnPct || 0).toFixed(2)}%`;
  el.winRateStat.textContent = `${(metrics.winRate || 0).toFixed(1)}%`;
  el.tradeCountStat.textContent = String(metrics.tradeCount || 0);

  el.dayReturnStat.className = `big ${(metrics.dayReturnPct || 0) >= 0 ? 'good' : 'bad'}`;
  el.weekReturnStat.className = `big ${(metrics.weekReturnPct || 0) >= 0 ? 'good' : 'bad'}`;
  el.realisedStat.className = `big ${Number(portfolio?.realised_pnl_gbp || 0) >= 0 ? 'good' : 'bad'}`;
}

function renderMarkets(rows) {
  el.marketsList.innerHTML = '';
  rows.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row">
        <div>
          <div><strong>${m.pair}</strong></div>
          <div class="small muted">${m.timeframe} • ${m.last_price ? fmtNum(m.last_price) : '–'}</div>
        </div>
        <div class="pill">${m.state}</div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="small muted">Quality ${fmtNum(m.quality_score)} • Conf ${fmtNum(m.confidence_pct)}%</div>
        <div class="small">${m.decision}</div>
      </div>`;
    el.marketsList.appendChild(item);
  });
}

function renderTrades(rows) {
  el.tradesList.innerHTML = '';
  rows.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row">
        <div>
          <div><strong>${t.type} ${t.side}</strong></div>
          <div class="small muted">${t.pair} • ${t.source} • ${new Date(t.created_at).toLocaleString()}</div>
        </div>
        <div class="pill">${t.exit_price ? fmtNum(t.exit_price) : fmtNum(t.entry_price)}</div>
      </div>
      <div class="small muted" style="margin-top:10px">£${fmtNum(t.notional_gbp || 0)}${t.pnl_gbp != null ? ` • PnL £${fmtNum(t.pnl_gbp)}` : ''}</div>`;
    el.tradesList.appendChild(item);
  });
}

function renderSignals(rows) {
  el.signalsList.innerHTML = '';
  rows.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="row">
        <div>
          <div><strong>${s.pair}</strong></div>
          <div class="small muted">${new Date(s.created_at).toLocaleString()}</div>
        </div>
        <div class="pill">${s.state}</div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="small muted">Q ${fmtNum(s.quality_score)} • Thr ${fmtNum(s.adaptive_threshold)} • Bull ${fmtNum(s.bull_pct)}%</div>
        <div class="small muted">${s.decision}</div>
      </div>`;
    el.signalsList.appendChild(item);
  });
}

function q(sel){ return document.querySelector(sel); }
function gbp(n){ return new Intl.NumberFormat('en-GB', { style:'currency', currency:'GBP', maximumFractionDigits:2 }).format(Number(n || 0)); }
function fmtNum(n){ return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: Math.abs(Number(n||0)) >= 1000 ? 2 : 4 }); }

boot();
