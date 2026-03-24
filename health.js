module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    app: process.env.APP_NAME || 'Set & Forget',
    timestamp: new Date().toISOString()
  });
};
