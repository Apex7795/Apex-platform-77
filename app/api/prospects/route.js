// app/api/prospects/route.js
// GET /api/prospects?status=discovered&tier=hot&page=1  -> list/filter prospects for the admin dashboard
import { pool } from '../../../lib/db';
import { requireAdminAuth } from '../../../lib/adminAuth';

const VALID_TIERS = ['hot', 'warm', 'cold', 'disqualified'];

export async function GET(req) {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status'); // optional filter
  const tier = searchParams.get('tier'); // optional filter: hot | warm | cold | disqualified
  const page = parseInt(searchParams.get('page'), 10) || 1;
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  if (tier && !VALID_TIERS.includes(tier)) {
    return new Response(JSON.stringify({ error: `tier must be one of ${VALID_TIERS.join(', ')}` }), {
      status: 400,
    });
  }

  try {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (tier) {
      params.push(tier);
      conditions.push(`fit_tier = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(pageSize, offset);
    const limitParamIdx = params.length - 1;
    const offsetParamIdx = params.length;

    const { rows } = await pool.query(
      `SELECT id, business_name, phone, email, website, city, state,
              status, opted_out, contact_attempts, last_contacted_at, discovered_at,
              rating, review_count, fit_score, fit_tier, fit_reasons
       FROM prospects
       ${whereClause}
       ORDER BY fit_score DESC NULLS LAST, discovered_at DESC
       LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      params
    );

    return new Response(JSON.stringify({ prospects: rows, page, pageSize }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Prospect list error:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch prospects' }), { status: 500 });
  }
}
