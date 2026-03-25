export default async function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, app: process.env.APP_NAME || 'Set & Forget', timestamp: new Date().toISOString() }));
}
