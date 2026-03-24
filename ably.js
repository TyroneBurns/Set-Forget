const Ably = require('ably');

let restClient = null;

function getAblyRest() {
  if (restClient) return restClient;
  if (!process.env.ABLY_API_KEY) return null;
  restClient = new Ably.Rest(process.env.ABLY_API_KEY);
  return restClient;
}

function getRealtimePublicConfig() {
  return {
    enabled: !!process.env.ABLY_API_KEY,
    authUrl: '/api/ably-auth',
  };
}

async function createTokenRequest(clientId) {
  const ably = getAblyRest();
  if (!ably) return null;
  return ably.auth.createTokenRequest({ clientId });
}

async function publish(channelName, name, data) {
  const ably = getAblyRest();
  if (!ably) return false;
  await ably.channels.get(channelName).publish(name, data);
  return true;
}

module.exports = {
  getAblyRest,
  getRealtimePublicConfig,
  createTokenRequest,
  publish,
};
