// app/api/leads/active-call/route.js
// GET /api/leads/active-call?phone=+15551234567
// Looks up prior call history for a caller, for a "who's calling" popup while
// the phone is ringing. Matches on leads.caller_number, tenant-scoped.
//
// Tenant auth gap: see app/api/leads/route.js — req.user.tenant_id is not
// actually populated by anything yet.
import { runWithTenant } from '../../../../lib/db';

export async function GET(req) {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const phone = searchParams.get('phone');
  if (!phone) {
    return Response.json({ error: 'phone query parameter is required' }, { status: 400 });
  }

  try {
    const leads = await runWithTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, caller_number, call_duration_seconds, status,
                context_notes, last_touched_at, created_at
         FROM leads
         WHERE caller_number = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [phone]
      );
      return rows;
    });

    if (leads.length === 0) {
      return Response.json({ isNewCaller: true, leads: [] });
    }

    return Response.json({ isNewCaller: false, leads });
  } catch (err) {
    console.error('Active call lookup error:', err.message, { tenantId, phone });
    return Response.json({ error: 'Failed to look up caller' }, { status: 500 });
  }
}
