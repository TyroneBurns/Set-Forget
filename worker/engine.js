import { query } from '../lib/db.js';
import { runHmmRegime, enrichSignal } from '../lib/signal-engine.js';

const PORTFOLIO_ID = 'main';

const DEFAULT_CONFIG = {
  marketDataSource: 'Binance public candles',
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  interval: '15m',
  refreshSeconds: 300,
  lookbackPeriod: 20,
  minConfidencePct: 68,
  pBullBull: 0.8,
  pBearBear: 0.8,
  pChopChop: 0.6,
  startBalance: 1000,
  riskPerTradePct: 10,
  stopLossPct: 2,
  takeProfitPct: 4,
  exitOnChop: true,
  testWindowDays: 7
};

function toNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normaliseConfig(value = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(value || {}) };
  cfg.symbols = Array.isArray(cfg.symbols)
    ? cfg.symbols.map(v => String(v).trim().toUpperCase()).filter(Boolean)
    : String(cfg.symbols || DEFAULT_CONFIG.symbols.join(',')).split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
  cfg.interval = String(cfg.interval || '15m');
  cfg.lookbackPeriod = Math.max(5, Math.round(toNumber(cfg.lookbackPeriod, DEFAULT_CONFIG.lookbackPeriod)));
  cfg.minConfidencePct = Math.max(40, Math.min(95, toNumber(cfg.minConfidencePct, DEFAULT_CONFIG.minConfidencePct)));
  cfg.pBullBull = Math.max(0.05, Math.min(0.99, toNumber(cfg.pBullBull, DEFAULT_CONFIG.pBullBull)));
  cfg.pBearBear = Math.max(0.05, Math.min(0.99, toNumber(cfg.pBearBear, DEFAULT_CONFIG.pBearBear)));
  cfg.pChopChop = Math.max(0.05, Math.min(0.99, toNumber(cfg.pChopChop, DEFAULT_CONFIG.pChopChop)));
  cfg.startBalance = Math.max(100, toNumber(cfg.startBalance, DEFAULT_CONFIG.startBalance));
  cfg.riskPerTradePct = Math.max(1, Math.min(100, toNumber(cfg.riskPerTradePct, DEFAULT_CONFIG.riskPerTradePct)));
  cfg.stopLossPct = Math.max(0.1, Math.min(50, toNumber(cfg.stopLossPct, DEFAULT_CONFIG.stopLossPct)));
  cfg.takeProfitPct = Math.max(0.1, Math.min(100, toNumber(cfg.takeProfitPct, DEFAULT_CONFIG.takeProfitPct)));
  cfg.exitOnChop = Boolean(cfg.exitOnChop);
  cfg.refreshSeconds = Math.max(15, Math.round(toNumber(cfg.refreshSeconds, DEFAULT_CONFIG.refreshSeconds)));
  cfg.testWindowDays = Math.max(1, Math.round(toNumber(cfg.testWindowDays, DEFAULT_CONFIG.testWindowDays)));
  return cfg;
}

async function getConfig() {
  const { rows } = await query(`select value from sf_app_config where key = 'settings' limit 1`);
  if (!rows.length) {
    await query(`
      insert into sf_app_config (key, value)
      values ('settings', $1::jsonb)
      on conflict (key) do nothing
    `, [JSON.stringify(DEFAULT_CONFIG)]);
    return DEFAULT_CONFIG;
  }
  return normaliseConfig(rows[0].value);
}

async function fetchJsonWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'user-agent': 'set-and-forget/7.0'
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchKlines(symbol, interval = '15m', limit = 250) {
  const urls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  ];

  let lastError = 'unknown error';

  for (const url of urls) {
    try {
      const res = await fetchJsonWithTimeout(url, 15000);
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${new URL(url).host}`;
        continue;
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        lastError = `Empty data from ${new URL(url).host}`;
        continue;
      }
      return rows.map((k) => ({
        openTime: k[0],
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: k[6]
      }));
    } catch (err) {
      lastError = `${new URL(url).host}: ${err.message}`;
    }
  }

  throw new Error(`Klines failed for ${symbol}: ${lastError}`);
}

async function ensurePortfolio(cfg) {
  await query(`
    insert into sf_portfolio (
      id, starting_balance_gbp, cash_gbp, peak_equity_gbp,
      risk_per_trade_pct, base_confidence, test_window_days
    )
    values ($1,$2,$2,$2,$3,$4,$5)
    on conflict (id) do update set
      risk_per_trade_pct = excluded.risk_per_trade_pct,
      base_confidence = excluded.base_confidence,
      test_window_days = excluded.test_window_days,
      updated_at = now()
  `, [
    PORTFOLIO_ID,
    cfg.startBalance,
    cfg.riskPerTradePct,
    cfg.minConfidencePct,
    cfg.testWindowDays
  ]);
}

async function getPortfolio() {
  const { rows } = await query(`select * from sf_portfolio where id = $1`, [PORTFOLIO_ID]);
  return rows[0];
}

async function getOpenPositions() {
  const { rows } = await query(`
    select * from sf_positions
    where portfolio_id = $1 and status = 'open'
    order by opened_at desc
  `, [PORTFOLIO_ID]);
  return rows;
}

async function getRecentTradeMeta(pair, testWindowDays) {
  const { rows } = await query(`
    select
      count(*)::int as trade_count,
      coalesce(sum(pnl_gbp), 0)::numeric as total_pnl,
      coalesce(sum(notional_gbp), 0)::numeric as total_notional
    from sf_trades
    where portfolio_id = $1
      and pair = $2
      and type = 'CLOSE'
      and created_at >= now() - ($3 || ' days')::interval
  `, [PORTFOLIO_ID, pair, String(testWindowDays)]);

  const row = rows[0];
  const notional = Number(row.total_notional || 0);
  const pct = notional > 0 ? (Number(row.total_pnl || 0) / notional) * 100 : 0;
  return {
    recentReturnPct: pct,
    recentTradeCount: Number(row.trade_count || 0)
  };
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
  `, [
    pair, timeframe, signal.state, signal.bull, signal.bear, signal.chop,
    signal.confidence, signal.spread, signal.quality, signal.adaptiveThreshold,
    signal.decision, lastPrice
  ]);

  await query(`
    insert into sf_signals (
      pair, timeframe, state, bull_pct, bear_pct, chop_pct, confidence_pct, spread_pct,
      quality_score, adaptive_threshold, decision, last_price
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    pair, timeframe, signal.state, signal.bull, signal.bear, signal.chop,
    signal.confidence, signal.spread, signal.quality, signal.adaptiveThreshold,
    signal.decision, lastPrice
  ]);
}

async function closePosition(pos, exitPrice, portfolio, reason = 'signal_flip') {
  const pnl = pos.side === 'BUY'
    ? (exitPrice - Number(pos.entry_price)) * Number(pos.units)
    : (Number(pos.entry_price) - exitPrice) * Number(pos.units);

  const newCash = Number(portfolio.cash_gbp) + Number(pos.notional_gbp) + pnl;
  const newRealised = Number(portfolio.realised_pnl_gbp) + pnl;

  await query(`update sf_positions set status = 'closed', closed_at = now() where id = $1`, [pos.id]);

  await query(`
    insert into sf_trades (
      portfolio_id, pair, side, units, notional_gbp, entry_price, exit_price,
      pnl_gbp, type, source, reason, opened_at, closed_at
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,'CLOSE',$9,$10,$11, now())
  `, [
    PORTFOLIO_ID, pos.pair, pos.side, pos.units, pos.notional_gbp,
    pos.entry_price, exitPrice, pnl, pos.source, reason, pos.opened_at
  ]);

  await query(`
    update sf_portfolio
    set cash_gbp = $2, realised_pnl_gbp = $3, updated_at = now()
    where id = $1
  `, [PORTFOLIO_ID, newCash, newRealised]);
}

function getRiskPrices(side, entryPrice, stopLossPct, takeProfitPct) {
  if (side === 'BUY') {
    return {
      stopLossPrice: entryPrice * (1 - stopLossPct / 100),
      takeProfitPrice: entryPrice * (1 + takeProfitPct / 100)
    };
  }
  return {
    stopLossPrice: entryPrice * (1 + stopLossPct / 100),
    takeProfitPrice: entryPrice * (1 - takeProfitPct / 100)
  };
}

async function openPosition(pair, side, price, portfolio, cfg) {
  const currentCash = Number(portfolio.cash_gbp);
  const notional = +(currentCash * (Number(cfg.riskPerTradePct) / 100)).toFixed(2);

  if (notional <= 0 || currentCash < notional) return false;

  const units = +(notional / price).toFixed(8);
  const newCash = currentCash - notional;
  const { stopLossPrice, takeProfitPrice } = getRiskPrices(side, price, cfg.stopLossPct, cfg.takeProfitPct);

  await query(`
    insert into sf_positions (
      portfolio_id, pair, side, entry_price, units, notional_gbp,
      stop_loss_price, take_profit_price, source, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,'auto','open')
  `, [
    PORTFOLIO_ID, pair, side, price, units, notional, stopLossPrice, takeProfitPrice
  ]);

  await query(`
    insert into sf_trades (
      portfolio_id, pair, side, units, notional_gbp, entry_price,
      type, source, reason, opened_at
    )
    values ($1,$2,$3,$4,$5,$6,'OPEN','auto','signal_entry', now())
  `, [PORTFOLIO_ID, pair, side, units, notional, price]);

  await query(`
    update sf_portfolio
    set cash_gbp = $2, updated_at = now()
    where id = $1
  `, [PORTFOLIO_ID, newCash]);

  return true;
}

function shouldCloseForRisk(pos, lastPrice, cfg, marketSignal) {
  const stop = Number(pos.stop_loss_price || 0);
  const take = Number(pos.take_profit_price || 0);

  if (pos.side === 'BUY') {
    if (stop && lastPrice <= stop) return 'stop_loss';
    if (take && lastPrice >= take) return 'take_profit';
  } else {
    if (stop && lastPrice >= stop) return 'stop_loss';
    if (take && lastPrice <= take) return 'take_profit';
  }

  if (cfg.exitOnChop && marketSignal?.state === 'NO TRADE') return 'chop_exit';
  return null;
}

async function updateSnapshot(portfolio, marketMap) {
  const openPositions = await getOpenPositions();

  const openPnl = openPositions.reduce((sum, pos) => {
    const lp = marketMap[pos.pair]?.lastPrice;
    return sum + computeOpenPnl(pos, lp);
  }, 0);

  const exposure = openPositions.reduce((sum, pos) => sum + Number(pos.notional_gbp || 0), 0);
  const equity = Number(portfolio.cash_gbp) + exposure + openPnl;
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
    )
    values ($1, current_date, $2, $3, $4, $5)
    on conflict (portfolio_id, snapshot_day) do update set
      equity_gbp = excluded.equity_gbp,
      cash_gbp = excluded.cash_gbp,
      open_pnl_gbp = excluded.open_pnl_gbp,
      realised_pnl_gbp = excluded.realised_pnl_gbp,
      created_at = now()
  `, [PORTFOLIO_ID, equity, portfolio.cash_gbp, openPnl, portfolio.realised_pnl_gbp]);

  return { equity, openPnl, exposure };
}

async function main() {
  const cfg = await getConfig();
  await ensurePortfolio(cfg);

  const marketMap = {};
  let successCount = 0;

  for (const pair of cfg.symbols) {
    try {
      const candles = await fetchKlines(pair, cfg.interval, 250);
      const closed = candles.slice(0, -1);

      const baseSignal = runHmmRegime(closed, {
        length: cfg.lookbackPeriod,
        pStayBull: cfg.pBullBull,
        pStayBear: cfg.pBearBear,
        pStayChop: cfg.pChopChop
      });

      const meta = await getRecentTradeMeta(pair, cfg.testWindowDays);

      const signal = enrichSignal(baseSignal, {
        baseThreshold: cfg.minConfidencePct,
        recentReturnPct: meta.recentReturnPct,
        recentTradeCount: meta.recentTradeCount
      });

      const lastPrice = closed[closed.length - 1]?.close ?? null;
      marketMap[pair] = { signal, lastPrice };

      await upsertMarket(pair, cfg.interval, signal, lastPrice);
      successCount += 1;
    } catch (err) {
      console.error(`Skipping ${pair}: ${err.message}`);
    }
  }

  if (successCount === 0) {
    throw new Error('All market data providers failed for all configured pairs');
  }

  let portfolio = await getPortfolio();
  let openPositions = await getOpenPositions();

  for (const pos of openPositions) {
    const market = marketMap[pos.pair];
    if (!market?.lastPrice) continue;

    const reason = shouldCloseForRisk(pos, market.lastPrice, cfg, market.signal);
    if (reason) {
      await closePosition(pos, market.lastPrice, portfolio, reason);
      portfolio = await getPortfolio();
    }
  }

  openPositions = await getOpenPositions();

  for (const pair of cfg.symbols) {
    const market = marketMap[pair];
    if (!market?.lastPrice || !market?.signal) continue;

    const existing = openPositions.find((p) => p.pair === pair);
    const desired =
      market.signal.decision === 'BUY' ? 'BUY' :
      market.signal.decision === 'SELL' ? 'SELL' :
      'HOLD';

    if (existing && desired !== 'HOLD' && desired !== existing.side) {
      await closePosition(existing, market.lastPrice, portfolio, 'signal_flip');
      portfolio = await getPortfolio();
      openPositions = await getOpenPositions();
    }

    const stillOpen = openPositions.find((p) => p.pair === pair);
    if (!stillOpen && desired !== 'HOLD') {
      const opened = await openPosition(pair, desired, market.lastPrice, portfolio, cfg);
      if (opened) {
        portfolio = await getPortfolio();
        openPositions = await getOpenPositions();
      }
    }
  }

  portfolio = await getPortfolio();
  const snapshot = await updateSnapshot(portfolio, marketMap);
  const finalOpen = await getOpenPositions();

  console.log(JSON.stringify({
    ok: true,
    processedPairs: successCount,
    symbols: cfg.symbols,
    interval: cfg.interval,
    openPositions: finalOpen.length,
    exposure: snapshot.exposure,
    equity: snapshot.equity,
    openPnl: snapshot.openPnl,
    timestamp: new Date().toISOString()
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
