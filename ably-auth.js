const { allowMethods, send } = require('./_lib/http');
const { createTokenRequest } = require('./_lib/ably');

module.exports = async (req, res) => {
  allowMethods(res, ['GET', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  try {
    const clientId = req.query.clientId || `client_${Date.now().toString(36)}`;
    const tokenRequest = await createTokenRequest(clientId);
    if (!tokenRequest) return send(res, 400, { error: 'ABLY_API_KEY is not configured' });
    return send(res, 200, tokenRequest);
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
};
