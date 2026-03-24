module.exports = async (req, res) => {
  res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, app: process.env.APP_NAME || 'Set & Forget', time: Date.now() }));
};
