// scripts/migrate.js - Atomic Migration Script
const { pool } = require('../lib/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // 1. Core Schema — UUID throughout to match RLS policies and app code
    await client.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';

      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        caller_number VARCHAR(20),
        call_sid TEXT UNIQUE,
        recording_url TEXT,
        status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'no_answer', 'contacted', 'quoted', 'won', 'lost')),
        rescue_stage INT DEFAULT 0 CHECK (rescue_stage IN (0, 1, 2)),
        sms_opt_out BOOLEAN DEFAULT false,
        context_notes TEXT,
        last_touched_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ad_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        platform VARCHAR(20) CHECK (platform IN ('google', 'meta')),
        category VARCHAR(50),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
        daily_budget_cents INT DEFAULT 5000,
        updated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
        action_type VARCHAR(50),
        resource_id UUID,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS campaign_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category VARCHAR(50),
        headline TEXT,
        body TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_leads_rescue_stage ON leads(tenant_id, rescue_stage);
      CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON ad_campaigns(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
    `);

    // 3. RLS — enabling without policies denies ALL access, so policies
    // must be created in the same migration, not left for later.
    await client.query(`
      ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
      ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation_leads ON leads;
      CREATE POLICY tenant_isolation_leads ON leads
        USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

      DROP POLICY IF EXISTS tenant_isolation_ad_campaigns ON ad_campaigns;
      CREATE POLICY tenant_isolation_ad_campaigns ON ad_campaigns
        USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

      DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
      CREATE POLICY tenant_isolation_audit_logs ON audit_logs
        USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
    `);

    // Note: campaign_templates is shared reference data (not tenant-owned),
    // so it intentionally has no RLS policy — every tenant can read it.

    await client.query('COMMIT');
    console.log('--- Migration Committed Successfully ---');
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
