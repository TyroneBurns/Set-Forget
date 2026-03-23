const { allowMethods, readJson, send } = require('./_lib/http');
const { updateClientState } = require('./_lib/state');

module.exports = async (req, res) => {
  allowMethods(res, ['POST', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const body = await readJson(req);
  if (!body.clientId || !body.endpoint) return send(res, 400, { error: 'Missing clientId or endpoint' });

  const updated = await updateClientState(body.clientId, client => {
    client.subscriptions = (client.subscriptions || []).filter(item => item.endpoint !== body.endpoint);
    return client;
  });

  return send(res, 200, { ok: true, subscriptions: updated.subscriptions.length });
};
