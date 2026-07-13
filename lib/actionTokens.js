// lib/actionTokens.js
// Signed, time-limited tokens for one-click SMS action links.
// Uses HMAC so tokens can't be forged without the server secret, and an
// embedded expiry so old links stop working automatically.
const crypto = require('crypto');

const SECRET = process.env.ACTION_TOKEN_SECRET; // separate from other app secrets
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// --- Generate a token for a specific tenant + action + resource ---
// e.g. generateActionToken({ tenantId, action: 'pause_campaign', resourceId: campaignId })
function generateActionToken({ tenantId, action, resourceId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!SECRET) throw new Error('ACTION_TOKEN_SECRET is not set');
  const payload = {
    tenantId,
    action,
    resourceId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadStr = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

// --- Verify a token, returning the payload if valid, or null if not ---
function verifyActionToken(token, { expectedAction, expectedResourceId } = {}) {
  if (!SECRET) throw new Error('ACTION_TOKEN_SECRET is not set');
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;

  const [payloadStr, signature] = token.split('.');
  const expectedSignature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');

  // Timing-safe comparison to avoid signature-guessing via response timing
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());
  } catch {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
  if (expectedAction && payload.action !== expectedAction) return null;
  if (expectedResourceId && String(payload.resourceId) !== String(expectedResourceId)) return null;

  return payload;
}

module.exports = { generateActionToken, verifyActionToken };
