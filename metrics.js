const el = {
  healthStatusText: q('#healthStatusText'),
  healthStatusPill: q('#healthStatusPill'),
  healthSummary: q('#healthSummary'),
  sampleSizeText: q('#sampleSizeText'),
  winRate: q('#winRate'),
  avgWin: q('#avgWin'),
  avgLoss: q('#avgLoss'),
  payoffRatio: q('#payoffRatio'),
  expectancy: q('#expectancy'),
  profitFactor: q('#profitFactor'),
  dailyHeadline: q('#dailyHeadline'),
  dailyMeta: q('#dailyMeta'),
  dailyCanvas: q('#dailyCanvas'),
  reasonGrid: q('#reasonGrid'),
  qualityGrid: q('#qualityGrid'),
  durationGrid: q('#durationGrid'),
  pairList: q('#pairList'),
  recentClosedList: q('#recentClosedList'),
  recentMeta: q('#recentMeta')
};

async function boot() {
  const res = await fetch('/api/metrics');
  const data = await res.json();
  renderSummary(data);
  renderReasonGrid(data.byReason || []);
  renderQualityGrid(data.qualityBuckets || []);
  renderDurationGrid(data.durationBuckets || []);
  renderPairList(data.byPair || []);
  renderRecentClosed(data.recentClosed || []);
  renderDailyChart(data.dailyPnl || []);
}

function renderSummary(data) {
  const s = data.summary || {};
  el.healthStatusText.textContent = data.health?.label || 'Neutral';
  el.healthStatusPill.textContent = data.health?.pill || 'Checking';
  el.healthStatusPill.classList.remove('ready','trade','wait','sl','tp','flip','chop');
  if (data.health?.state === 'green') el.healthStatusPill.classList.add('trade');
  if (data.health?.state === 'yellow') el.healthStatusPill.classList.add('ready');
  if (data.health?.state === 'red') el.healthStatusPill.classList.add('sl');
  el.healthSummary.textContent = data.health?.summary || 'No summary yet';

  el.sampleSizeText.textContent = `${s.closedTrades || 0} closed trades`;
  el.winRate.textContent = fmtPct(s.winRatePct || 0);
  el.avgWin.textContent = gbp(s.avgWin || 0);
  el.avgLoss.textContent = gbp(s.avgLoss || 0);
  el.payoffRatio.textContent = fmtNum(s.payoffRatio || 0, 2);
  el.expectancy.textContent = gbp(s.expectancyPerTrade || 0);
  el.profitFactor.textContent = fmtNum(s.profitFactor || 0, 2);

  setGoodBad(el.avgWin, s.avgWin || 0);
  setGoodBad(el.avgLoss, -(Math.abs(s.avgLoss || 0)));
  setGoodBad(el.expectancy, s.expectancyPerTrade || 0);

  el.dailyHeadline.textContent = `Net realised ${gbp(s.netRealised || 0)}`;
  el.dailyMeta.textContent = `Gross profit ${gbp(s.grossProfit || 0)} • Gross loss ${gbp(-(Math.abs(s.grossLoss || 0)))} • Max drawdown ${fmtPct(s.maxDrawdownPct || 0)}`;
}

function renderReasonGrid(items) {
  el.reasonGrid.innerHTML = '';
  items.forEach(item => {
    const node = document.createElement('div');
    node.className = 'stat';
    node.innerHTML = `
      <div class="small">${item.reason}</div>
      <div class="big ${item.pnl >= 0 ? 'good' : 'bad'}">${gbp(item.pnl)}</div>
      <div class="small">${item.count} trades • ${fmtPct(item.sharePct)} of closes</div>
      <div class="small">Avg ${gbp(item.avgPnl)}</div>
    `;
    el.reasonGrid.appendChild(node);
  });
}

function renderQualityGrid(items) {
  el.qualityGrid.innerHTML = '';
  items.forEach(item => {
    const node = document.createElement('div');
    node.className = 'stat';
    node.innerHTML = `
      <div class="small">${item.label}</div>
      <div class="big ${item.pnl >= 0 ? 'good' : 'bad'}">${gbp(item.pnl)}</div>
      <div class="small">${item.count} trades • WR ${fmtPct(item.winRatePct)}</div>
      <div class="small">Avg ${gbp(item.avgPnl)}</div>
    `;
    el.qualityGrid.appendChild(node);
  });
}

function renderDurationGrid(items) {
  el.durationGrid.innerHTML = '';
  items.forEach(item => {
    const node = document.createElement('div');
    node.className = 'stat';
    node.innerHTML = `
      <div class="small">${item.label}</div>
      <div class="big ${item.pnl >= 0 ? 'good' : 'bad'}">${gbp(item.pnl)}</div>
      <div class="small">${item.count} trades • WR ${fmtPct(item.winRatePct)}</div>
      <div class="small">Avg ${gbp(item.avgPnl)}</div>
    `;
    el.durationGrid.appendChild(node);
  });
}

function renderPairList(items) {
  el.pairList.innerHTML = '';
  items.forEach(item => {
    const node = document.createElement('div');
    node.className = 'trade-card';
    node.innerHTML = `
      <div class="trade-topline">
        <div class="trade-main">
          <div class="trade-headline">${item.pair}</div>
          <div class="trade-subline">${item.count} closed • WR ${fmtPct(item.winRatePct)}</div>
        </div>
        <div class="trade-stamp">${gbp(item.pnl)}</div>
      </div>
      <div class="trade-results">
        <div class="small">Avg win ${gbp(item.avgWin)} • Avg loss ${gbp(item.avgLoss)}</div>
        <div class="trade-type-pill ${item.pnl >= 0 ? 'good' : 'bad'}">${item.pnl >= 0 ? 'UP' : 'DOWN'}</div>
      </div>
    `;
    el.pairList.appendChild(node);
  });
}

function renderRecentClosed(items) {
  el.recentClosedList.innerHTML = '';
  el.recentMeta.textContent = `${items.length} latest closed trades`;
  items.forEach(t => {
    const isWin = Number(t.pnl_gbp || 0) >= 0;
    const node = document.createElement('div');
    node.className = `trade-card ${isWin ? 'trade-win' : 'trade-loss'}`;
    node.innerHTML = `
      <div class="trade-topline">
        <div class="trade-left">
          <div class="trade-icon ${isWin ? 'win' : 'loss'}">${isWin ? '↗' : '↘'}</div>
          <div class="trade-main">
            <div class="trade-headline">${t.side} ${t.pair}</div>
            <div class="trade-subline">${new Date(t.created_at).toLocaleString()}</div>
            <div class="trade-subline">${prettyReason(t.reason)}</div>
          </div>
        </div>
        <div class="trade-stamp">${fmtNum(t.exit_price || t.entry_price)}</div>
      </div>
      <div class="trade-results">
        <div class="trade-pnl-wrap">
          <div class="trade-pnl ${isWin ? 'good' : 'bad'}">${gbp(t.pnl_gbp || 0)}</div>
          <div class="trade-pct ${isWin ? 'good' : 'bad'}">${fmtPct(t.pnl_pct || 0)}</div>
        </div>
        <div class="pill ${reasonClass(t.reason)}">${prettyReason(t.reason)}</div>
      </div>
    `;
    el.recentClosedList.appendChild(node);
  });
}

function renderDailyChart(rows) {
  const canvas = el.dailyCanvas;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 440;
  const height = 180;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (!rows.length) return;

  const values = rows.map(r => Number(r.pnl || 0));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const paddedMin = min - Math.max((max - min) * 0.12, 0.1);
  const paddedMax = max + Math.max((max - min) * 0.12, 0.1);

  const left = 10, right = width - 10, top = 10, bottom = height - 22;
  const chartW = right - left, chartH = bottom - top;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = top + (chartH / 3) * i;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }

  const zeroY = bottom - ((0 - paddedMin) / (paddedMax - paddedMin)) * chartH;
  ctx.strokeStyle = 'rgba(244,199,102,0.25)';
  ctx.beginPath(); ctx.moveTo(left, zeroY); ctx.lineTo(right, zeroY); ctx.stroke();

  const barWidth = Math.max(8, chartW / rows.length - 6);
  rows.forEach((r, i) => {
    const x = left + i * (chartW / rows.length) + 3;
    const y = bottom - ((Number(r.pnl) - paddedMin) / (paddedMax - paddedMin)) * chartH;
    const h = Math.abs(zeroY - y);
    ctx.fillStyle = Number(r.pnl) >= 0 ? 'rgba(69,227,155,0.8)' : 'rgba(255,79,131,0.8)';
    ctx.fillRect(x, Math.min(y, zeroY), barWidth, Math.max(h, 2));
  });

  ctx.fillStyle = 'rgba(152,162,200,0.8)';
  ctx.font = '11px sans-serif';
  rows.forEach((r, i) => {
    const x = left + i * (chartW / rows.length) + 3;
    ctx.save();
    ctx.translate(x, height - 4);
    ctx.rotate(-0.55);
    ctx.fillText(r.label, 0, 0);
    ctx.restore();
  });
}

function reasonClass(reason='') {
  const r = String(reason).toLowerCase();
  if (r.includes('take_profit')) return 'tp';
  if (r.includes('stop_loss')) return 'sl';
  if (r.includes('signal_flip')) return 'flip';
  if (r.includes('chop')) return 'chop';
  return 'wait';
}
function prettyReason(reason='') {
  return String(reason || 'UNKNOWN').replaceAll('_', ' ').toUpperCase();
}
function setGoodBad(node, value) {
  node.classList.remove('good','bad');
  if (Number(value) > 0) node.classList.add('good');
  if (Number(value) < 0) node.classList.add('bad');
}
function q(sel){ return document.querySelector(sel); }
function gbp(n){ return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:2}).format(Number(n || 0)); }
function fmtPct(n){ return `${Number(n || 0).toFixed(2)}%`; }
function fmtNum(n, dp=2){ return Number(n || 0).toFixed(dp); }

boot();
