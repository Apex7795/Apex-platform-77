-- Create prospects table if not exists with proper structure
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  rating DECIMAL(3, 2),
  review_count INTEGER DEFAULT 0,
  conversion_score INTEGER DEFAULT 0,
  conversion_probability DECIMAL(5, 2) DEFAULT 0.0,
  conversion_reasons JSONB,
  hiring_trend VARCHAR(20),
  review_velocity DECIMAL(8, 2) DEFAULT 0,
  last_scored_at TIMESTAMPTZ,
  last_score_review_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create leads table if not exists
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
  phone VARCHAR(20),
  email VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create or update booked_jobs table with constraints
CREATE TABLE IF NOT EXISTS booked_jobs (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL,
  job_description TEXT,
  estimated_value DECIMAL(10, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 10,
  commission_amount DECIMAL(10, 2),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_prospects_tenant_id ON prospects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prospects_conversion_score ON prospects(conversion_score);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_prospect_id ON leads(prospect_id);
CREATE INDEX IF NOT EXISTS idx_booked_jobs_tenant_id ON booked_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_booked_jobs_status ON booked_jobs(status);
CREATE INDEX IF NOT EXISTS idx_booked_jobs_created_at ON booked_jobs(created_at);

-- Add audit columns if not exist
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS last_scored_at TIMESTAMPTZ;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS last_score_review_count INTEGER;
ALTER TABLE booked_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create function for automatic updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for auto-updated_at
DROP TRIGGER IF EXISTS update_prospects_timestamp ON prospects;
CREATE TRIGGER update_prospects_timestamp
  BEFORE UPDATE ON prospects
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS update_booked_jobs_timestamp ON booked_jobs;
CREATE TRIGGER update_booked_jobs_timestamp
  BEFORE UPDATE ON booked_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS update_leads_timestamp ON leads;
CREATE TRIGGER update_leads_timestamp
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();
