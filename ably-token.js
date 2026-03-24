const Ably = require('ably');

module.exports = async (req, res) => {
  try {
    const apiKey = process.env.ABLY_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ enabled: false });
    }

    const client = new Ably.Rest(apiKey);
    const tokenRequest = await client.auth.createTokenRequest({
      clientId: 'set-forget-client'
    });

    res.status(200).json({
      enabled: true,
      tokenRequest
    });
  } catch (error) {
    res.status(500).json({
      enabled: false,
      error: error.message || 'Token request failed'
    });
  }
};
