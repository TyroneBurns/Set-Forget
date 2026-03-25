export default async function handler(req, res) {
  const pairs = (process.env.DEFAULT_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    appName: process.env.APP_NAME || 'Set & Forget',
    defaultPairs: pairs,
    defaultTimeframe: process.env.DEFAULT_TIMEFRAME || '15m',
    nextRunSeconds: 300
  }));
}
