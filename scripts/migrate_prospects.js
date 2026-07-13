// scripts/migrate_prospects.js
// Adds the Prospecting & Enrichment Module schema.
// Prospects are Apex's own acquisition data (businesses you're trying to
// SIGN UP as tenants) — not tenant-owned data, so this intentionally has
// no RLS policy, same as campaign_templates.
const { pool } = require('../lib/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS prospects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        website TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        service_type TEXT NOT NULL DEFAULT 'junk_removal',
        source TEXT NOT NULL,               -- google_places | dataforseo | manual
        source_place_id TEXT,               -- external ID, for de-duping re-runs
        status TEXT NOT NULL DEFAULT 'discovered'
          CHECK (status IN ('discovered', 'enriched', 'contacted', 'replied', 'converted', 'opted_out')),
        opted_out BOOLEAN NOT NULL DEFAULT false,
        opted_out_at TIMESTAMPTZ,
        last_contacted_at TIMESTAMPTZ,
        contact_attempts INT NOT NULL DEFAULT 0,
        converted_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (source, source_place_id)
      );
    `);

    // Outreach log — separate from the audit_logs table since this tracks
    // pre-tenant activity (a prospect isn't a tenant yet, so it can't hang
    // off tenant_id the way audit_logs does).
    await client.query(`
      CREATE TABLE IF NOT EXISTS prospect_outreach_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        channel TEXT NOT NULL DEFAULT 'email',
        subject TEXT,
        body TEXT,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
      CREATE INDEX IF NOT EXISTS idx_prospects_city ON prospects(city, state);
      CREATE INDEX IF NOT EXISTS idx_prospects_opted_out ON prospects(opted_out) WHERE opted_out = true;
      CREATE INDEX IF NOT EXISTS idx_outreach_log_prospect ON prospect_outreach_log(prospect_id);
    `);

    await client.query('COMMIT');
    console.log('--- Prospecting Module Migration Committed Successfully ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration Failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
