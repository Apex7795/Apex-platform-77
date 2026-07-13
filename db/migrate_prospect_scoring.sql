-- db/migrate_prospect_scoring.sql
-- Adds fit-scoring columns to prospects, plus the raw Google Places signals
-- the scoring model reads from. Layered on top of
-- db/migrate_prospect_enrichment.sql (run after that one).

BEGIN;

ALTER TABLE prospects
    ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1),
    ADD COLUMN IF NOT EXISTS review_count INT,
    ADD COLUMN IF NOT EXISTS business_status TEXT, -- OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
    ADD COLUMN IF NOT EXISTS fit_score INT,
    ADD COLUMN IF NOT EXISTS fit_tier TEXT
        CHECK (fit_tier IN ('hot', 'warm', 'cold', 'disqualified')),
    ADD COLUMN IF NOT EXISTS fit_reasons JSONB;

CREATE INDEX IF NOT EXISTS idx_prospects_fit_tier ON prospects(fit_tier);
CREATE INDEX IF NOT EXISTS idx_prospects_fit_score ON prospects(fit_score DESC);

COMMIT;
