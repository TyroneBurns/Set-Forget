import { query } from '../lib/db.js';
import { runHmmRegime, enrichSignal } from '../lib/signal-engine.js';

const PORTFOLIO_ID = 'main';
const DEFAULT_PAIRS = (process.env.DEFAULT_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT').split(',').map(s => s.trim()).filter(Boolean);
const TIMEFRAME = process.env.DEFAULT_TIMEFRAME || '15m';
const STARTING_BANKROLL = Number(process.env.STARTING_BANKROLL_GBP || 1000);
const RISK_PER_TRADE = Number(process.env.RISK_PER_TRADE_PCT || 25);
const BASE_CONFIDENCE = Number(process.env.BASE_CONFIDENCE || 65);
const TEST_WINDOW_DAYS = Number(process.env.TEST_WINDOW_DAYS || 7);

async function fetchKlines(symbol, interval = TIMEFRAME, limit = 250) {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Klines failed for ${symbol}`);
  const rows = await res.json();
  return rows.map((k) => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: k[6]
  }));
}

async function ensurePortfolio() {
  await query(`
    insert into sf_portfolio (id, starting_balance_gbp, cash_gbp, peak_equity_gbp, risk_per_trade_pct, base_confidence, test_window_days)
    values ($1,$2,$2,$2,$3,$4,$5)
    on conflict (id) do nothing
  `, [PORTFOLIO_ID, STARTING_BANKROLL, RISK_PER_TRADE, BASE_CONFIDENCE, TEST_WINDOW_DAYS]);
}

async function getPortfolio() {
  const { rows } = await query(`select * from sf_portfolio where id = $1`, [PORTFOLIO_ID]);
  return rows[0];
}

async function getOpenPosition() {
  const { rows } = await query(`
    select * from sf_positions
    where portfolio_id = $1 and status = 'open'
    order by opened_at desc
    limit 1
  `, [PORTFOLIO_ID]);
  return rows[0] || null;
}

async function getRecentTradeMeta(pair) {
  const { rows } = await query(`
    select
      count(*)::int as trade_count,
      coalesce(sum(pnl_gbp), 0)::numeric as total_pnl,
      coalesce(sum(notional_gbp), 0)::numeric as total_notional
    from sf_trades
    where portfolio_id = $1
      and pair = $2
      and type = 'CLOSE'
      and created_at >= now() - interval '7 days'
  `, [PORTFOLIO_ID, pair]);

  const row = rows[0];
  const notional = Number(row.total_notional || 0);
  const pct = notional > 0 ? (Number(row.total_pnl || 0) / notional) * 100 : 0;
  return { recentReturnPct: pct, recentTradeCount: Number(row.trade_count || 0) };
}

function computeOpenPnl(pos, lastPrice) {
  if (!pos || !lastPrice) return 0;
  return pos.side === 'BUY'
    ? (lastPrice - Number(pos.entry_price)) * Number(pos.units)
    : (Number(pos.entry_price) - lastPrice) * Number(pos.units);
}

async function upsertMarket(pair, timeframe, signal, lastPrice) {
  await query(`
    insert into sf_markets (
      pair, timeframe, state, bull_pct, bear_pct, chop_pct, confidence_pct, spread_pct,
      quality_score, adaptive_threshold, decision, last_price, updated_at
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
    on conflict (pair) do update set
      timeframe = excluded.timeframe,
      state = excluded.state,
      bull_pct = excluded.bull_pct,
      bear_pct = excluded.bear_pct,
      chop_pct = excluded.chop_pct,
      confidence_pct = excluded.confidence_pct,
      spread_pct = excluded.spread_pct,
      quality_score = excluded.quality_score,
      adaptive_threshold = excluded.adaptive_threshold,
      decision = excluded.decision,
      last_price = excluded.last_price,
      updated_at = now()
  `, [pair, timeframe, signal.state, signal.bull, signal.bear, signal.chop, signal.confidence, signal.spread, signal.quality, signal.adaptiveThreshold, signal.decision, lastPrice]);

  await query(`
    insert into sf_signals (
      pair, timeframe, state, bull_pct, bear_pct, chop_pct, confidence_pct, spread_pct,
      quality_score, adaptive_threshold, decision, last_price
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [pair, timeframe, signal.state, signal.bull, signal.bear, signal.chop, signal.confidence, signal.spread, signal.quality, signal.adaptiveThreshold, signal.decision, lastPrice]);
}

async function closePosition(pos, exitPrice, portfolio) {
  const pnl = pos.side === 'BUY'
    ? (exitPrice - Number(pos.entry_price)) * Number(pos.units)
    : (Number(pos.entry_price) - exitPrice) * Number(pos.units);

  const newCash = Number(portfolio.cash_gbp) + Number(pos.notional_gbp) + pnl;
  const newRealised = Number(portfolio.realised_pnl_gbp) + pnl;

  await query(`
    update sf_positions
    set status = 'closed', closed_at = now()
    where id = $1
  `, [pos.id]);

  await query(`
    insert into sf_trades (
      portfolio_id, pair, side, units, notional_gbp, entry_price, exit_price, pnl_gbp, type, source, opened_at, closed_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,'CLOSE',$9,$10, now())
  `, [PORTFOLIO_ID, pos.pair, pos.side, pos.units, pos.notional_gbp, pos.entry_price, exitPrice, pnl, pos.source, pos.opened_at]);

  await query(`
    update sf_portfolio
    set cash_gbp = $2, realised_pnl_gbp = $3, updated_at = now()
    where id = $1
  `, [PORTFOLIO_ID, newCash, newRealised]);
}

async function openPosition(pair, side, price, portfolio) {
  const equity = Number(portfolio.cash_gbp) + 0;
  const notional = +(equity * (Number(portfolio.risk_per_trade_pct) / 100)).toFixed(2);
  if (notional <= 0 || Number(portfolio.cash_gbp) < notional) return;

  const units = +(notional / price).toFixed(8);
  const newCash = Number(portfolio.cash_gbp) - notional;

  await query(`
    insert into sf_positions (
      portfolio_id, pair, side, entry_price, units, notional_gbp, source, status
    ) values ($1,$2,$3,$4,$5,$6,'auto','open')
  `, [PORTFOLIO_ID, pair, side, price, units, notional]);

  await query(`
    insert into sf_trades (
      portfolio_id, pair, side, units, notional_gbp, entry_price, type, source, opened_at
    ) values ($1,$2,$3,$4,$5,$6,'OPEN','auto', now())
  `, [PORTFOLIO_ID, pair, side, units, notional, price]);

  await query(`
    update sf_portfolio
    set cash_gbp = $2, updated_at = now()
    where id = $1
  `, [PORTFOLIO_ID, newCash]);
}

async function updateSnapshot(portfolio, openPnl) {
  const equity = Number(portfolio.cash_gbp) + openPnl + (Number((await getOpenPosition())?.notional_gbp || 0));
  const peak = Math.max(Number(portfolio.peak_equity_gbp), equity);
  const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  const maxDd = Math.max(Number(portfolio.max_drawdown_pct), dd);

  await query(`
    update sf_portfolio
    set peak_equity_gbp = $2, max_drawdown_pct = $3, updated_at = now()
    where id = $1
  `, [PORTFOLIO_ID, peak, maxDd]);

  await query(`
    insert into sf_snapshots (
      portfolio_id, snapshot_day, equity_gbp, cash_gbp, open_pnl_gbp, realised_pnl_gbp
    ) values ($1, current_date, $2, $3, $4, $5)
    on conflict (portfolio_id, snapshot_day) do update set
      equity_gbp = excluded.equity_gbp,
      cash_gbp = excluded.cash_gbp,
      open_pnl_gbp = excluded.open_pnl_gbp,
      realised_pnl_gbp = excluded.realised_pnl_gbp,
      created_at = now()
  `, [PORTFOLIO_ID, equity, portfolio.cash_gbp, openPnl, portfolio.realised_pnl_gbp]);
}

async function main() {
  await ensurePortfolio();

  let activePairSignal = null;
  let activeLastPrice = null;
  const portfolioBefore = await getPortfolio();
  const openBefore = await getOpenPosition();

  for (const pair of DEFAULT_PAIRS) {
    const candles = await fetchKlines(pair, TIMEFRAME, 250);
    const closed = candles.slice(0, -1);
    const baseSignal = runHmmRegime(closed);
    const meta = await getRecentTradeMeta(pair);
    const signal = enrichSignal(baseSignal, {
      baseThreshold: Number(portfolioBefore.base_confidence),
      recentReturnPct: meta.recentReturnPct,
      recentTradeCount: meta.recentTradeCount
    });
    const lastPrice = closed[closed.length - 1]?.close ?? null;

    await upsertMarket(pair, TIMEFRAME, signal, lastPrice);

    if (pair === DEFAULT_PAIRS[0]) {
      activePairSignal = signal;
      activeLastPrice = lastPrice;
    }
  }

  let portfolio = await getPortfolio();
  let openPos = await getOpenPosition();

  if (openPos && openPos.pair === DEFAULT_PAIRS[0] && activePairSignal && activeLastPrice) {
    const currentSignalSide = activePairSignal.decision === 'BUY' ? 'BUY' : activePairSignal.decision === 'SELL' ? 'SELL' : 'HOLD';
    if (currentSignalSide !== 'HOLD' && currentSignalSide !== openPos.side) {
      await closePosition(openPos, activeLastPrice, portfolio);
      portfolio = await getPortfolio();
      openPos = null;
    }
  }

  if (!openPos && activePairSignal && activeLastPrice) {
    if (activePairSignal.decision === 'BUY') {
      await openPosition(DEFAULT_PAIRS[0], 'BUY', activeLastPrice, portfolio);
    } else if (activePairSignal.decision === 'SELL') {
      await openPosition(DEFAULT_PAIRS[0], 'SELL', activeLastPrice, portfolio);
    }
  }

  portfolio = await getPortfolio();
  openPos = await getOpenPosition();
  const openPnl = openPos && activeLastPrice ? computeOpenPnl(openPos, activeLastPrice) : 0;
  await updateSnapshot(portfolio, openPnl);

  console.log(JSON.stringify({
    ok: true,
    pair: DEFAULT_PAIRS[0],
    decision: activePairSignal?.decision || 'HOLD',
    lastPrice: activeLastPrice,
    openPnl,
    timestamp: new Date().toISOString()
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
