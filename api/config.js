import { query } from '../lib/db.js';

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
  cfg.maxOpenPositions = Math.max(1, Math.min(20, Math.round(toNumber(cfg.maxOpenPositions, DEFAULT_CONFIG.maxOpenPositions))));
  cfg.maxCorrelatedPositions = Math.max(1, Math.min(20, Math.round(toNumber(cfg.maxCorrelatedPositions, DEFAULT_CONFIG.maxCorrelatedPositions))));
  cfg.sizingMode = ['fixed', 'confidence_weighted'].includes(String(cfg.sizingMode)) ? String(cfg.sizingMode) : DEFAULT_CONFIG.sizingMode;
  cfg.autoOptimise = Boolean(cfg.autoOptimise);
  cfg.autoRiskAdjust = Boolean(cfg.autoRiskAdjust);
  cfg.autoThresholdAdjust = Boolean(cfg.autoThresholdAdjust);
  cfg.optimiserLookbackDays = Math.max(3, Math.min(60, Math.round(toNumber(cfg.optimiserLookbackDays, DEFAULT_CONFIG.optimiserLookbackDays))));
  cfg.statePersistenceBars = Math.max(1, Math.min(5, Math.round(toNumber(cfg.statePersistenceBars, DEFAULT_CONFIG.statePersistenceBars))));
  cfg.flipCooldownBars = Math.max(0, Math.min(6, Math.round(toNumber(cfg.flipCooldownBars, DEFAULT_CONFIG.flipCooldownBars))));
  cfg.minPosteriorGapPct = Math.max(2, Math.min(40, toNumber(cfg.minPosteriorGapPct, DEFAULT_CONFIG.minPosteriorGapPct)));
  cfg.useTrendFilter = Boolean(cfg.useTrendFilter);
  cfg.useAtrFilter = Boolean(cfg.useAtrFilter);
  cfg.useStructureFilter = Boolean(cfg.useStructureFilter);
  cfg.secondaryCorrelationScalePct = Math.max(10, Math.min(100, toNumber(cfg.secondaryCorrelationScalePct, DEFAULT_CONFIG.secondaryCorrelationScalePct)));
  cfg.secondaryEntryMinQuality = Math.max(60, Math.min(99, toNumber(cfg.secondaryEntryMinQuality, DEFAULT_CONFIG.secondaryEntryMinQuality)));
  return cfg;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const cfg = normaliseConfig(body);
      await query(`
        insert into sf_app_config (key, value)
        values ('settings', $1::jsonb)
        on conflict (key) do update set
          value = excluded.value,
          updated_at = now()
      `, [JSON.stringify(cfg)]);

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true, config: cfg }));
    }

    const rows = await query(`select value from sf_app_config where key = 'settings' limit 1`);
    const effectiveRows = await query(`select value from sf_app_config where key = 'effective_settings' limit 1`);
    const cfg = rows.rows.length ? normaliseConfig(rows.rows[0].value) : DEFAULT_CONFIG;
    const effective = effectiveRows.rows.length ? normaliseConfig(effectiveRows.rows[0].value) : cfg;

    if (!rows.rows.length) {
      await query(`
        insert into sf_app_config (key, value)
        values ('settings', $1::jsonb)
        on conflict (key) do nothing
      `, [JSON.stringify(cfg)]);
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      appName: process.env.APP_NAME || 'Set & Forget',
      config: cfg,
      effectiveConfig: effective
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
  }
}
