const { pairKey, splitPairKey } = require('./hmm');

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function ensureAccount(client) {
  if (!client.account) {
    client.account = {
      startingBalance: 10000,
      realizedPnl: 0,
      updatedAt: Date.now(),
    };
  }
  return client.account;
}

function ensureCollections(client) {
  client.positions = client.positions || {};
  client.trades = Array.isArray(client.trades) ? client.trades : [];
  client.lastSignals = client.lastSignals || {};
  ensureAccount(client);
}

function snapshotPosition(position) {
  if (!position) return null;
  return {
    side: position.side,
    qty: Number(position.qty.toFixed(8)),
    sizeQuote: Number(position.sizeQuote.toFixed(2)),
    entryPrice: Number(position.entryPrice.toFixed(6)),
    openedAt: position.openedAt,
    mode: position.mode,
  };
}

function pushTrade(client, trade) {
  client.trades.unshift(trade);
  client.trades = client.trades.slice(0, 300);
  client.account.updatedAt = Date.now();
}

function closePosition(client, key, price, mode, meta = {}) {
  ensureCollections(client);
  const position = client.positions[key];
  if (!position) return null;

  const { symbol, interval } = splitPairKey(key);
  const realizedPnl = position.side === 'LONG'
    ? (price - position.entryPrice) * position.qty
    : (position.entryPrice - price) * position.qty;

  client.account.realizedPnl = Number((client.account.realizedPnl + realizedPnl).toFixed(8));

  const trade = {
    id: makeId('trade'),
    ts: Date.now(),
    symbol,
    interval,
    pairKey: key,
    action: 'CLOSE',
    side: position.side,
    price: Number(price),
    qty: Number(position.qty.toFixed(8)),
    sizeQuote: Number(position.sizeQuote.toFixed(2)),
    realizedPnl: Number(realizedPnl.toFixed(8)),
    mode,
    note: meta.note || '',
    reason: meta.reason || '',
  };

  delete client.positions[key];
  pushTrade(client, trade);
  return trade;
}

function openOrFlipPosition(client, { symbol, interval, side, sizeQuote, price, mode, note = '', reason = '' }) {
  ensureCollections(client);
  const key = pairKey(symbol, interval);
  const nextSide = side === 'SHORT' ? 'SHORT' : 'LONG';
  const cleanSize = Math.max(Number(sizeQuote || 0), 1);
  const cleanPrice = Math.max(Number(price || 0), 0.00000001);
  const qty = cleanSize / cleanPrice;

  const current = client.positions[key];
  const events = [];

  if (current && current.side !== nextSide) {
    const closeEvent = closePosition(client, key, cleanPrice, mode, { note, reason });
    if (closeEvent) events.push(closeEvent);
  }

  const existing = client.positions[key];
  if (existing && existing.side === nextSide) {
    const totalQty = existing.qty + qty;
    const weightedEntry = ((existing.entryPrice * existing.qty) + (cleanPrice * qty)) / totalQty;
    existing.qty = totalQty;
    existing.sizeQuote = existing.sizeQuote + cleanSize;
    existing.entryPrice = weightedEntry;
    existing.updatedAt = Date.now();

    const scaleTrade = {
      id: makeId('trade'),
      ts: Date.now(),
      symbol: symbol.toUpperCase(),
      interval,
      pairKey: key,
      action: nextSide === 'LONG' ? 'BUY' : 'SELL',
      side: nextSide,
      price: Number(cleanPrice),
      qty: Number(qty.toFixed(8)),
      sizeQuote: Number(cleanSize.toFixed(2)),
      realizedPnl: 0,
      mode,
      note,
      reason,
    };
    pushTrade(client, scaleTrade);
    events.push(scaleTrade);
    return events;
  }

  client.positions[key] = {
    side: nextSide,
    qty,
    sizeQuote: cleanSize,
    entryPrice: cleanPrice,
    openedAt: Date.now(),
    updatedAt: Date.now(),
    mode,
  };

  const openTrade = {
    id: makeId('trade'),
    ts: Date.now(),
    symbol: symbol.toUpperCase(),
    interval,
    pairKey: key,
    action: nextSide === 'LONG' ? 'BUY' : 'SELL',
    side: nextSide,
    price: Number(cleanPrice),
    qty: Number(qty.toFixed(8)),
    sizeQuote: Number(cleanSize.toFixed(2)),
    realizedPnl: 0,
    mode,
    note,
    reason,
  };
  pushTrade(client, openTrade);
  events.push(openTrade);
  return events;
}

function applyAutoSignal(client, item, latestSignal, latestPrice) {
  ensureCollections(client);
  const key = pairKey(item.symbol, item.interval);
  const settings = client.settings || {};
  const sizeQuote = Math.max(Number(client.tradeSize || settings.tradeSize || 100), 1);
  const current = client.positions[key];

  if (latestSignal === 'LONG') {
    if (current && current.side === 'LONG') return [];
    return openOrFlipPosition(client, {
      symbol: item.symbol,
      interval: item.interval,
      side: 'LONG',
      sizeQuote,
      price: latestPrice,
      mode: 'auto',
      reason: 'Signal turned LONG',
    });
  }

  if (latestSignal === 'SHORT') {
    if (current && current.side === 'SHORT') return [];
    return openOrFlipPosition(client, {
      symbol: item.symbol,
      interval: item.interval,
      side: 'SHORT',
      sizeQuote,
      price: latestPrice,
      mode: 'auto',
      reason: 'Signal turned SHORT',
    });
  }

  if (latestSignal === 'FLAT' && settings.exitOnChop !== false && current) {
    const closeTrade = closePosition(client, key, latestPrice, 'auto', { reason: 'Signal went FLAT / CHOP' });
    return closeTrade ? [closeTrade] : [];
  }

  return [];
}

module.exports = {
  ensureCollections,
  ensureAccount,
  snapshotPosition,
  openOrFlipPosition,
  closePosition,
  applyAutoSignal,
  makeId,
};
