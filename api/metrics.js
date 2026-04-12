import { query } from '../lib/db.js';

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}
function avg(arr) {
  return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
}
function durationMinutes(openedAt, closedAt) {
  if (!openedAt || !closedAt) return 0;
  const ms = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  return Math.max(0, Math.round(ms / 60000));
}
function pctFromTrade(t) {
  const notional = toNum(t.notional_gbp);
  return notional ? (toNum(t.pnl_gbp) / notional) * 100 : 0;
}
function bucketOfQuality(q) {
  const n = toNum(q);
  if (n < 75) return '<75';
  if (n < 80) return '75-79.99';
  if (n < 85) return '80-84.99';
  if (n < 90) return '85-89.99';
  return '90+';
}
function bucketOfDuration(mins) {
  if (mins < 30) return '<30m';
  if (mins < 90) return '30-89m';
  if (mins < 240) return '90-239m';
  return '240m+';
}
function mapStats(label, rows, accessor = (x)=>toNum(x.pnl_gbp)) {
  const pnls = rows.map(accessor);
  const wins = rows.filter(r => accessor(r) > 0);
  const losses = rows.filter(r => accessor(r) < 0);
  return {
    label,
    count: rows.length,
    pnl: pnls.reduce((a,b)=>a+b,0),
    avgPnl: avg(pnls),
    winRatePct: rows.length ? (wins.length / rows.length) * 100 : 0,
    avgWin: avg(wins.map(accessor)),
    avgLoss: avg(losses.map(r => Math.abs(accessor(r))))
  };
}

export default async function handler(req, res) {
  try {
    const [portfolioRows, tradeRows, snapshotRows] = await Promise.all([
      query(`select * from sf_portfolio where id='main' limit 1`),
      query(`select * from sf_trades where portfolio_id='main' and type='CLOSE' order by created_at desc limit 500`),
      query(`select * from sf_snapshots where portfolio_id='main' order by snapshot_at asc limit 500`)
    ]);

    const portfolio = portfolioRows.rows[0] || null;
    const closed = tradeRows.rows || [];
    const snapshots = snapshotRows.rows || [];

    const wins = closed.filter(t => toNum(t.pnl_gbp) > 0);
    const losses = closed.filter(t => toNum(t.pnl_gbp) < 0);
    const grossProfit = wins.reduce((s,t)=>s + toNum(t.pnl_gbp), 0);
    const grossLossAbs = Math.abs(losses.reduce((s,t)=>s + toNum(t.pnl_gbp), 0));
    const winRatePct = closed.length ? (wins.length / closed.length) * 100 : 0;
    const avgWin = avg(wins.map(t => toNum(t.pnl_gbp)));
    const avgLossAbs = avg(losses.map(t => Math.abs(toNum(t.pnl_gbp))));
    const payoffRatio = avgLossAbs ? avgWin / avgLossAbs : 0;
    const expectancyPerTrade = closed.length ? (grossProfit - grossLossAbs) / closed.length : 0;
    const profitFactor = grossLossAbs ? grossProfit / grossLossAbs : 0;
    const netRealised = closed.reduce((s,t)=>s + toNum(t.pnl_gbp), 0);

    let peak = portfolio ? toNum(portfolio.starting_balance_gbp) : 1000;
    let maxDrawdownPct = 0;
    snapshots.forEach(s => {
      const eq = toNum(s.equity_gbp);
      if (eq > peak) peak = eq;
      const dd = peak ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    });

    const byReasonMap = new Map();
    closed.forEach(t => {
      const key = String(t.reason || 'UNKNOWN').replaceAll('_', ' ').toUpperCase();
      const arr = byReasonMap.get(key) || [];
      arr.push(t);
      byReasonMap.set(key, arr);
    });
    const byReason = [...byReasonMap.entries()]
      .map(([reason, rows]) => {
        const stats = mapStats(reason, rows);
        return {
          ...stats,
          reason,
          sharePct: closed.length ? (rows.length / closed.length) * 100 : 0
        };
      })
      .sort((a,b) => Math.abs(b.pnl) - Math.abs(a.pnl));

    const qualityBucketsOrder = ['<75','75-79.99','80-84.99','85-89.99','90+'];
    const qualityMap = new Map();
    closed.forEach(t => {
      const key = bucketOfQuality(t.quality_score);
      const arr = qualityMap.get(key) || [];
      arr.push(t);
      qualityMap.set(key, arr);
    });
    const qualityBuckets = qualityBucketsOrder.map(label => mapStats(label, qualityMap.get(label) || []));

    const durationOrder = ['<30m','30-89m','90-239m','240m+'];
    const durationMap = new Map();
    closed.forEach(t => {
      const mins = durationMinutes(t.opened_at, t.closed_at || t.created_at);
      const key = bucketOfDuration(mins);
      const arr = durationMap.get(key) || [];
      arr.push(t);
      durationMap.set(key, arr);
    });
    const durationBuckets = durationOrder.map(label => mapStats(label, durationMap.get(label) || []));

    const pairMap = new Map();
    closed.forEach(t => {
      const key = String(t.pair || 'UNKNOWN');
      const arr = pairMap.get(key) || [];
      arr.push(t);
      pairMap.set(key, arr);
    });
    const byPair = [...pairMap.entries()]
      .map(([pair, rows]) => ({ pair, ...mapStats(pair, rows) }))
      .sort((a,b) => b.pnl - a.pnl);

    const dailyMap = new Map();
    closed.forEach(t => {
      const d = new Date(t.created_at);
      const label = d.toISOString().slice(5,10);
      const prev = dailyMap.get(label) || 0;
      dailyMap.set(label, prev + toNum(t.pnl_gbp));
    });
    const dailyPnl = [...dailyMap.entries()].map(([label, pnl]) => ({ label, pnl })).slice(-14);

    const recentClosed = closed.slice(0, 20).map(t => ({
      ...t,
      pnl_pct: pctFromTrade(t)
    }));

    const chop = byReason.find(x => x.reason.includes('CHOP'));
    const flip = byReason.find(x => x.reason.includes('SIGNAL FLIP'));
    let healthState = 'yellow';
    let label = 'Neutral / learning';
    let pill = 'Learning';
    let summary = 'System is still in validation mode.';
    if (expectancyPerTrade > 0 && winRatePct >= 40 && (!chop || chop.sharePct < 55)) {
      healthState = 'green';
      label = 'Trending edge';
      pill = 'Edge up';
      summary = 'Expectancy is positive, win rate is improving, and chop damage is under control.';
    } else if ((chop && chop.sharePct > 65) || expectancyPerTrade < 0) {
      healthState = 'red';
      label = 'Chop dominated';
      pill = 'Leak active';
      summary = 'Most damage is still coming from chop or flip exits. Tighten filters before scaling.';
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      summary: {
        closedTrades: closed.length,
        wins: wins.length,
        losses: losses.length,
        winRatePct,
        avgWin,
        avgLoss: -avgLossAbs,
        payoffRatio,
        expectancyPerTrade,
        profitFactor,
        grossProfit,
        grossLoss: -grossLossAbs,
        netRealised,
        maxDrawdownPct
      },
      health: {
        state: healthState,
        label,
        pill,
        summary
      },
      byReason,
      qualityBuckets,
      durationBuckets,
      byPair,
      dailyPnl,
      recentClosed
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
  }
}
