import { query } from '../lib/db.js';
import { runHmmRegime, enrichSignal } from '../lib/signal-engine.js';

const PORTFOLIO_ID = 'main';

const DEFAULT_CONFIG = {
  marketDataSource: 'Binance public candles',
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  interval: '15m',
  refreshSeconds: 300,
  lookbackPeriod: 20,
  minConfidencePct: 82,
  pBullBull: 0.84,
  pBearBear: 0.84,
  pChopChop: 0.72,
  startBalance: 1000,
  riskPerTradePct: 4,
  stopLossPct: 2,
  takeProfitPct: 4,
  exitOnChop: true,
  testWindowDays: 7,
  maxOpenPositions: 2,
  maxCorrelatedPositions: 1,
  sizingMode: 'confidence_weighted',
  autoOptimise: true,
  autoRiskAdjust: true,
  autoThresholdAdjust: true,
  optimiserLookbackDays: 7,
  statePersistenceBars: 2,
  flipCooldownBars: 2,
  minPosteriorGapPct: 12,
  useTrendFilter: true,
  useAtrFilter: true,
  useStructureFilter: true,
  secondaryCorrelationScalePct: 40,
  secondaryEntryMinQuality: 88
};

function toNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function intervalToMs(interval) {
  const map = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
  return map[interval] || 900_000;
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
  cfg.statePersistenceBars = clamp(Math.round(toNumber(cfg.statePersistenceBars, DEFAULT_CONFIG.statePersistenceBars)), 1, 5);
  cfg.flipCooldownBars = clamp(Math.round(toNumber(cfg.flipCooldownBars, DEFAULT_CONFIG.flipCooldownBars)), 0, 6);
  cfg.minPosteriorGapPct = clamp(toNumber(cfg.minPosteriorGapPct, DEFAULT_CONFIG.minPosteriorGapPct), 2, 40);
  cfg.useTrendFilter = Boolean(cfg.useTrendFilter);
  cfg.useAtrFilter = Boolean(cfg.useAtrFilter);
  cfg.useStructureFilter = Boolean(cfg.useStructureFilter);
  cfg.secondaryCorrelationScalePct = clamp(toNumber(cfg.secondaryCorrelationScalePct, DEFAULT_CONFIG.secondaryCorrelationScalePct), 10, 100);
  cfg.secondaryEntryMinQuality = clamp(toNumber(cfg.secondaryEntryMinQuality, DEFAULT_CONFIG.secondaryEntryMinQuality), 60, 99);
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
  let next = normaliseConfig(userCfg);
  if (!userCfg.autoOptimise || (!userCfg.autoRiskAdjust && !userCfg.autoThresholdAdjust)) {
    await query(`
      insert into sf_app_config (key, value)
      values ('effective_settings', $1::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [JSON.stringify(next)]);
    return next;
  }

  const lookback = userCfg.optimiserLookbackDays;
  const perfRows = await query(`
    select
      count(*)::int as trade_count,
      coalesce(avg(case when pnl_gbp > 0 then 1 else 0 end), 0)::numeric as win_rate,
      coalesce(sum(pnl_gbp), 0)::numeric as total_pnl,
      coalesce(sum(notional_gbp), 0)::numeric as total_notional,
      coalesce(sum(case when reason = 'chop_exit' then 1 else 0 end),0)::numeric as chop_exits,
      coalesce(sum(case when reason = 'signal_flip' then 1 else 0 end),0)::numeric as flip_exits
    from sf_trades
    where portfolio_id = $1 and type = 'CLOSE'
      and created_at >= now() - ($2 || ' days')::interval
  `, [PORTFOLIO_ID, String(lookback)]);

  const perf = perfRows.rows[0];
  const tradeCount = Number(perf.trade_count || 0);
  if (tradeCount < 6) {
    next.minConfidencePct = Math.max(next.minConfidencePct, 80);
    next.riskPerTradePct = Math.min(next.riskPerTradePct, 5);
    next.maxCorrelatedPositions = Math.min(next.maxCorrelatedPositions, 1);
    await query(`insert into sf_app_config (key, value) values ('effective_settings', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(next)]);
    return next;
  }

  const winRate = Number(perf.win_rate || 0) * 100;
  const totalPnl = Number(perf.total_pnl || 0);
  const totalNotional = Number(perf.total_notional || 0);
  const returnPct = totalNotional > 0 ? (totalPnl / totalNotional) * 100 : 0;
  const chopRate = tradeCount > 0 ? Number(perf.chop_exits || 0) / tradeCount : 0;
  const flipRate = tradeCount > 0 ? Number(perf.flip_exits || 0) / tradeCount : 0;

  let changed = false;
  const notes = [];

  next.minConfidencePct = Math.max(next.minConfidencePct, 78);
  next.minPosteriorGapPct = Math.max(next.minPosteriorGapPct, 10);
  next.statePersistenceBars = Math.max(next.statePersistenceBars, 2);

  if (userCfg.autoThresholdAdjust) {
    if (winRate < 42 || returnPct < -0.5 || chopRate > 0.35 || flipRate > 0.30) {
      const prev = next.minConfidencePct;
      next.minConfidencePct = clamp(prev + 2, 60, 90);
      next.minPosteriorGapPct = clamp(next.minPosteriorGapPct + 1, 6, 24);
      if (next.minConfidencePct !== prev) { changed = true; notes.push(`minConfidence ${prev}→${next.minConfidencePct}`); }
    } else if (winRate > 58 && returnPct > 0.8) {
      const prev = next.minConfidencePct;
      next.minConfidencePct = clamp(prev - 1, 70, 90);
      if (next.minConfidencePct !== prev) { changed = true; notes.push(`minConfidence ${prev}→${next.minConfidencePct}`); }
    }
  }

  if (userCfg.autoRiskAdjust) {
    if (winRate < 42 || returnPct < -0.5 || chopRate > 0.35 || flipRate > 0.30) {
      const prev = next.riskPerTradePct;
      next.riskPerTradePct = clamp(Number((prev * 0.85).toFixed(2)), 2, 10);
      if (next.riskPerTradePct !== prev) { changed = true; notes.push(`risk ${prev}→${next.riskPerTradePct}`); }
    } else if (winRate > 58 && returnPct > 0.8) {
      const prev = next.riskPerTradePct;
      next.riskPerTradePct = clamp(Number((prev * 1.05).toFixed(2)), 2, 10);
      if (next.riskPerTradePct !== prev) { changed = true; notes.push(`risk ${prev}→${next.riskPerTradePct}`); }
    }
  }

  next.riskPerTradePct = Math.min(next.riskPerTradePct, 6);
  next.maxCorrelatedPositions = Math.min(next.maxCorrelatedPositions, 1);
  next.secondaryCorrelationScalePct = Math.min(next.secondaryCorrelationScalePct, 50);
  next = normaliseConfig(next);

  if (changed) {
    await saveEffectiveConfig(effectiveCfg, next, 'auto_optimise', `Lookback ${lookback}d, win ${winRate.toFixed(1)}%, return ${returnPct.toFixed(2)}%, chop ${(chopRate*100).toFixed(1)}%, flip ${(flipRate*100).toFixed(1)}%, ${notes.join(', ')}`);
  } else {
    await query(`insert into sf_app_config (key, value) values ('effective_settings', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(next)]);
  }
  return next;
}

async function fetchJsonWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'set-and-forget/9.0' } });
  } finally { clearTimeout(timer); }
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
      if (!res.ok) { lastError = `HTTP ${res.status} from ${new URL(url).host}`; continue; }
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) { lastError = `Empty data from ${new URL(url).host}`; continue; }
      return rows.map((k) => ({ openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: k[6] }));
    } catch (err) { lastError = `${new URL(url).host}: ${err.message}`; }
  }
  throw new Error(`Klines failed for ${symbol}: ${lastError}`);
}

async function ensurePortfolio(cfg) {
  await query(`
    insert into sf_portfolio (id, starting_balance_gbp, cash_gbp, peak_equity_gbp, risk_per_trade_pct, base_confidence, test_window_days)
    values ($1,$2,$2,$2,$3,$4,$5)
    on conflict (id) do update set risk_per_trade_pct = excluded.risk_per_trade_pct, base_confidence = excluded.base_confidence, test_window_days = excluded.test_window_days, updated_at = now()
  `, [PORTFOLIO_ID, cfg.startBalance, cfg.riskPerTradePct, cfg.minConfidencePct, cfg.testWindowDays]);
}
async function getPortfolio() { const rows = await query(`select * from sf_portfolio where id = $1`, [PORTFOLIO_ID]); return rows.rows[0]; }
async function getOpenPositions() { const rows = await query(`select * from sf_positions where portfolio_id = $1 and status = 'open' order by opened_at desc`, [PORTFOLIO_ID]); return rows.rows; }
async function getRecentTradeMeta(pair, testWindowDays) {
  const rows = await query(`
    select count(*)::int as trade_count, coalesce(sum(pnl_gbp), 0)::numeric as total_pnl, coalesce(sum(notional_gbp), 0)::numeric as total_notional
    from sf_trades where portfolio_id = $1 and pair = $2 and type = 'CLOSE' and created_at >= now() - ($3 || ' days')::interval
  `, [PORTFOLIO_ID, pair, String(testWindowDays)]);
  const row = rows.rows[0];
  const notional = Number(row.total_notional || 0);
  const pct = notional > 0 ? (Number(row.total_pnl || 0) / notional) * 100 : 0;
  return { recentReturnPct: pct, recentTradeCount: Number(row.trade_count || 0) };
}
function computeOpenPnl(pos, lastPrice) {
  if (!pos || !lastPrice) return 0;
  return pos.side === 'BUY' ? (lastPrice - Number(pos.entry_price)) * Number(pos.units) : (Number(pos.entry_price) - lastPrice) * Number(pos.units);
}
async function upsertMarket(pair, timeframe, signal, lastPrice) {
  await query(`
    insert into sf_markets (pair, timeframe, state, bull_pct, bear_pct, chop_pct, confidence_pct, spread_pct, quality_score, adaptive_threshold, decision, last_price, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
    on conflict (pair) do update set timeframe = excluded.timeframe, state = excluded.state, bull_pct = excluded.bull_pct, bear_pct = excluded.bear_pct, chop_pct = excluded.chop_pct, confidence_pct = excluded.confidence_pct, spread_pct = excluded.spread_pct, quality_score = excluded.quality_score, adaptive_threshold = excluded.adaptive_threshold, decision = excluded.decision, last_price = excluded.last_price, updated_at = now()
  `, [pair, timeframe, signal.state, signal.bull, signal.bear, signal.chop, signal.confidence, signal.spread, signal.quality, signal.adaptiveThreshold, signal.decision, lastPrice]);

  await query(`
    insert into sf_signals (pair, timeframe, state, bull_pct, bear_pct, chop_pct, confidence_pct, spread_pct, quality_score, adaptive_threshold, decision, last_price)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [pair, timeframe, signal.state, signal.bull, signal.bear, signal.chop, signal.confidence, signal.spread, signal.quality, signal.adaptiveThreshold, signal.decision, lastPrice]);
}
async function closePosition(pos, exitPrice, portfolio, reason = 'signal_flip') {
  const pnl = pos.side === 'BUY' ? (exitPrice - Number(pos.entry_price)) * Number(pos.units) : (Number(pos.entry_price) - exitPrice) * Number(pos.units);
  const newCash = Number(portfolio.cash_gbp) + Number(pos.notional_gbp) + pnl;
  const newRealised = Number(portfolio.realised_pnl_gbp) + pnl;
  await query(`update sf_positions set status = 'closed', closed_at = now() where id = $1`, [pos.id]);
  await query(`
    insert into sf_trades (portfolio_id, pair, side, units, notional_gbp, entry_price, exit_price, pnl_gbp, type, source, reason, confidence_pct, quality_score, adaptive_threshold, opened_at, closed_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'CLOSE',$9,$10,$11,$12,$13,$14, now())
  `, [PORTFOLIO_ID, pos.pair, pos.side, pos.units, pos.notional_gbp, pos.entry_price, exitPrice, pnl, pos.source, reason, pos.confidence_pct, pos.quality_score, pos.adaptive_threshold, pos.opened_at]);
  await query(`update sf_portfolio set cash_gbp = $2, realised_pnl_gbp = $3, updated_at = now() where id = $1`, [PORTFOLIO_ID, newCash, newRealised]);
}
function getRiskPrices(side, entryPrice, stopLossPct, takeProfitPct) {
  if (side === 'BUY') return { stopLossPrice: entryPrice * (1 - stopLossPct / 100), takeProfitPrice: entryPrice * (1 + takeProfitPct / 100) };
  return { stopLossPrice: entryPrice * (1 + stopLossPct / 100), takeProfitPrice: entryPrice * (1 - takeProfitPct / 100) };
}
function classifyGroup(pair) { return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(pair) ? 'majors' : 'alts'; }
function buildEntryReason(signal, cfg, extra = '') {
  const filters = [];
  if (signal.trendPass) filters.push('trend ok');
  if (signal.atrPass) filters.push('atr ok');
  if (signal.structurePass) filters.push('structure ok');
  const base = `Quality ${signal.quality.toFixed(1)} ≥ threshold ${signal.adaptiveThreshold.toFixed(1)}, confidence ${signal.confidence.toFixed(1)}%, gap ${signal.posteriorGap.toFixed(1)}%, state ${signal.state}`;
  return [base, filters.join(', '), extra].filter(Boolean).join(' • ');
}
function computeNotional(currentCash, cfg, signal, sizeMultiplier = 1) {
  const baseRisk = Number(cfg.riskPerTradePct) / 100;
  let notional;
  if (cfg.sizingMode !== 'confidence_weighted') {
    notional = currentCash * baseRisk;
  } else {
    const confidenceFactor = clamp((Number(signal.confidence) - Number(cfg.minConfidencePct)) / Math.max(1, (95 - Number(cfg.minConfidencePct))), 0.15, 1);
    const qualityFactor = clamp(Number(signal.quality) / 100, 0.4, 1);
    const combined = clamp((confidenceFactor * 0.65) + (qualityFactor * 0.35), 0.2, 1);
    notional = currentCash * baseRisk * combined;
  }
  return +(notional * sizeMultiplier).toFixed(2);
}
async function getRecentStates(pair, count) {
  const rows = await query(`select state from sf_signals where pair = $1 order by created_at desc limit $2`, [pair, count]);
  return rows.rows.map(r => r.state);
}
async function passesPersistence(pair, state, bars) {
  if (bars <= 1) return true;
  const recent = await getRecentStates(pair, bars);
  if (recent.length < bars) return false;
  return recent.every(s => s === state);
}
async function getLastClose(pair) {
  const rows = await query(`select side, reason, created_at from sf_trades where portfolio_id = $1 and pair = $2 and type = 'CLOSE' order by created_at desc limit 1`, [PORTFOLIO_ID, pair]);
  return rows.rows[0] || null;
}
async function passesFlipCooldown(pair, desiredSide, cfg) {
  if (!cfg.flipCooldownBars) return true;
  const lastClose = await getLastClose(pair);
  if (!lastClose) return true;
  const cooldownMs = cfg.flipCooldownBars * intervalToMs(cfg.interval);
  const ageMs = Date.now() - new Date(lastClose.created_at).getTime();
  if (ageMs > cooldownMs) return true;
  return lastClose.side === desiredSide;
}
async function openPosition(pair, side, price, portfolio, cfg, signal, sizeMultiplier = 1, reasonExtra = '') {
  const currentCash = Number(portfolio.cash_gbp);
  const notional = computeNotional(currentCash, cfg, signal, sizeMultiplier);
  if (notional <= 0 || currentCash < notional) return false;
  const units = +(notional / price).toFixed(8);
  const newCash = currentCash - notional;
  const { stopLossPrice, takeProfitPrice } = getRiskPrices(side, price, cfg.stopLossPct, cfg.takeProfitPct);
  const openedReason = buildEntryReason(signal, cfg, reasonExtra);

  await query(`
    insert into sf_positions (portfolio_id, pair, side, entry_price, units, notional_gbp, stop_loss_price, take_profit_price, source, status, confidence_pct, quality_score, adaptive_threshold, opened_reason)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'auto','open',$9,$10,$11,$12)
  `, [PORTFOLIO_ID, pair, side, price, units, notional, stopLossPrice, takeProfitPrice, signal.confidence, signal.quality, signal.adaptiveThreshold, openedReason]);

  await query(`
    insert into sf_trades (portfolio_id, pair, side, units, notional_gbp, entry_price, type, source, reason, confidence_pct, quality_score, adaptive_threshold, opened_at)
    values ($1,$2,$3,$4,$5,$6,'OPEN','auto','signal_entry',$7,$8,$9, now())
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
  await query(`insert into sf_snapshots (portfolio_id, snapshot_at, snapshot_day, equity_gbp, cash_gbp, exposure_gbp, open_pnl_gbp, realised_pnl_gbp) values ($1, now(), current_date, $2, $3, $4, $5, $6)`, [PORTFOLIO_ID, equity, portfolio.cash_gbp, exposure, openPnl, portfolio.realised_pnl_gbp]);
  return { equity, openPnl, exposure };
}

async function main() {
  const cfgBundle = await getConfig();
  const effectiveCfg = await maybeOptimise(cfgBundle.user, cfgBundle.effective);
  await ensurePortfolio(effectiveCfg);

  let portfolio = await getPortfolio();
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
        recentTradeCount: meta.recentTradeCount,
        minPosteriorGapPct: effectiveCfg.minPosteriorGapPct,
        useTrendFilter: effectiveCfg.useTrendFilter,
        useAtrFilter: effectiveCfg.useAtrFilter,
        useStructureFilter: effectiveCfg.useStructureFilter
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

  const sortedEntries = rankedSignals
    .filter(x => x.signal.decision === 'BUY' || x.signal.decision === 'SELL')
    .sort((a, b) => Number(b.signal.quality) - Number(a.signal.quality) || Number(b.signal.confidence) - Number(a.signal.confidence));

  let currentOpen = await getOpenPositions();
  const groupCounts = {};
  for (const pos of currentOpen) {
    const grp = classifyGroup(pos.pair);
    groupCounts[grp] = (groupCounts[grp] || 0) + 1;
  }

  for (const entry of sortedEntries) {
    currentOpen = await getOpenPositions();
    if (currentOpen.find(p => p.pair === entry.pair)) continue;
    if (currentOpen.length >= effectiveCfg.maxOpenPositions) continue;

    const desiredSide = entry.signal.decision;
    const persistent = await passesPersistence(entry.pair, entry.signal.state, effectiveCfg.statePersistenceBars);
    if (!persistent) continue;
    const cooldownPass = await passesFlipCooldown(entry.pair, desiredSide, effectiveCfg);
    if (!cooldownPass) continue;

    const grp = entry.group;
    const grpCount = groupCounts[grp] || 0;
    if (grpCount >= effectiveCfg.maxCorrelatedPositions) continue;
    if (grpCount >= 1 && entry.signal.quality < effectiveCfg.secondaryEntryMinQuality) continue;

    portfolio = await getPortfolio();
    const sizeMultiplier = grpCount >= 1 ? effectiveCfg.secondaryCorrelationScalePct / 100 : 1;
    const opened = await openPosition(entry.pair, desiredSide, entry.lastPrice, portfolio, effectiveCfg, entry.signal, sizeMultiplier, grpCount >= 1 ? `secondary correlated entry at ${Math.round(sizeMultiplier*100)}% size` : `persistence ${effectiveCfg.statePersistenceBars} bars`);
    if (opened) {
      groupCounts[grp] = grpCount + 1;
      portfolio = await getPortfolio();
    }
  }

  const latestPortfolio = await getPortfolio();
  const snapshot = await updateSnapshot(latestPortfolio, marketMap);
  const active = rankedSignals.sort((a, b) => Number(b.signal.quality) - Number(a.signal.quality))[0];
  console.log(JSON.stringify({ ok: true, processedPairs: successCount, pair: active?.pair || null, decision: active?.signal?.decision || 'HOLD', lastPrice: active?.lastPrice || null, openPnl: snapshot.openPnl, timestamp: new Date().toISOString() }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
