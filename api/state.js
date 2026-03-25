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
    const snapshotRows = await query(`select * from sf_snapshots where portfolio_id = 'main' order by snapshot_at asc limit 300`);
    const tradeRows = await query(`select * from sf_trades where portfolio_id = 'main' order by created_at desc limit 100`);
    const configRows = await query(`select value from sf_app_config where key = 'settings' limit 1`);
    const effectiveRows = await query(`select value from sf_app_config where key = 'effective_settings' limit 1`);
    const optimiserRows = await query(`select * from sf_optimizer_events where portfolio_id = 'main' order by changed_at desc limit 20`);

    const portfolio = portfolioRows.rows[0] || null;
    const openPositions = openRows.rows || [];
    const markets = marketRows.rows || [];
    const activeMarket = markets[0] || null;
    const snapshots = snapshotRows.rows || [];
    const trades = tradeRows.rows || [];
    const closed = trades.filter(t => t.type === 'CLOSE');
    const config = configRows.rows[0]?.value || null;
    const effectiveConfig = effectiveRows.rows[0]?.value || config || null;
    const optimiserEvents = optimiserRows.rows || [];

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
      const nextAction = pos.side === 'BUY'
        ? `Stop ${Number(pos.stop_loss_price || 0).toLocaleString(undefined,{maximumFractionDigits:2})} / TP ${Number(pos.take_profit_price || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`
        : `Stop ${Number(pos.stop_loss_price || 0).toLocaleString(undefined,{maximumFractionDigits:2})} / TP ${Number(pos.take_profit_price || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`;

      return {
        ...pos,
        last_price: market?.last_price || null,
        open_pnl_gbp: pnl,
        open_pnl_pct: pct,
        signal_decision: market?.decision || 'HOLD',
        quality_score: market?.quality_score || pos.quality_score || 0,
        confidence_pct: market?.confidence_pct || pos.confidence_pct || 0,
        duration_minutes: calcDurationMinutes(pos.opened_at),
        next_action: nextAction
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
      const matches = snapshots.filter(s => String(s.snapshot_day) <= key).sort((a,b)=>String(a.snapshot_day).localeCompare(String(b.snapshot_day)));
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
      status: positionsUi.some(p => p.pair === m.pair) ? 'IN TRADE' : ((m.decision === 'BUY' || m.decision === 'SELL') ? 'READY' : 'WAIT')
    }));

    const equityHistory = snapshots.map((s) => ({
      label: new Date(s.snapshot_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: s.snapshot_at,
      equity: Number(s.equity_gbp || 0)
    }));

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      config,
      effectiveConfig,
      optimiserEvents,
      portfolio,
      activeMarket,
      openPositions: positionsUi,
      readyMarkets,
      equityHistory,
      trades,
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
