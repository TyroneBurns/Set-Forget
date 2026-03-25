import { query } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    const portfolioRows = await query(`select * from sf_portfolio where id = 'main' limit 1`);
    const posRows = await query(`select * from sf_positions where portfolio_id = 'main' and status = 'open' order by opened_at desc limit 1`);
    const marketRows = await query(`select * from sf_markets order by updated_at desc`);
    const snapshotRows = await query(`select * from sf_snapshots where portfolio_id = 'main' order by snapshot_day asc`);
    const closedTradeRows = await query(`select * from sf_trades where portfolio_id = 'main' and type = 'CLOSE' order by created_at desc`);

    const portfolio = portfolioRows.rows[0] || null;
    const openPosition = posRows.rows[0] || null;
    const activeMarket = marketRows.rows[0] || null;
    const snapshots = snapshotRows.rows || [];
    const closed = closedTradeRows.rows || [];

    const currentEquity = portfolio
      ? Number(portfolio.cash_gbp) + Number(openPosition?.notional_gbp || 0)
      : 0;

    const currentDate = new Date();
    const keyFor = (daysAgo) => {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().slice(0,10);
    };
    const baseFor = (daysAgo) => {
      const key = keyFor(daysAgo);
      const matches = snapshots.filter(s => s.snapshot_day <= key).sort((a,b)=>String(a.snapshot_day).localeCompare(String(b.snapshot_day)));
      return matches.length ? Number(matches[matches.length - 1].equity_gbp) : Number(portfolio?.starting_balance_gbp || 0);
    };
    const dayBase = baseFor(1);
    const weekBase = baseFor(7);
    const dayReturnPct = dayBase ? ((currentEquity - dayBase) / dayBase) * 100 : 0;
    const weekReturnPct = weekBase ? ((currentEquity - weekBase) / weekBase) * 100 : 0;

    const winCount = closed.filter(t => Number(t.pnl_gbp || 0) > 0).length;
    const winRate = closed.length ? (winCount / closed.length) * 100 : 0;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      portfolio,
      openPosition,
      activeMarket,
      metrics: {
        currentEquity,
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
