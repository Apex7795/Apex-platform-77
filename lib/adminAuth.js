// lib/adminAuth.js
// Minimal admin authentication for internal-only routes (the prospecting
// admin endpoints — discovery, list, outreach triggers, status updates).
//
// This is NOT the same thing as tenant auth. Tenant-facing routes
// (app/api/leads/*, app/api/action/*) rely on req.user.tenant_id, which
// implies a session/login system for tenant owners that was referenced
// but never actually defined anywhere in this codebase. Prospects are
// Apex's own internal acquisition data — no tenant should ever see it —
// so it needs a *different* gate: "is this an authenticated Apex staff
// member," not "which tenant is this."
//
// As shipped, this is a single shared bearer token (ADMIN_API_TOKEN) —
// enough to stop the routes being wide open to the public internet, which
// was the actual state before this file existed. It is NOT a substitute
// for real per-admin-user authentication (individual logins, audit trail
// of which admin did what, revocable per-person access). Replace this
// with your real admin session/login system once one exists; until then,
// treat ADMIN_API_TOKEN as a single shared secret and rotate it if anyone
// with access leaves.
const crypto = require('crypto');

function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Call at the top of every admin-only route handler. Returns null if the
 * request is authorized; returns a Response object to send back
 * immediately (unauthorized) otherwise.
 *
 * Usage:
 *   const authError = requireAdminAuth(req);
 *   if (authError) return authError;
 */
function requireAdminAuth(req) {
  const configuredToken = process.env.ADMIN_API_TOKEN;
  if (!configuredToken) {
    // Fail closed, not open — a missing env var should not silently
    // disable auth. This is the same "fail closed" principle already
    // applied to the RLS current_setting(..., true) fix.
    console.error('ADMIN_API_TOKEN is not set — refusing all admin requests');
    return new Response(JSON.stringify({ error: 'Admin auth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token || !timingSafeStringEqual(token, configuredToken)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

module.exports = { requireAdminAuth };
