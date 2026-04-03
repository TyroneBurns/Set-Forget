export function sma(values, length) {
  return values.map((_, i) => {
    if (i < length - 1) return null;
    const slice = values.slice(i - length + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / length;
  });
}

export function ema(values, length) {
  const k = 2 / (length + 1);
  const out = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function stdev(values, length) {
  return values.map((_, i) => {
    if (i < length - 1) return null;
    const slice = values.slice(i - length + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / length;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / length;
    return Math.sqrt(variance);
  });
}

export function roc(values, period = 1) {
  return values.map((v, i) => {
    if (i < period) return 0;
    const prev = values[i - period];
    return prev === 0 ? 0 : ((v - prev) / prev) * 100;
  });
}

export function atr(candles, length) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  const out = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < length - 1) { out.push(null); continue; }
    const slice = trs.slice(i - length + 1, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / length);
  }
  return out;
}

function pdf(x, mu, sigma) {
  const s = sigma <= 0 ? 1e-6 : sigma;
  const variance = s * s;
  return (1 / Math.sqrt(2 * Math.PI * variance)) * Math.exp(-((x - mu) ** 2) / (2 * variance));
}

function topTwo(values) {
  const sorted = [...values].sort((a, b) => b - a);
  return [sorted[0] || 0, sorted[1] || 0];
}

export function runHmmRegime(candles, opts = {}) {
  const length = opts.length ?? 20;
  const pStayBull = opts.pStayBull ?? 0.8;
  const pStayBear = opts.pStayBear ?? 0.8;
  const pStayChop = opts.pStayChop ?? 0.6;

  if (!candles || candles.length < length * 3) {
    return { state:'NO TRADE', bull:0, bear:0, chop:0, confidence:0, spread:0, posteriorGap:0, reason:'Not enough data' };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const momRaw = roc(closes, 1);
  const momSmooth = ema(momRaw, length);
  const momMean = sma(momSmooth, length);
  const momStd = stdev(momSmooth, length);
  const volRaw = atr(candles, length);
  const volSeries = volRaw.map((v) => v ?? 0);
  const volMean = sma(volSeries, length);
  const volStd = stdev(volSeries, length);

  let probBull = 1/3, probBear = 1/3, probChop = 1/3;
  const transBullBear = (1 - pStayBull) * 0.2;
  const transBullChop = (1 - pStayBull) * 0.8;
  const transBearBull = (1 - pStayBear) * 0.2;
  const transBearChop = (1 - pStayBear) * 0.8;
  const transChopBull = (1 - pStayChop) * 0.5;
  const transChopBear = (1 - pStayChop) * 0.5;

  for (let i = 0; i < candles.length; i++) {
    if (momMean[i] == null || momStd[i] == null || volRaw[i] == null || volMean[i] == null || volStd[i] == null) continue;
    const obsMom = momStd[i] !== 0 ? (momSmooth[i] - momMean[i]) / momStd[i] : 0;
    const obsVol = volStd[i] !== 0 ? ((volRaw[i] ?? 0) - volMean[i]) / volStd[i] : 0;

    const likeBull = pdf(obsMom, 1.0, 1.0) * pdf(obsVol, -0.5, 1.0);
    const likeBear = pdf(obsMom, -1.0, 1.0) * pdf(obsVol, 1.0, 1.0);
    const likeChop = pdf(obsMom, 0.0, 0.5) * pdf(obsVol, 1.5, 1.0);

    const priorBull = probBull * pStayBull + probBear * transBearBull + probChop * transChopBull;
    const priorBear = probBull * transBullBear + probBear * pStayBear + probChop * transChopBear;
    const priorChop = probBull * transBullChop + probBear * transBearChop + probChop * pStayChop;

    const postBull = priorBull * likeBull;
    const postBear = priorBear * likeBear;
    const postChop = priorChop * likeChop;
    const total = postBull + postBear + postChop;

    if (total > 0) {
      probBull = postBull / total;
      probBear = postBear / total;
      probChop = postChop / total;
    }
  }

  const bull = +(probBull * 100).toFixed(1);
  const bear = +(probBear * 100).toFixed(1);
  const chop = +(probChop * 100).toFixed(1);
  let state = 'NO TRADE';
  if (bull > bear && bull > chop) state = 'LONG';
  else if (bear > bull && bear > chop) state = 'SHORT';
  const [topProb, secondProb] = topTwo([bull, bear, chop]);
  const confidence = topProb;
  const spread = +(Math.abs(bull - bear)).toFixed(1);
  const posteriorGap = +(topProb - secondProb).toFixed(1);

  const emaFast = ema(closes, 9);
  const emaSlow = ema(closes, 21);
  const atrSeries = atr(candles, 14);
  const atrMeanSeries = sma(atrSeries.map(v => v ?? 0), 10);
  const last = closes.length - 1;
  const lastClose = closes[last];
  const lastEmaFast = emaFast[last] ?? lastClose;
  const lastEmaSlow = emaSlow[last] ?? lastClose;
  const prevEmaSlow = emaSlow[Math.max(0, last - 1)] ?? lastEmaSlow;
  const lastAtr = atrSeries[last] ?? 0;
  const atrMean = atrMeanSeries[last] ?? lastAtr;
  const recentHigh = Math.max(...highs.slice(-8));
  const recentLow = Math.min(...lows.slice(-8));
  const trendLong = lastClose > lastEmaSlow && lastEmaFast > lastEmaSlow && lastEmaSlow >= prevEmaSlow;
  const trendShort = lastClose < lastEmaSlow && lastEmaFast < lastEmaSlow && lastEmaSlow <= prevEmaSlow;
  const atrExpanded = lastAtr >= atrMean * 1.03;
  const structureLong = lastClose >= recentHigh * 0.997;
  const structureShort = lastClose <= recentLow * 1.003;

  return {
    state, bull, bear, chop, confidence, spread, posteriorGap,
    trendLong, trendShort, atrExpanded, structureLong, structureShort,
    reason:'OK'
  };
}

export function computeSignalQuality(signal, meta = {}) {
  const confidenceComponent = Math.min(100, signal.confidence || 0);
  const spreadComponent = Math.min(100, (signal.spread || 0) * 3);
  const recentEdgeComponent = Math.max(0, Math.min(100, 50 + (meta.recentReturnPct || 0) * 8));
  const gapComponent = Math.max(0, Math.min(100, (signal.posteriorGap || 0) * 4));
  const filterBonus = (meta.trendPass ? 6 : 0) + (meta.atrPass ? 4 : 0) + (meta.structurePass ? 4 : 0);
  const noisePenalty = Math.max(0, (signal.chop || 0) - 30);
  const raw = confidenceComponent * 0.35 + spreadComponent * 0.18 + recentEdgeComponent * 0.17 + gapComponent * 0.22 + filterBonus - noisePenalty * 0.22;
  return Math.max(0, Math.min(100, +raw.toFixed(1)));
}

export function getAdaptiveThreshold(meta = {}) {
  const base = meta.baseThreshold ?? 65;
  const recent = meta.recentReturnPct ?? 0;
  const tradeCount = meta.recentTradeCount ?? 0;
  let threshold = base;
  if (tradeCount >= 3 && recent > 1.5) threshold -= 3;
  if (tradeCount >= 3 && recent < -1.0) threshold += 4;
  if (tradeCount < 3) threshold += 2;
  return Math.max(60, Math.min(90, threshold));
}

export function enrichSignal(signal, meta = {}) {
  const adaptiveThreshold = getAdaptiveThreshold(meta);
  const trendPass = signal.state === 'LONG' ? signal.trendLong : signal.state === 'SHORT' ? signal.trendShort : false;
  const atrPass = signal.atrExpanded;
  const structurePass = signal.state === 'LONG' ? signal.structureLong : signal.state === 'SHORT' ? signal.structureShort : false;
  const quality = computeSignalQuality(signal, { ...meta, trendPass, atrPass, structurePass });
  const requiredGap = meta.minPosteriorGapPct ?? 10;
  let decision = 'HOLD';

  const passFilters = (!meta.useTrendFilter || trendPass) && (!meta.useAtrFilter || atrPass) && (!meta.useStructureFilter || structurePass);
  if (signal.state === 'LONG' && signal.confidence >= adaptiveThreshold && signal.posteriorGap >= requiredGap && quality >= 70 && passFilters) decision = 'BUY';
  if (signal.state === 'SHORT' && signal.confidence >= adaptiveThreshold && signal.posteriorGap >= requiredGap && quality >= 70 && passFilters) decision = 'SELL';

  return { ...signal, quality, adaptiveThreshold, decision, trendPass, atrPass, structurePass };
}
