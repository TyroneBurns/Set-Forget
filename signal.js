const { allowMethods, send } = require('./_lib/http');
const { fetchCandles, normalizeSymbol } = require('./_lib/market');
const { analyseCandles, pairKey } = require('./_lib/hmm');
const { getClientState } = require('./_lib/state');

module.exports = async (req, res) => {
  allowMethods(res, ['GET', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  try {
    const client = await getClientState(req.query.clientId);
    const symbol = normalizeSymbol(req.query.symbol || (req.query.pairKey ? req.query.pairKey.split('|')[0] : client.selectedPairKey.split('|')[0]));
    const interval = req.query.interval || (req.query.pairKey ? req.query.pairKey.split('|')[1] : client.selectedPairKey.split('|')[1]) || '15m';
    const limit = client.settings.scanLimit || 180;
    const candles = await fetchCandles(symbol, interval, limit);
    const analysis = analyseCandles(candles, client.settings);
    const latest = analysis.latest;

    return send(res, 200, {
      ok: true,
      symbol,
      interval,
      pairKey: pairKey(symbol, interval),
      latest,
      results: analysis.results.slice(-90),
      candles: candles.slice(-90),
      settings: analysis.settings,
    });
  } catch (error) {
    return send(res, 500, { ok: false, error: error.message });
  }
};
