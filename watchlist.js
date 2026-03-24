const { getClientState, updateClientState } = require('./_lib/state');
const { allowMethods, readJson, send } = require('./_lib/http');
const { pairKey } = require('./_lib/hmm');
const { normalizeSymbol } = require('./_lib/market');
const { makeId } = require('./_lib/trading');
const { publish } = require('./_lib/ably');

module.exports = async (req, res) => {
  allowMethods(res, ['GET', 'POST', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const clientId = req.query.clientId || (req.body && req.body.clientId);
  if (req.method === 'GET') {
    const client = await getClientState(clientId);
    return send(res, 200, { ok: true, clientId: client.clientId, watchlist: client.watchlist, selectedPairKey: client.selectedPairKey });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const body = await readJson(req);
  const safeClientId = body.clientId || clientId;
  if (!safeClientId) return send(res, 400, { error: 'Missing clientId' });

  const result = await updateClientState(safeClientId, client => {
    client.watchlist = Array.isArray(client.watchlist) ? client.watchlist : [];
    const action = body.action || 'add';

    if (action === 'add') {
      const symbol = normalizeSymbol(body.symbol || 'BTCUSDT');
      const interval = body.interval || '15m';
      const exists = client.watchlist.find(item => item.symbol === symbol && item.interval === interval);
      if (!exists) {
        client.watchlist.unshift({ id: makeId('watch'), symbol, interval, enabled: true });
      }
      client.selectedPairKey = pairKey(symbol, interval);
    } else if (action === 'remove') {
      client.watchlist = client.watchlist.filter(item => item.id !== body.id && pairKey(item.symbol, item.interval) !== body.pairKey);
      if (!client.watchlist.length) {
        client.watchlist = [{ id: makeId('watch'), symbol: 'BTCUSDT', interval: '15m', enabled: true }];
      }
      if (!client.watchlist.some(item => pairKey(item.symbol, item.interval) === client.selectedPairKey)) {
        client.selectedPairKey = pairKey(client.watchlist[0].symbol, client.watchlist[0].interval);
      }
    } else if (action === 'toggle') {
      client.watchlist = client.watchlist.map(item => item.id === body.id ? { ...item, enabled: !item.enabled } : item);
    } else if (action === 'select') {
      if (body.pairKey) client.selectedPairKey = body.pairKey;
    } else if (action === 'reorder' && Array.isArray(body.watchlist)) {
      client.watchlist = body.watchlist;
    }

    return client;
  });

  try {
    await publish(`client:${safeClientId}`, 'refresh', { reason: 'watchlist' });
  } catch (error) {
    console.error(error);
  }

  return send(res, 200, {
    ok: true,
    watchlist: result.watchlist,
    selectedPairKey: result.selectedPairKey,
  });
};