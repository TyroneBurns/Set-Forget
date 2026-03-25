import Ably from 'ably';
export default async function handler(req, res) {
  try {
    const apiKey = process.env.ABLY_API_KEY;
    if (!apiKey) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ enabled: false }));
    }
    const client = new Ably.Rest(apiKey);
    const tokenRequest = await client.auth.createTokenRequest({ clientId: 'set-forget-client' });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ enabled: true, tokenRequest }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ enabled: false, error: error.message || 'Token request failed' }));
  }
}
