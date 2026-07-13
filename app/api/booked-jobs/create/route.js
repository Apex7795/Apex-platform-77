import { pool } from '../../../../lib/db';

// Verify admin token
async function verifyAdmin(request) {
  const auth = request.headers.get('authorization');

  if (!auth || !auth.startsWith('Bearer ')) {
    return false;
  }

  const token = auth.substring(7);
  return token === process.env.ADMIN_API_TOKEN;
}

// Validate UUID format
function isValidUUID(uuid) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

export async function POST(request) {
  try {
    // Verify admin
    const isAdmin = await verifyAdmin(request);
    if (!isAdmin) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { lead_id, prospect_id, job_description, estimated_value, commission_rate = 10 } = await request.json();

    // Validate required fields
    if (!lead_id || !estimated_value || typeof estimated_value !== 'number') {
      return Response.json({
        error: 'Missing or invalid fields: lead_id, estimated_value required'
      }, { status: 400 });
    }

    // Validate UUIDs
    if (!isValidUUID(lead_id) || (prospect_id && !isValidUUID(prospect_id))) {
      return Response.json({ error: 'Invalid UUID format' }, { status: 400 });
    }

    // Validate commission rate
    if (commission_rate < 0 || commission_rate > 100) {
      return Response.json({ error: 'Commission rate must be 0-100' }, { status: 400 });
    }

    const commission_amount = estimated_value * (commission_rate / 100);
    const tenant_id = process.env.PROSPECTING_HOUSE_TENANT_ID;

    // Insert into database with transaction
    const result = await pool.query(
      `INSERT INTO booked_jobs (lead_id, prospect_id, tenant_id, job_description, estimated_value, commission_rate, commission_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [lead_id, prospect_id || null, tenant_id, job_description || null, estimated_value, commission_rate, commission_amount, 'pending']
    );

    if (result.rows.length === 0) {
      return Response.json({ error: 'Failed to create booked job' }, { status: 500 });
    }

    return Response.json({
      id: result.rows[0].id,
      lead_id,
      prospect_id,
      commission_amount,
      status: 'pending',
      created_at: result.rows[0].created_at
    }, { status: 201 });

  } catch (error) {
    console.error('Booked jobs API error:', error);

    if (error.code === '23503') {
      return Response.json({ error: 'Invalid lead_id or prospect_id' }, { status: 400 });
    }

    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
