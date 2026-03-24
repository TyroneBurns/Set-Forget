const { allowMethods, send } = require('./_lib/http');
const { getClientState, updateClientState, appendHistory } = require('./_lib/state');
const { fetchCandles } = require('./_lib/market');
const { analyseCandles, pairKey } = require('./_lib/hmm');
const { sendPush } = require('./_lib/push');
const { applyAutoSignal } = require('./_lib/trading');
const { publish } = require('./_lib/ably');

module.exports = async (req, res) => {
  allowMethods(res, ['GET', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const clientId = req.query.clientId;
  if (!clientId) return send(res, 400, { error: 'Missing clientId' });

  const baseClient = await getClientState(clientId);
  const enabledItems = (baseClient.watchlist || []).filter(item => item.enabled !== false);
  const latestMap = {};

  const updated = await updateClientState(clientId, async client => {
    client.subscriptions = Array.isArray(client.subscriptions) ? client.subscriptions : [];
    client.lastSignals = client.lastSignals || {};

    for (const item of enabledItems) {
      const key = pairKey(item.symbol, item.interval);
      const candles = await fetchCandles(item.symbol, item.interval, client.settings.scanLimit || 180);
      const analysis = analyseCandles(candles, client.settings);
      if (!analysis.latest) continue;

      const latest = {
        ...analysis.latest,
        symbol: item.symbol,
        interval: item.interval,
        pairKey: key,
      };
      latestMap[key] = latest;

      const previous = client.lastSignals[key];
      const changed = previous !== latest.signal;

      if (!changed) continue;

      client.lastSignals[key] = latest.signal;
      const historyEntry = {
        ts: Date.now(),
        symbol: item.symbol,
        interval: item.interval,
        pairKey: key,
        signal: latest.signal,
        regime: latest.regime,
        confidence: latest.confidence,
        bull: latest.bull,
        bear: latest.bear,
        chop: latest.chop,
        price: latest.price,
        source: 'scan',
        clientId,
      };

      await appendHistory(key, historyEntry, 400);

      if (changed) {
        try {
          await publish(`pair:${key}`, 'signal', { latest, historyEntry });
          await publish(`client:${clientId}`, 'refresh', { reason: 'signal', pairKey: key, signal: latest.signal });
        } catch (error) {
          console.error(error);
        }
      }

      if (client.settings.autoTrade) {
        const autoEvents = applyAutoSignal(client, item, latest.signal, latest.price);
        if (autoEvents.length) {
          historyEntry.autoTrades = autoEvents.map(event => ({
            action: event.action,
            side: event.side,
            price: event.price,
            sizeQuote: event.sizeQuote,
          }));
        }
      }

      if (client.subscriptions.length) {
        const payload = {
          title: `${item.symbol} ${item.interval} · ${latest.signal}`,
          body: `${latest.regime} · ${latest.confidence}% confidence · ${latest.price}`,
          tag: `signal-${key}`,
          url: `/?pair=${encodeURIComponent(key)}`,
          pairKey: key,
          signal: latest.signal,
        };

        const validSubs = [];
        for (const subscription of client.subscriptions) {
          try {
            await sendPush(subscription, payload);
            validSubs.push(subscription);
          } catch (error) {
            const statusCode = error && error.statusCode;
            if (statusCode !== 404 && statusCode !== 410) validSubs.push(subscription);
          }
        }
        client.subscriptions = validSubs;
      }
    }

    client.lastScanAt = Date.now();
    return client;
  });

  return send(res, 200, {
    ok: true,
    clientId,
    latestMap,
    lastSignals: updated.lastSignals,
    trades: updated.trades,
    positions: updated.positions,
    account: updated.account,
  });
};