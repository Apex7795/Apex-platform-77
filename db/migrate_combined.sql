-- scripts/migrate_combined.js content, as raw SQL for review.
-- Combines db/schema.sql (existing platform) with the Prospecting module's
-- migrate_prospects.js, as ONE atomic migration so prospects/outreach_log
-- never exist without the tenants table they FK against, and vice versa.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS throughout).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- EXISTING PLATFORM SCHEMA (unchanged from db/schema.sql)
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    service_type TEXT NOT NULL,
    service_area TEXT NOT NULL,
    subdomain TEXT UNIQUE NOT NULL,
    owner_email TEXT NOT NULL,
    owner_phone TEXT NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'trialing',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS landing_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    headline TEXT NOT NULL,
    content_json JSONB NOT NULL,
    theme TEXT NOT NULL DEFAULT 'default',
    is_published BOOLEAN NOT NULL DEFAULT false,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracking_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    twilio_sid TEXT UNIQUE NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    forwards_to TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    caller_number TEXT,
    call_duration_seconds INT,
    call_sid TEXT UNIQUE,
    recording_url TEXT,
    form_data JSONB,
    status TEXT NOT NULL DEFAULT 'new',
    last_touched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rescue_stage INT NOT NULL DEFAULT 0,
    sms_opt_out BOOLEAN NOT NULL DEFAULT false,
    context_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    category TEXT,
    external_campaign_id TEXT,
    daily_budget_cents INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,
    headline TEXT NOT NULL,
    body TEXT NOT NULL,
    keywords TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    resource_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_landing_pages_tenant ON landing_pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tracking_numbers_tenant ON tracking_numbers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_rescue ON leads(status, rescue_stage, last_touched_at)
    WHERE status IN ('new', 'no_answer');
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_tenant ON ad_campaigns(tenant_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

DROP POLICY IF EXISTS tenant_isolation_landing_pages ON landing_pages;
CREATE POLICY tenant_isolation_landing_pages ON landing_pages
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

DROP POLICY IF EXISTS tenant_isolation_tracking_numbers ON tracking_numbers;
CREATE POLICY tenant_isolation_tracking_numbers ON tracking_numbers
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

DROP POLICY IF EXISTS tenant_isolation_leads ON leads;
CREATE POLICY tenant_isolation_leads ON leads
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

DROP POLICY IF EXISTS tenant_isolation_ad_campaigns ON ad_campaigns;
CREATE POLICY tenant_isolation_ad_campaigns ON ad_campaigns
    USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- NOTE: changed from the original schema.sql, which called
-- current_setting('app.current_tenant_id') WITHOUT the `true` (missing_ok)
-- second argument. Without it, Postgres THROWS on any query run without
-- the session var set, instead of just returning zero rows. That's what
-- breaks the prospect-reply route below if it ever bypasses runWithTenant
-- again — adding `true` here makes "no tenant context" fail closed (0 rows)
-- rather than fail with a hard error, matching the behavior your audit_logs
-- RLS test script already expects.

-- ============================================================
-- PROSPECTING MODULE (new)
-- ============================================================

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
    source TEXT NOT NULL,
    source_place_id TEXT,
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

CREATE TABLE IF NOT EXISTS prospect_outreach_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    channel TEXT NOT NULL DEFAULT 'email',
    subject TEXT,
    body TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_city ON prospects(city, state);
CREATE INDEX IF NOT EXISTS idx_prospects_opted_out ON prospects(opted_out) WHERE opted_out = true;
CREATE INDEX IF NOT EXISTS idx_outreach_log_prospect ON prospect_outreach_log(prospect_id);

-- prospects / prospect_outreach_log intentionally have NO RLS, matching
-- campaign_templates: this is Apex's own acquisition data, not owned by
-- any tenant. Access control for these tables must happen at the route/
-- middleware layer instead (see the auth gap flagged separately).

COMMIT;
