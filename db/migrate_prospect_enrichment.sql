-- db/migrate_prospect_enrichment.sql
-- Extends `prospects` for waterfall enrichment + AI-personalized outreach.
-- Layered on top of db/migrate_combined.sql (already applied) — this is a
-- separate, later migration, not an edit to the original.

BEGIN;

ALTER TABLE prospects
    ADD COLUMN IF NOT EXISTS domain TEXT,
    ADD COLUMN IF NOT EXISTS emails JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS firmographics JSONB,
    ADD COLUMN IF NOT EXISTS intent_signals JSONB,
    ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

-- Backfill domain from the existing `website` column where possible, so
-- prospects discovered via Google Places (which populate `website`, not
-- `domain`) are still reachable by the new hygiene job's WHERE clause.
UPDATE prospects
SET domain = regexp_replace(regexp_replace(website, '^https?://', ''), '^www\.', '')
WHERE domain IS NULL AND website IS NOT NULL;

-- Keep the legacy singular `email` column as the "primary" email, since
-- services/prospectOutreach.js and the opt-out/reply routes already read
-- prospect.email directly. `emails` (plural, JSONB) is the new source of
-- truth for the full enrichment result; email stays in sync via the
-- application code in waterfallEnrichment's write path, not a DB trigger,
-- since the sync logic needs "pick the best one" judgment a trigger can't
-- easily express.

-- Dedup key: a domain can only be one prospect. Partial index (not a full
-- UNIQUE constraint) because plenty of existing rows have NULL domain
-- (Google Places discoveries with no website) and NULLs must stay allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_domain
    ON prospects(domain) WHERE domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospects_last_enriched_at ON prospects(last_enriched_at);

COMMIT;
