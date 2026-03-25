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
  testWindowDays: 7,
  maxOpenPositions: 3,
  maxCorrelatedPositions: 3,
  sizingMode: 'confidence_weighted',
  autoOptimise: false,
  autoRiskAdjust: false,
  autoThresholdAdjust: false,
  optimiserLookbackDays: 7
};

function toNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normaliseConfig(value = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(value || {}) };
  cfg.symbols = Array.isArray(cfg.symbols)
    ? cfg.symbols.map(v => String(v).trim().toUpperCase()).filter(Boolean)
    : String(cfg.symbols || DEFAULT_CONFIG.symbols.join(',')).split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
  cfg.interval = String(cfg.interval || '15m');
  cfg.lookbackPeriod = Math.max(5, Math.round(toNumber(cfg.lookbackPeriod, DEFAULT_CONFIG.lookbackPeriod)));
  cfg.minConfidencePct = clamp(toNumber(cfg.minConfidencePct, DEFAULT_CONFIG.minConfidencePct), 40, 95);
  cfg.pBullBull = clamp(toNumber(cfg.pBullBull, DEFAULT_CONFIG.pBullBull), 0.05, 0.99);
  cfg.pBearBear = clamp(toNumber(cfg.pBearBear, DEFAULT_CONFIG.pBearBear), 0.05, 0.99);
  cfg.pChopChop = clamp(toNumber(cfg.pChopChop, DEFAULT_CONFIG.pChopChop), 0.05, 0.99);
  cfg.startBalance = Math.max(100, toNumber(cfg.startBalance, DEFAULT_CONFIG.startBalance));
  cfg.riskPerTradePct = clamp(toNumber(cfg.riskPerTradePct, DEFAULT_CONFIG.riskPerTradePct), 1, 100);
  cfg.stopLossPct = clamp(toNumber(cfg.stopLossPct, DEFAULT_CONFIG.stopLossPct), 0.1, 50);
  cfg.takeProfitPct = clamp(toNumber(cfg.takeProfitPct, DEFAULT_CONFIG.takeProfitPct), 0.1, 100);
  cfg.exitOnChop = Boolean(cfg.exitOnChop);
  cfg.refreshSeconds = Math.max(15, Math.round(toNumber(cfg.refreshSeconds, DEFAULT_CONFIG.refreshSeconds)));
  cfg.testWindowDays = Math.max(1, Math.round(toNumber(cfg.testWindowDays, DEFAULT_CONFIG.testWindowDays)));
  cfg.maxOpenPositions = clamp(Math.round(toNumber(cfg.maxOpenPositions, DEFAULT_CONFIG.maxOpenPositions)), 1, 20);
  cfg.maxCorrelatedPositions = clamp(Math.round(toNumber(cfg.maxCorrelatedPositions, DEFAULT_CONFIG.maxCorrelatedPositions)), 1, 20);
  cfg.sizingMode = ['fixed', 'confidence_weighted'].includes(String(cfg.sizingMode)) ? String(cfg.sizingMode) : DEFAULT_CONFIG.sizingMode;
  cfg.autoOptimise = Boolean(cfg.autoOptimise);
  cfg.autoRiskAdjust = Boolean(cfg.autoRiskAdjust);
  cfg.autoThresholdAdjust = Boolean(cfg.autoThresholdAdjust);
  cfg.optimiserLookbackDays = clamp(Math.round(toNumber(cfg.optimiserLookbackDays, DEFAULT_CONFIG.optimiserLookbackDays)), 3, 60);
  return cfg;
}

async function getConfig() {
  const rows = await query(`select value from sf_app_config where key = 'settings' limit 1`);
  if (!rows.rows.length) {
    await query(`insert into sf_app_config (key, value) values ('settings', $1::jsonb) on conflict (key) do nothing`, [JSON.stringify(DEFAULT_CONFIG)]);
    return { user: DEFAULT_CONFIG, effective: DEFAULT_CONFIG };
  }
  const user = normaliseConfig(rows.rows[0].value);
  const effectiveRows = await query(`select value from sf_app_config where key = 'effective_settings' limit 1`);
  const effective = effectiveRows.rows.length ? normaliseConfig(effectiveRows.rows[0].value) : user;
  return { user, effective };
}

async function saveEffectiveConfig(previousCfg, newCfg, reason, summary) {
  await query(`
    insert into sf_app_config (key, value)
    values ('effective_settings', $1::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `, [JSON.stringify(newCfg)]);

  await query(`
    insert into sf_optimizer_events (portfolio_id, reason, previous_value, new_value, summary)
    values ($1,$2,$3::jsonb,$4::jsonb,$5)
  `, [PORTFOLIO_ID, reason, JSON.stringify(previousCfg), JSON.stringify(newCfg), summary]);
}

async function maybeOptimise(userCfg, effectiveCfg) {
  if (!userCfg.autoOptimise || (!userCfg.autoRiskAdjust && !userCfg.autoThresholdAdjust)) {
    const desired = normaliseConfig(userCfg);
    await query(`
      insert into sf_app_config (key, value)
      values ('effective_settings', $1::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [JSON.stringify(desired)]);
    return desired;
  }

  const lookback = userCfg.optimiserLookbackDays;
  const perfRows = await query(`
    select
      count(*)::int as trade_count,
      coalesce(avg(case when pnl_gbp > 0 then 1 else 0 end), 0)::numeric as win_rate,
      coalesce(sum(pnl_gbp), 0)::numeric as total_pnl,
      coalesce(sum(notional_gbp), 0)::numeric as total_notional
    from sf_trades
    where portfolio_id = $1
      and type = 'CLOSE'
      and created_at >= now() - ($2 || ' days')::interval
  `, [PORTFOLIO_ID, String(lookback)]);

  const perf = perfRows.rows[0];
  const tradeCount = Number(perf.trade_count || 0);
  if (tradeCount < 6) {
    const desired = normaliseConfig(userCfg);
    await query(`
      insert into sf_app_config (key, value)
      values ('effective_settings', $1::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [JSON.stringify(desired)]);
    return desired;
  }

  const winRate = Number(perf.win_rate || 0) * 100;
  const totalPnl = Number(perf.total_pnl || 0);
  const totalNotional = Number(perf.total_notional || 0);
  const returnPct = totalNotional > 0 ? (totalPnl / totalNotional) * 100 : 0;

  let next = normaliseConfig(userCfg);
  let changed = false;
  const notes = [];

  if (userCfg.autoThresholdAdjust) {
    if (winRate < 45 || returnPct < -1) {
      const prev = next.minConfidencePct;
      next.minConfidencePct = clamp(prev + 2, 45, 90);
      if (next.minConfidencePct !== prev) {
        changed = true;
        notes.push(`minConfidence ${prev}→${next.minConfidencePct}`);
      }
    } else if (winRate > 60 && returnPct > 1) {
      const prev = next.minConfidencePct;
      next.minConfidencePct = clamp(prev - 1, 50, 90);
      if (next.minConfidencePct !== prev) {
        changed = true;
        notes.push(`minConfidence ${prev}→${next.minConfidencePct}`);
      }
    }
  }

  if (userCfg.autoRiskAdjust) {
    if (winRate < 45 || returnPct < -1) {
      const prev = next.riskPerTradePct;
      next.riskPerTradePct = clamp(Number((prev * 0.9).toFixed(2)), 2, 25);
      if (next.riskPerTradePct !== prev) {
        changed = true;
        notes.push(`risk ${prev}→${next.riskPerTradePct}`);
      }
    } else if (winRate > 60 && returnPct > 1) {
      const prev = next.riskPerTradePct;
      next.riskPerTradePct = clamp(Number((prev * 1.05).toFixed(2)), 2, 25);
      if (next.riskPerTradePct !== prev) {
        changed = true;
        notes.push(`risk ${prev}→${next.riskPerTradePct}`);
      }
    }
  }

  next = normaliseConfig(next);

  if (changed) {
    await saveEffectiveConfig(effectiveCfg, next, 'auto_optimise', `Lookback ${lookback}d, win ${winRate.toFixed(1)}%, return ${returnPct.toFixed(2)}%, ${notes.join(', ')}`);
  } else {
    await query(`
      insert into sf_app_config (key, value)
      values ('effective_settings', $1::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [JSON.stringify(next)]);
  }

  return next;
}

async function fetchJsonWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'set-and-forget/8.0' }
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
        openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: k[6]
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
    ) values ($1,$2,$2,$2,$3,$4,$5)
    on conflict (id) do update set
      risk_per_trade_pct = excluded.risk_per_trade_pct,
      base_confidence = excluded.base_confidence,
      test_window_days = excluded.test_window_days,
      updated_at = now()
  `, [PORTFOLIO_ID, cfg.startBalance, cfg.riskPerTradePct, cfg.minConfidencePct, cfg.testWindowDays]);
}

async function getPortfolio() {
  const rows = await query(`select * from sf_portfolio where id = $1`, [PORTFOLIO_ID]);
  return rows.rows[0];
}

async function getOpenPositions() {
  const rows = await query(`select * from sf_positions where portfolio_id = $1 and status = 'open' order by opened_at desc`, [PORTFOLIO_ID]);
  return rows.rows;
}

async function getRecentTradeMeta(pair, testWindowDays) {
  const rows = await query(`
    select count(*)::int as trade_count,
      coalesce(sum(pnl_gbp), 0)::numeric as total_pnl,
      coalesce(sum(notional_gbp), 0)::numeric as total_notional
    from sf_trades
    where portfolio_id = $1 and pair = $2 and type = 'CLOSE'
      and created_at >= now() - ($3 || ' days')::interval
  `, [PORTFOLIO_ID, pair, String(testWindowDays)]);
  const row = rows.rows[0];
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
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
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

async function closePosition(pos, exitPrice, portfolio, reason = 'signal_flip') {
  const pnl = pos.side === 'BUY'
    ? (exitPrice - Number(pos.entry_price)) * Number(pos.units)
    : (Number(pos.entry_price) - exitPrice) * Number(pos.units);
  const newCash = Number(portfolio.cash_gbp) + Number(pos.notional_gbp) + pnl;
  const newRealised = Number(portfolio.realised_pnl_gbp) + pnl;

  await query(`update sf_positions set status = 'closed', closed_at = now() where id = $1`, [pos.id]);

  await query(`
    insert into sf_trades (
      portfolio_id, pair, side, units, notional_gbp, entry_price, exit_price, pnl_gbp,
      type, source, reason, confidence_pct, quality_score, adaptive_threshold, opened_at, closed_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,'CLOSE',$9,$10,$11,$12,$13,$14, now())
  `, [
    PORTFOLIO_ID, pos.pair, pos.side, pos.units, pos.notional_gbp, pos.entry_price, exitPrice, pnl,
    pos.source, reason, pos.confidence_pct, pos.quality_score, pos.adaptive_threshold, pos.opened_at
  ]);

  await query(`update sf_portfolio set cash_gbp = $2, realised_pnl_gbp = $3, updated_at = now() where id = $1`, [PORTFOLIO_ID, newCash, newRealised]);
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

function classifyGroup(pair) {
  const majors = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  if (majors.includes(pair)) return 'majors';
  return 'alts';
}

function buildEntryReason(signal, cfg) {
  return `Quality ${signal.quality.toFixed(1)} ≥ threshold ${signal.adaptiveThreshold.toFixed(1)}, confidence ${signal.confidence.toFixed(1)}%, state ${signal.state}, sizing ${cfg.sizingMode}`;
}

function computeNotional(currentCash, cfg, signal) {
  const baseRisk = Number(cfg.riskPerTradePct) / 100;
  if (cfg.sizingMode !== 'confidence_weighted') {
    return +(currentCash * baseRisk).toFixed(2);
  }
  const confidenceFactor = clamp((Number(signal.confidence) - Number(cfg.minConfidencePct)) / Math.max(1, (95 - Number(cfg.minConfidencePct))), 0.15, 1);
  const qualityFactor = clamp(Number(signal.quality) / 100, 0.4, 1);
  const combined = clamp((confidenceFactor * 0.65) + (qualityFactor * 0.35), 0.2, 1);
  return +(currentCash * baseRisk * combined).toFixed(2);
}

async function openPosition(pair, side, price, portfolio, cfg, signal) {
  const currentCash = Number(portfolio.cash_gbp);
  const notional = computeNotional(currentCash, cfg, signal);
  if (notional <= 0 || currentCash < notional) return false;
  const units = +(notional / price).toFixed(8);
  const newCash = currentCash - notional;
  const { stopLossPrice, takeProfitPrice } = getRiskPrices(side, price, cfg.stopLossPct, cfg.takeProfitPct);
  const openedReason = buildEntryReason(signal, cfg);

  await query(`
    insert into sf_positions (
      portfolio_id, pair, side, entry_price, units, notional_gbp,
      stop_loss_price, take_profit_price, source, status,
      confidence_pct, quality_score, adaptive_threshold, opened_reason
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,'auto','open',$9,$10,$11,$12)
  `, [
    PORTFOLIO_ID, pair, side, price, units, notional,
    stopLossPrice, takeProfitPrice,
    signal.confidence, signal.quality, signal.adaptiveThreshold, openedReason
  ]);

  await query(`
    insert into sf_trades (
      portfolio_id, pair, side, units, notional_gbp, entry_price, type, source, reason,
      confidence_pct, quality_score, adaptive_threshold, opened_at
    ) values ($1,$2,$3,$4,$5,$6,'OPEN','auto','signal_entry',$7,$8,$9, now())
  `, [PORTFOLIO_ID, pair, side, units, notional, price, signal.confidence, signal.quality, signal.adaptiveThreshold]);

  await query(`update sf_portfolio set cash_gbp = $2, updated_at = now() where id = $1`, [PORTFOLIO_ID, newCash]);
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

  await query(`update sf_portfolio set peak_equity_gbp = $2, max_drawdown_pct = $3, updated_at = now() where id = $1`, [PORTFOLIO_ID, peak, maxDd]);

  await query(`
    insert into sf_snapshots (
      portfolio_id, snapshot_at, snapshot_day, equity_gbp, cash_gbp, exposure_gbp, open_pnl_gbp, realised_pnl_gbp
    ) values ($1, now(), current_date, $2, $3, $4, $5, $6)
  `, [PORTFOLIO_ID, equity, portfolio.cash_gbp, exposure, openPnl, portfolio.realised_pnl_gbp]);

  return { equity, openPnl, exposure };
}

async function main() {
  const cfgBundle = await getConfig();
  const effectiveCfg = await maybeOptimise(cfgBundle.user, cfgBundle.effective);
  await ensurePortfolio(effectiveCfg);

  const portfolioStart = await getPortfolio();
  const marketMap = {};
  const rankedSignals = [];
  let successCount = 0;

  for (const pair of effectiveCfg.symbols) {
    try {
      const candles = await fetchKlines(pair, effectiveCfg.interval, 250);
      const closed = candles.slice(0, -1);
      const baseSignal = runHmmRegime(closed, {
        length: effectiveCfg.lookbackPeriod,
        pStayBull: effectiveCfg.pBullBull,
        pStayBear: effectiveCfg.pBearBear,
        pStayChop: effectiveCfg.pChopChop
      });

      const meta = await getRecentTradeMeta(pair, effectiveCfg.testWindowDays);
      const signal = enrichSignal(baseSignal, {
        baseThreshold: effectiveCfg.minConfidencePct,
        recentReturnPct: meta.recentReturnPct,
        recentTradeCount: meta.recentTradeCount
      });

      const lastPrice = closed[closed.length - 1]?.close ?? null;
      marketMap[pair] = { signal, lastPrice };
      rankedSignals.push({ pair, signal, lastPrice, group: classifyGroup(pair) });
      await upsertMarket(pair, effectiveCfg.interval, signal, lastPrice);
      successCount += 1;
    } catch (err) {
      console.error(`Skipping ${pair}: ${err.message}`);
    }
  }

  if (successCount === 0) throw new Error('All market data providers failed for all configured pairs');

  let portfolio = await getPortfolio();
  let openPositions = await getOpenPositions();

  for (const pos of openPositions) {
    const market = marketMap[pos.pair];
    if (!market?.lastPrice) continue;
    const reason = shouldCloseForRisk(pos, market.lastPrice, effectiveCfg, market.signal);
    if (reason) {
      await closePosition(pos, market.lastPrice, portfolio, reason);
      portfolio = await getPortfolio();
    }
  }

  openPositions = await getOpenPositions();

  for (const pos of openPositions) {
    const market = marketMap[pos.pair];
    if (!market?.lastPrice || !market?.signal) continue;
    const desired = market.signal.decision === 'BUY' ? 'BUY' : market.signal.decision === 'SELL' ? 'SELL' : 'HOLD';
    if (desired !== 'HOLD' && desired !== pos.side) {
      await closePosition(pos, market.lastPrice, portfolio, 'signal_flip');
      portfolio = await getPortfolio();
    }
  }

  openPositions = await getOpenPositions();

  const sortedEntries = rankedSignals
    .filter(x => x.signal.decision === 'BUY' || x.signal.decision === 'SELL')
    .sort((a, b) => Number(b.signal.quality) - Number(a.signal.quality) || Number(b.signal.confidence) - Number(a.signal.confidence));

  let currentOpen = await getOpenPositions();
  let groupCounts = {};
  for (const pos of currentOpen) {
    const grp = classifyGroup(pos.pair);
    groupCounts[grp] = (groupCounts[grp] || 0) + 1;
  }

  for (const entry of sortedEntries) {
    currentOpen = await getOpenPositions();
    if (currentOpen.find(p => p.pair === entry.pair)) continue;
    if (currentOpen.length >= effectiveCfg.maxOpenPositions) continue;

    const grp = entry.group;
    if ((groupCounts[grp] || 0) >= effectiveCfg.maxCorrelatedPositions) continue;

    portfolio = await getPortfolio();
    const opened = await openPosition(entry.pair, entry.signal.decision, entry.lastPrice, portfolio, effectiveCfg, entry.signal);
    if (opened) {
      groupCounts[grp] = (groupCounts[grp] || 0) + 1;
    }
  }

  portfolio = await getPortfolio();
  const snapshot = await updateSnapshot(portfolio, marketMap);
  const finalOpen = await getOpenPositions();

  console.log(JSON.stringify({
    ok: true,
    processedPairs: successCount,
    symbols: effectiveCfg.symbols,
    interval: effectiveCfg.interval,
    openPositions: finalOpen.length,
    exposure: snapshot.exposure,
    equity: snapshot.equity,
    openPnl: snapshot.openPnl,
    effectiveConfig: effectiveCfg,
    timestamp: new Date().toISOString()
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
