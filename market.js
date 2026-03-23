const BINANCE_API = 'https://api.binance.com/api/v3/klines';

function normalizeSymbol(value) {
  return String(value || 'BTCUSDT').replace('/', '').replace('-', '').toUpperCase().trim();
}

async function fetchCandles(symbol = 'BTCUSDT', interval = '15m', limit = 180) {
  const safeSymbol = normalizeSymbol(symbol);
  const safeInterval = interval || '15m';
  const safeLimit = Math.min(Math.max(Number(limit || 180), 60), 500);

  const url = `${BINANCE_API}?symbol=${encodeURIComponent(safeSymbol)}&interval=${encodeURIComponent(safeInterval)}&limit=${safeLimit}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'SetAndForget/2.0',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Market data failed for ${safeSymbol} ${safeInterval}: ${response.status} ${text}`);
  }

  const rows = await response.json();
  return rows.map(row => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

module.exports = {
  fetchCandles,
  normalizeSymbol,
};
