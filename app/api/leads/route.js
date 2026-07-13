// app/api/leads/route.js
// GET /api/leads?page=1
//
// Tenant auth gap: this relies on req.user.tenant_id, which implies a
// session/login system for tenant owners that (per lib/adminAuth.js's own
// comment) is referenced but never actually defined anywhere in this
// codebase. Left as-is — that's a product decision, not a bug fix — so
// this route will 401 until real tenant session auth exists upstream.
import { runWithTenant } from '../../../lib/db';

export async function GET(req) {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page'), 10) || 1;
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  try {
    const leads = await runWithTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, caller_number, call_duration_seconds, status,
                created_at, recording_url
         FROM leads
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );
      return rows;
    });

    return Response.json({ leads, page, pageSize });
  } catch (err) {
    console.error('Lead fetch error:', err.message, { tenantId });
    return Response.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}
