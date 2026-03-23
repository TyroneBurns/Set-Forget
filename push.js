const webpush = require('web-push');

function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function ensurePushConfig() {
  if (!isPushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

async function sendPush(subscription, payload) {
  if (!ensurePushConfig()) {
    throw new Error('Push is not configured. Add VAPID env vars.');
  }
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

module.exports = {
  isPushConfigured,
  ensurePushConfig,
  sendPush,
};
