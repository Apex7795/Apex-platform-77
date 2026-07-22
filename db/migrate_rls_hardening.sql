-- db/migrate_rls_hardening.sql
--
-- Postgres exempts a table's OWNER from that table's own RLS policies,
-- no matter how ENABLE ROW LEVEL SECURITY / CREATE POLICY are set up.
-- Every migration so far (db/schema.sql, db/migrate_combined.sql,
-- scripts/migrate.js) has run as whatever role owns these tables, and the
-- app has been querying through that same connection string. If that's
-- true in any live environment, `app.current_tenant_id` tenant isolation
-- is currently a no-op for that connection: the owner role sees every
-- tenant's rows regardless of the policies below.
--
-- This migration creates a separate, non-owner `app_user` role that only
-- has DML privileges (SELECT/INSERT/UPDATE/DELETE) and no DDL/ownership,
-- so RLS actually applies to it. Going forward:
--   * DATABASE_URL (used by the running app/worker) -> app_user
--   * MIGRATION_DATABASE_URL (used only by migrations) -> the existing
--     owner/superuser role that already ran db/schema.sql etc.
-- Run this file itself with MIGRATION_DATABASE_URL (or another owner-level
-- connection) since creating a role and granting privileges is DDL that
-- app_user must not be able to do.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    -- Change this password before deploying; 'changeme' only matches the
    -- .env.example placeholder so the two stay obviously in sync locally.
    CREATE ROLE app_user WITH LOGIN PASSWORD 'changeme' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO app_user;

-- DML only — no CREATE/ALTER/DROP, so app_user can never run migrations
-- (and, more importantly, can never accidentally become a table owner).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Apply the same grants automatically to tables created by future
-- migrations (run as the owner role), so this doesn't need re-running
-- every time db/migrate_*.sql adds a table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO app_user;

-- --------------------------------------------------------------
-- Tenant pre-lookup functions
--
-- sms-inbound, messenger-inbound, and voice all need to answer "which
-- tenant does this caller/number belong to?" BEFORE tenant_id is known —
-- that's an inherently cross-tenant read, which RLS is specifically
-- designed to block for app_user. Under plain RLS, app_user would just
-- get zero rows back for these lookups forever (current_setting(...,
-- true) makes it fail quiet instead of throwing, which is worse: every
-- inbound contact on all three channels would silently never match a
-- tenant). SECURITY DEFINER functions give app_user a narrow, owner-
-- privileged path to exactly these two lookups — nothing else — so RLS
-- still protects direct table access everywhere else.
--
-- SET search_path pins name resolution to `public`, so a caller can't
-- redirect this definer-privileged function at an attacker-controlled
-- object by manipulating their session's search_path.
CREATE OR REPLACE FUNCTION lookup_tenant_by_caller(p_caller_number TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM leads
  WHERE caller_number = p_caller_number
  ORDER BY created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION lookup_tracking_number(p_phone_number TEXT)
RETURNS TABLE(tenant_id UUID, forwards_to TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id, forwards_to FROM tracking_numbers
  WHERE phone_number = p_phone_number AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION lookup_tenant_by_caller(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION lookup_tracking_number(TEXT) TO app_user;
