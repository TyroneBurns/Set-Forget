function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function gaussPdf(x, mu, sigma) {
  const safeSigma = sigma === 0 ? 1e-9 : sigma;
  const variance = safeSigma * safeSigma;
  return (1 / Math.sqrt(2 * Math.PI * variance)) * Math.exp(-Math.pow(x - mu, 2) / (2 * variance));
}

function sma(values, length) {
  const output = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value !== null && value !== undefined) {
      sum += value;
      count += 1;
    }
    if (i >= length) {
      const oldValue = values[i - length];
      if (oldValue !== null && oldValue !== undefined) {
        sum -= oldValue;
        count -= 1;
      }
    }
    if (i >= length - 1 && count === length) {
      output[i] = sum / length;
    }
  }
  return output;
}

function ema(values, length) {
  const output = new Array(values.length).fill(null);
  const alpha = 2 / (length + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || value === undefined) {
      output[i] = prev;
      continue;
    }
    prev = prev === null ? value : (value * alpha) + (prev * (1 - alpha));
    output[i] = prev;
  }
  return output;
}

function stdev(values, length) {
  const output = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i += 1) {
    const slice = values.slice(i - length + 1, i + 1);
    if (slice.some(v => v === null || v === undefined)) continue;
    const mean = slice.reduce((sum, value) => sum + value, 0) / length;
    const variance = slice.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / length;
    output[i] = Math.sqrt(variance);
  }
  return output;
}

function roc(values, period = 1) {
  return values.map((value, idx) => {
    if (idx < period || values[idx - period] === 0 || values[idx - period] === null || values[idx - period] === undefined) {
      return null;
    }
    return ((value - values[idx - period]) / values[idx - period]) * 100;
  });
}

function trueRange(candles) {
  const output = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    if (i === 0) {
      output[i] = candle.high - candle.low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    output[i] = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose)
    );
  }
  return output;
}

function atr(candles, length) {
  const tr = trueRange(candles);
  return sma(tr, length);
}

function pairKey(symbol, interval) {
  return `${String(symbol || '').toUpperCase()}|${interval || '15m'}`;
}

function splitPairKey(value) {
  const [symbol, interval] = String(value || '').split('|');
  return { symbol, interval: interval || '15m' };
}

function normalizeSignal(signal) {
  if (signal === 'LONG' || signal === 'SHORT' || signal === 'FLAT') return signal;
  return 'FLAT';
}

function analyseCandles(candles, rawSettings = {}) {
  const settings = {
    length: Math.max(5, Number(rawSettings.length || 20)),
    minConfidence: clamp(Number(rawSettings.minConfidence || 55), 1, 100),
    pStayBull: clamp(Number(rawSettings.pStayBull || 0.8), 0.05, 0.99),
    pStayBear: clamp(Number(rawSettings.pStayBear || 0.8), 0.05, 0.99),
    pStayChop: clamp(Number(rawSettings.pStayChop || 0.6), 0.05, 0.99),
  };

  if (!Array.isArray(candles) || candles.length < settings.length + 5) {
    return { settings, results: [], latest: null };
  }

  const closes = candles.map(c => Number(c.close));
  const momRaw = roc(closes, 1);
  const momSmooth = ema(momRaw, settings.length);
  const momStd = stdev(momSmooth, settings.length);
  const momSma = sma(momSmooth, settings.length);

  const volRaw = atr(candles, settings.length);
  const volStd = stdev(volRaw, settings.length);
  const volSma = sma(volRaw, settings.length);

  let probBull = 1 / 3;
  let probBear = 1 / 3;
  let probChop = 1 / 3;

  const results = [];

  for (let i = 0; i < candles.length; i += 1) {
    const obsMom = momStd[i] ? ((momSmooth[i] - momSma[i]) / momStd[i]) : 0;
    const obsVol = volStd[i] ? ((volRaw[i] - volSma[i]) / volStd[i]) : 0;

    const likeBull = gaussPdf(obsMom || 0, 1.0, 1.0) * gaussPdf(obsVol || 0, -0.5, 1.0);
    const likeBear = gaussPdf(obsMom || 0, -1.0, 1.0) * gaussPdf(obsVol || 0, 1.0, 1.0);
    const likeChop = gaussPdf(obsMom || 0, 0.0, 0.5) * gaussPdf(obsVol || 0, 1.5, 1.0);

    const transBullBear = (1 - settings.pStayBull) * 0.2;
    const transBullChop = (1 - settings.pStayBull) * 0.8;
    const transBearBull = (1 - settings.pStayBear) * 0.2;
    const transBearChop = (1 - settings.pStayBear) * 0.8;
    const transChopBull = (1 - settings.pStayChop) * 0.5;
    const transChopBear = (1 - settings.pStayChop) * 0.5;

    const priorBull = (probBull * settings.pStayBull) + (probBear * transBearBull) + (probChop * transChopBull);
    const priorBear = (probBull * transBullBear) + (probBear * settings.pStayBear) + (probChop * transChopBear);
    const priorChop = (probBull * transBullChop) + (probBear * transBearChop) + (probChop * settings.pStayChop);

    const postBull = priorBull * likeBull;
    const postBear = priorBear * likeBear;
    const postChop = priorChop * likeChop;
    const total = postBull + postBear + postChop;

    if (total > 0) {
      probBull = postBull / total;
      probBear = postBear / total;
      probChop = postChop / total;
    }

    const pctBull = probBull * 100;
    const pctBear = probBear * 100;
    const pctChop = probChop * 100;

    let regime = 'CHOP';
    let domState = 0;
    if (pctBull > pctBear && pctBull > pctChop) {
      regime = 'BULLISH';
      domState = 1;
    } else if (pctBear > pctBull && pctBear > pctChop) {
      regime = 'BEARISH';
      domState = -1;
    }

    const confidence = Math.max(pctBull, pctBear, pctChop);
    let signal = 'FLAT';
    if (domState === 1 && pctBull >= settings.minConfidence) {
      signal = 'LONG';
    } else if (domState === -1 && pctBear >= settings.minConfidence) {
      signal = 'SHORT';
    }

    results.push({
      time: candles[i].time,
      price: Number(candles[i].close),
      bull: Number(pctBull.toFixed(2)),
      bear: Number(pctBear.toFixed(2)),
      chop: Number(pctChop.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      regime,
      signal,
    });
  }

  return {
    settings,
    results,
    latest: results[results.length - 1] || null,
  };
}

module.exports = {
  analyseCandles,
  pairKey,
  splitPairKey,
  normalizeSignal,
  clamp,
};
