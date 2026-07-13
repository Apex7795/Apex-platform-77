-- Multi-tenant lead-gen SaaS schema
-- Tenant isolation via tenant_id column + row-level security (RLS)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TENANTS (the junk removal companies / your customers)
-- ============================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    service_type TEXT NOT NULL, -- e.g. "junk_removal"
    service_area TEXT NOT NULL, -- city / zip
    subdomain TEXT UNIQUE NOT NULL,
    owner_email TEXT NOT NULL,
    owner_phone TEXT NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'trialing',
    -- trialing | active | past_due | canceled
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USERS (login accounts, scoped to a tenant)
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner', -- owner | staff
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LANDING PAGES (AI-generated content, structured not raw HTML)
-- ============================================================
CREATE TABLE landing_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    headline TEXT NOT NULL,
    content_json JSONB NOT NULL, -- sections, CTA, images refs
    theme TEXT NOT NULL DEFAULT 'default',
    is_published BOOLEAN NOT NULL DEFAULT false,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TRACKING NUMBERS (Twilio numbers assigned per tenant)
-- ============================================================
CREATE TABLE tracking_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    twilio_sid TEXT UNIQUE NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    forwards_to TEXT NOT NULL, -- owner_phone at time of provisioning
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LEADS (calls, form fills, any conversion event)
-- ============================================================
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source TEXT NOT NULL, -- call | form | sms
    caller_number TEXT,
    call_duration_seconds INT,
    call_sid TEXT UNIQUE,
    recording_url TEXT,
    form_data JSONB,
    status TEXT NOT NULL DEFAULT 'new',
    -- new | no_answer | contacted | quoted | won | lost
    last_touched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rescue_stage INT NOT NULL DEFAULT 0,
    -- 0 = no rescue sent, 1 = immediate SMS sent, 2 = follow-up SMS sent
    sms_opt_out BOOLEAN NOT NULL DEFAULT false,
    context_notes TEXT, -- e.g. "mentioned full garage" for personalized follow-up
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AD CAMPAIGNS (Phase 2 — Google/Meta, manual at MVP stage)
-- ============================================================
CREATE TABLE ad_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, -- google | meta
    category TEXT, -- links to campaign_templates.category
    external_campaign_id TEXT,
    daily_budget_cents INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    -- draft | active | paused | ended
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- CAMPAIGN TEMPLATES (shared reference data, not tenant-scoped)
-- ============================================================
CREATE TABLE campaign_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL, -- e.g. 'hot_tub', 'garage_cleanout'
    headline TEXT NOT NULL,
    body TEXT NOT NULL,
    keywords TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIT LOGS (one-click action tracking — matches tenants.id UUID type)
-- ============================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL, -- e.g. 'pause_campaign', 'launch_campaign'
    resource_id UUID, -- ID of the campaign or lead affected
    metadata JSONB, -- IP, token expiry, or other context
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_landing_pages_tenant ON landing_pages(tenant_id);
CREATE INDEX idx_tracking_numbers_tenant ON tracking_numbers(tenant_id);
CREATE INDEX idx_leads_tenant ON leads(tenant_id);
CREATE INDEX idx_leads_created_at ON leads(tenant_id, created_at DESC);
CREATE INDEX idx_leads_rescue ON leads(status, rescue_stage, last_touched_at)
    WHERE status IN ('new', 'no_answer');
CREATE INDEX idx_ad_campaigns_tenant ON ad_campaigns(tenant_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- Set `app.current_tenant_id` per request (e.g. via SET LOCAL
-- in a transaction, populated from the authenticated session)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_landing_pages ON landing_pages
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_tracking_numbers ON tracking_numbers
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_leads ON leads
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_ad_campaigns ON ad_campaigns
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
