// lib/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // cap concurrent connections during high-traffic ad days
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Idle client errors (e.g. dropped connections) shouldn't crash the process
  console.error('Unexpected Postgres pool error:', err.message);
});

// --- Plain query helper for non-tenant-scoped lookups ---
// e.g. looking up which tenant owns a phone number, before tenant_id is known
async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// --- RLS-aware transaction helper ---
// Sets app.current_tenant_id for the duration of the transaction so
// row-level security policies on tenant-scoped tables are enforced.
async function runWithTenant(tenantId, callback) {
  if (!tenantId) {
    throw new Error('runWithTenant called without a tenantId');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FIXED: SET LOCAL with a bound parameter is unreliable across pg
    // driver/Postgres versions since SET is a utility statement, not a
    // regular query. set_config() is a normal function call, so parameter
    // binding works the same way it does for any other query. The third
    // argument (true = is_local) makes this scoped to the transaction,
    // same behavior as SET LOCAL had.
    await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', String(tenantId)]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, runWithTenant };
