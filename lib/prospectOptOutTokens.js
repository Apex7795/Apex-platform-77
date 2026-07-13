// lib/prospectOptOutTokens.js
// Signed, tamper-proof unsubscribe links for prospect outreach emails.
// Same HMAC pattern as lib/actionTokens.js, kept separate because this
// token type only ever does one thing (opt a prospect out) and has no
// tenant/resource-type generality to share with action tokens.
const crypto = require('crypto');

const SECRET = process.env.ACTION_TOKEN_SECRET; // reuse the same server secret

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Generic signed-token generator for prospect-scoped, single-purpose links.
// purpose is either 'prospect_opt_out' or 'prospect_reply' — kept in one
// function since both are the same shape (prospect id + a fixed purpose)
// and only ever get verified against that one expected purpose.
function generateProspectToken(prospectId, purpose) {
  if (!SECRET) throw new Error('ACTION_TOKEN_SECRET is not set');
  const payload = { prospectId, purpose };
  const payloadStr = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

function verifyProspectToken(token, expectedPurpose) {
  if (!SECRET) throw new Error('ACTION_TOKEN_SECRET is not set');
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;

  const [payloadStr, signature] = token.split('.');
  const expectedSignature = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());
    if (payload.purpose !== expectedPurpose || !payload.prospectId) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- Backwards-compatible named wrappers ---
const generateOptOutToken = (prospectId) => generateProspectToken(prospectId, 'prospect_opt_out');
const verifyOptOutToken = (token) => verifyProspectToken(token, 'prospect_opt_out');
const generateReplyToken = (prospectId) => generateProspectToken(prospectId, 'prospect_reply');
const verifyReplyToken = (token) => verifyProspectToken(token, 'prospect_reply');

module.exports = {
  generateOptOutToken,
  verifyOptOutToken,
  generateReplyToken,
  verifyReplyToken,
};
