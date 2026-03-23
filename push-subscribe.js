const { allowMethods, readJson, send } = require('./_lib/http');
const { updateClientState } = require('./_lib/state');
const { isPushConfigured } = require('./_lib/push');

module.exports = async (req, res) => {
  allowMethods(res, ['POST', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const body = await readJson(req);
  if (!body.clientId || !body.subscription) return send(res, 400, { error: 'Missing clientId or subscription' });
  if (!isPushConfigured()) return send(res, 400, { error: 'Push env vars are not configured yet' });

  const updated = await updateClientState(body.clientId, client => {
    client.subscriptions = Array.isArray(client.subscriptions) ? client.subscriptions : [];
    const exists = client.subscriptions.find(item => item.endpoint === body.subscription.endpoint);
    if (!exists) {
      client.subscriptions.push(body.subscription);
    }
    return client;
  });

  return send(res, 200, { ok: true, subscriptions: updated.subscriptions.length });
};
