const { allowMethods, readJson, send } = require('./_lib/http');
const { getClientState, updateClientState } = require('./_lib/state');
const { normalizeSymbol } = require('./_lib/market');
const { openOrFlipPosition, closePosition, snapshotPosition } = require('./_lib/trading');
const { pairKey } = require('./_lib/hmm');

module.exports = async (req, res) => {
  allowMethods(res, ['GET', 'POST', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const clientId = req.query.clientId || (req.body && req.body.clientId);
  if (req.method === 'GET') {
    const client = await getClientState(clientId);
    const positions = Object.fromEntries(Object.entries(client.positions || {}).map(([key, value]) => [key, snapshotPosition(value)]));
    return send(res, 200, { ok: true, trades: client.trades || [], positions, account: client.account });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const body = await readJson(req);
  const safeClientId = body.clientId || clientId;
  if (!safeClientId) return send(res, 400, { error: 'Missing clientId' });

  const symbol = normalizeSymbol(body.symbol || 'BTCUSDT');
  const interval = body.interval || '15m';
  const key = pairKey(symbol, interval);
  const price = Number(body.price || 0);
  const sizeQuote = Math.max(Number(body.sizeQuote || 0), 1);
  const action = String(body.action || '').toUpperCase();

  const updated = await updateClientState(safeClientId, client => {
    let events = [];
    if (action === 'BUY') {
      events = openOrFlipPosition(client, {
        symbol,
        interval,
        side: 'LONG',
        sizeQuote,
        price,
        mode: 'manual',
        note: body.note || '',
        reason: 'Manual BUY',
      });
    } else if (action === 'SELL') {
      events = openOrFlipPosition(client, {
        symbol,
        interval,
        side: 'SHORT',
        sizeQuote,
        price,
        mode: 'manual',
        note: body.note || '',
        reason: 'Manual SELL',
      });
    } else if (action === 'CLOSE') {
      const event = closePosition(client, key, price, 'manual', {
        note: body.note || '',
        reason: 'Manual CLOSE',
      });
      events = event ? [event] : [];
    }
    client.lastTradeEvents = events;
    return client;
  });

  const positions = Object.fromEntries(Object.entries(updated.positions || {}).map(([entryKey, value]) => [entryKey, snapshotPosition(value)]));
  return send(res, 200, {
    ok: true,
    trades: updated.trades || [],
    positions,
    account: updated.account,
    lastTradeEvents: updated.lastTradeEvents || [],
  });
};
