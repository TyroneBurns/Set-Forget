module.exports = (req, res) => {
  const pairs = (process.env.DEFAULT_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  res.status(200).json({
    appName: process.env.APP_NAME || 'Set & Forget',
    defaultPairs: pairs,
    defaultTimeframe: process.env.DEFAULT_TIMEFRAME || '15m',
    ablyEnabled: Boolean(process.env.ABLY_API_KEY)
  });
};
