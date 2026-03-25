import { query } from '../lib/db.js';

function calcDurationMinutes(startIso, endIso = null) {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 60000));
}

export default async function handler(req, res) {
  try {
    const portfolioRows = await query(`select * from sf_portfolio where id = 'main' limit 1`);
    const openRows = await query(`select * from sf_positions where portfolio_id = 'main' and status = 'open' order by opened_at desc`);
    const marketRows = await query(`select * from sf_markets order by quality_score desc, updated_at desc`);
    const snapshotRows = await query(`select * from sf_snapshots where portfolio_id = 'main' order by snapshot_day asc`);
    const tradeRows = await query(`select * from sf_trades where portfolio_id = 'main' order by created_at desc limit 50`);

    const portfolio = portfolioRows.rows[0] || null;
    const openPositions = openRows.rows || [];
    const markets = marketRows.rows || [];
    const activeMarket = markets[0] || null;
    const snapshots = snapshotRows.rows || [];
    const trades = tradeRows.rows || [];
    const closed = trades.filter(t => t.type === 'CLOSE');

    const marketMap = Object.fromEntries(markets.map(m => [m.pair, m]));
    const positionsUi = openPositions.map(pos => {
      const market = marketMap[pos.pair];
      const lp = Number(market?.last_price || 0);
      const pnl = lp
        ? (pos.side === 'BUY'
            ? (lp - Number(pos.entry_price)) * Number(pos.units)
            : (Number(pos.entry_price) - lp) * Number(pos.units))
        : 0;
      const pct = Number(pos.notional_gbp || 0) ? (pnl / Number(pos.notional_gbp)) * 100 : 0;
      return {
        ...pos,
        last_price: market?.last_price || null,
        open_pnl_gbp: pnl,
        open_pnl_pct: pct,
        signal_decision: market?.decision || 'HOLD',
        quality_score: market?.quality_score || 0,
        confidence_pct: market?.confidence_pct || 0,
        duration_minutes: calcDurationMinutes(pos.opened_at)
      };
    });

    const openPnl = positionsUi.reduce((sum, p) => sum + Number(p.open_pnl_gbp || 0), 0);
    const exposure = positionsUi.reduce((sum, p) => sum + Number(p.notional_gbp || 0), 0);
    const currentEquity = portfolio ? Number(portfolio.cash_gbp) + exposure + openPnl : 0;

    const currentDate = new Date();
    const keyFor = (daysAgo) => {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().slice(0, 10);
    };
    const baseFor = (daysAgo) => {
      const key = keyFor(daysAgo);
      const matches = snapshots
        .filter(s => s.snapshot_day <= key)
        .sort((a, b) => String(a.snapshot_day).localeCompare(String(b.snapshot_day)));
      return matches.length ? Number(matches[matches.length - 1].equity_gbp) : Number(portfolio?.starting_balance_gbp || 0);
    };

    const dayBase = baseFor(1);
    const weekBase = baseFor(7);
    const dayReturnPct = dayBase ? ((currentEquity - dayBase) / dayBase) * 100 : 0;
    const weekReturnPct = weekBase ? ((currentEquity - weekBase) / weekBase) * 100 : 0;
    const winCount = closed.filter(t => Number(t.pnl_gbp || 0) > 0).length;
    const winRate = closed.length ? (winCount / closed.length) * 100 : 0;

    const readyMarkets = markets.map(m => ({
      ...m,
      status: positionsUi.some(p => p.pair === m.pair)
        ? 'IN TRADE'
        : (m.decision === 'BUY' || m.decision === 'SELL') ? 'READY' : 'WAIT'
    }));

    const equityHistory = snapshots.map((s, i) => ({
      label: s.snapshot_day,
      equity: Number(s.equity_gbp || 0),
      idx: i
    }));

    const whyThisTrade = activeMarket ? {
      pair: activeMarket.pair,
      state: activeMarket.state,
      decision: activeMarket.decision,
      bullPct: Number(activeMarket.bull_pct || 0),
      bearPct: Number(activeMarket.bear_pct || 0),
      chopPct: Number(activeMarket.chop_pct || 0),
      confidencePct: Number(activeMarket.confidence_pct || 0),
      qualityScore: Number(activeMarket.quality_score || 0),
      threshold: Number(activeMarket.adaptive_threshold || 0),
      explanation:
        activeMarket.decision === 'BUY'
          ? 'Bull regime is dominant and both confidence and quality are above threshold, so the engine is willing to go long.'
          : activeMarket.decision === 'SELL'
            ? 'Bear regime is dominant and both confidence and quality are above threshold, so the engine is willing to go short.'
            : 'Conditions are too mixed or not strong enough versus threshold, so the engine is waiting.'
    } : null;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      portfolio,
      activeMarket,
      openPositions: positionsUi,
      readyMarkets,
      equityHistory,
      whyThisTrade,
      metrics: {
        currentEquity,
        exposure,
        openPnl,
        dayReturnPct,
        weekReturnPct,
        winRate,
        tradeCount: closed.length
      }
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
  }
}
