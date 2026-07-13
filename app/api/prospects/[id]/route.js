// app/api/prospects/[id]/route.js
// PATCH /api/prospects/:id  { "status": "converted" }
import { pool } from '../../../../lib/db';
import { requireAdminAuth } from '../../../../lib/adminAuth';

const VALID_STATUSES = ['discovered', 'enriched', 'contacted', 'replied', 'converted', 'opted_out'];

export async function PATCH(req, { params }) {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  const { id } = params;
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { status } = body;
  if (!VALID_STATUSES.includes(status)) {
    return new Response(JSON.stringify({ error: 'Invalid status value' }), { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE prospects SET status = $1, updated_at = now() WHERE id = $2 RETURNING id`,
      [status, id]
    );

    if (result.rowCount === 0) {
      return new Response(JSON.stringify({ error: 'Prospect not found' }), { status: 404 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('Prospect status update error:', err.message, { id });
    return new Response(JSON.stringify({ error: 'Failed to update prospect' }), { status: 500 });
  }
}
