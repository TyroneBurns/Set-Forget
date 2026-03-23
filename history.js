const { allowMethods, send } = require('./_lib/http');
const { getHistory, getClientState } = require('./_lib/state');
const { pairKey } = require('./_lib/hmm');

module.exports = async (req, res) => {
  allowMethods(res, ['GET', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const client = await getClientState(req.query.clientId);
  const key = req.query.pairKey || pairKey(req.query.symbol || client.selectedPairKey.split('|')[0], req.query.interval || client.selectedPairKey.split('|')[1]);
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 250);
  const history = await getHistory(key, limit);

  return send(res, 200, {
    ok: true,
    pairKey: key,
    history,
  });
};
