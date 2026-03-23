const { getClientState, updateClientState } = require('./_lib/state');
const { allowMethods, readJson, send } = require('./_lib/http');
const { pairKey, clamp } = require('./_lib/hmm');
const { normalizeSymbol } = require('./_lib/market');

module.exports = async (req, res) => {
  allowMethods(res, ['GET', 'POST', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const clientId = req.query.clientId || (req.body && req.body.clientId);

  if (req.method === 'GET') {
    const client = await getClientState(clientId);
    return send(res, 200, {
      ok: true,
      clientId: client.clientId,
      selectedPairKey: client.selectedPairKey,
      tradeSize: client.tradeSize,
      settings: client.settings,
    });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const body = await readJson(req);
  const safeClientId = body.clientId || clientId;
  if (!safeClientId) return send(res, 400, { error: 'Missing clientId' });

  const updated = await updateClientState(safeClientId, client => {
    if (body.tradeSize !== undefined) {
      client.tradeSize = Math.max(Number(body.tradeSize || client.tradeSize), 1);
    }
    if (body.selectedPairKey) {
      client.selectedPairKey = body.selectedPairKey;
    }
    if (body.symbol && body.interval) {
      client.selectedPairKey = pairKey(normalizeSymbol(body.symbol), body.interval);
    }
    if (body.settings && typeof body.settings === 'object') {
      client.settings = {
        ...client.settings,
        ...body.settings,
      };
      client.settings.length = Math.max(5, Number(client.settings.length || 20));
      client.settings.minConfidence = clamp(Number(client.settings.minConfidence || 55), 1, 100);
      client.settings.pStayBull = clamp(Number(client.settings.pStayBull || 0.8), 0.05, 0.99);
      client.settings.pStayBear = clamp(Number(client.settings.pStayBear || 0.8), 0.05, 0.99);
      client.settings.pStayChop = clamp(Number(client.settings.pStayChop || 0.6), 0.05, 0.99);
    }
    return client;
  });

  return send(res, 200, {
    ok: true,
    tradeSize: updated.tradeSize,
    selectedPairKey: updated.selectedPairKey,
    settings: updated.settings,
  });
};
