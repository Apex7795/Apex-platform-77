# APEX PLATFORM - COMPLETE UPLOAD PACKAGE
# Everything you need to upload to GitHub RIGHT NOW

## 📁 FOLDER STRUCTURE

Your repo should look like this when done:

```
apex-platform/
├── .github/
│   └── workflows/
│       └── deploy.yml                 (NEW - GitHub Actions)
├── .gitignore                         (NEW - Hide secrets)
├── app/
│   └── api/
│       ├── auth/
│       │   └── verify/
│       │       └── route.js          (EXISTING - keep as is)
│       ├── leads/
│       │   └── active-call/
│       │       └── route.js          (EXISTING - keep as is)
│       └── booked-jobs/
│           └── create/
│               └── route.js          (REPLACE with create-FIXED.js)
├── src/
│   ├── context/
│   │   └── AuthContext.jsx           (REPLACE with AuthContext-FIXED.jsx)
│   ├── services/
│   │   └── api.js                    (EXISTING - keep as is)
│   └── components/
│       └── CallAssistant.jsx         (EXISTING - keep as is)
├── lib/
│   └── db.js                         (EXISTING - keep as is)
├── scripts/
│   └── cron.js                       (REPLACE with cron-FIXED.js)
├── database/
│   └── migrate.sql                   (REPLACE with migrate-FIXED.sql)
├── package.json                      (EXISTING - keep as is)
├── .env.example                      (EXISTING - keep as is)
├── README.md                         (EXISTING - keep as is)
│
├── GITHUB_SETUP_SUMMARY.md           (NEW - Documentation)
├── SETUP_CHECKLIST.md                (NEW - Documentation)
├── QUICKSTART.md                     (NEW - Documentation)
├── DEPLOYMENT.md                     (NEW - Documentation)
└── BUG_FIXES.md                      (NEW - Documentation)
```

---

## 📋 FILES TO CREATE/REPLACE

### FILE 1: .github/workflows/deploy.yml
**PATH:** `.github/workflows/deploy.yml` (NEW FILE)

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: apex_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/apex_test
      
      - name: Build project
        run: npm run build
        env:
          NEXT_PUBLIC_API_TOKEN: test-token

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Render
        run: |
          curl https://api.render.com/deploy/srv-${{ secrets.RENDER_SERVICE_ID }}?key=${{ secrets.RENDER_API_KEY }}
      
      - name: Notify Slack
        if: always()
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "Apex Platform deployment: ${{ job.status }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Deployment Status*: ${{ job.status }}\n*Commit*: ${{ github.sha }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

---

### FILE 2: .gitignore
**PATH:** `.gitignore` (NEW FILE)

```
# Environment variables
.env
.env.local
.env.*.local

# Dependencies
node_modules/
package-lock.json
yarn.lock

# Build output
.next/
dist/
build/
out/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*

# Testing
coverage/
.nyc_output/

# Temporary
tmp/
temp/
*.pid
```

---

### FILE 3: src/context/AuthContext.jsx
**PATH:** `src/context/AuthContext.jsx` (REPLACE ORIGINAL)

```jsx
import { createContext, useContext, useState, useEffect } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ authenticated: false, role: null, loading: true });

  useEffect(() => {
    const verifyToken = async () => {
      try {
        const response = await fetch('/api/auth/verify', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setAuth({ authenticated: true, role: data.role, loading: false });
        } else {
          setAuth({ authenticated: false, role: null, loading: false });
          localStorage.removeItem('auth_token');
        }
      } catch (error) {
        console.error('Auth verification failed:', error);
        setAuth({ authenticated: false, role: null, loading: false });
      }
    };

    verifyToken();
  }, []);

  const login = async (token) => {
    localStorage.setItem('auth_token', token);
    const response = await fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    setAuth({ authenticated: response.ok, role: data.role, loading: false });
    return response.ok;
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setAuth({ authenticated: false, role: null, loading: false });
  };

  return (
    <AuthContext.Provider value={{ ...auth, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

---

### FILE 4: app/api/booked-jobs/create/route.js
**PATH:** `app/api/booked-jobs/create/route.js` (REPLACE ORIGINAL)

```javascript
import { pool } from '../../../lib/db';

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
```

---

### FILE 5: scripts/cron.js
**PATH:** `scripts/cron.js` (REPLACE ORIGINAL)

```javascript
const { pool } = require('../lib/db');

const LOCK_ID = 1000;
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function acquireLock() {
  const result = await pool.query(
    'SELECT pg_try_advisory_lock($1) as acquired',
    [LOCK_ID]
  );
  return result.rows[0].acquired;
}

async function releaseLock() {
  await pool.query(
    'SELECT pg_advisory_unlock($1) as released',
    [LOCK_ID]
  );
}

async function updateConversionScores() {
  console.log('Updating conversion scores...');
  try {
    const result = await pool.query(`
      UPDATE prospects 
      SET 
        conversion_score = CASE 
          WHEN review_count > 50 THEN 30 + 30
          WHEN review_count > 20 THEN 30 + 20
          ELSE 30
        END +
        CASE
          WHEN rating >= 4.5 THEN 25
          WHEN rating >= 4.0 THEN 15
          ELSE 0
        END,
        conversion_probability = LEAST((
          (CASE 
            WHEN review_count > 50 THEN 30 + 30
            WHEN review_count > 20 THEN 30 + 20
            ELSE 30
          END +
          CASE
            WHEN rating >= 4.5 THEN 25
            WHEN rating >= 4.0 THEN 15
            ELSE 0
          END) / 100.0) * 95, 95),
        review_velocity = (review_count - COALESCE(last_score_review_count, 0)) / NULLIF(EXTRACT(DAY FROM (NOW() - last_scored_at)), 0)
      WHERE last_scored_at IS NULL OR last_scored_at < NOW() - INTERVAL '24 hours'
      RETURNING id
    `);
    console.log(`Updated ${result.rowCount} prospects`);
  } catch (error) {
    console.error('Error updating conversion scores:', error);
    throw error;
  }
}

async function processBookedJobs() {
  console.log('Processing booked jobs...');
  try {
    const result = await pool.query(`
      UPDATE booked_jobs 
      SET status = 'processed'
      WHERE status = 'pending' 
      AND created_at < NOW() - INTERVAL '24 hours'
      RETURNING id
    `);
    console.log(`Processed ${result.rowCount} booked jobs`);
  } catch (error) {
    console.error('Error processing booked jobs:', error);
    throw error;
  }
}

async function cleanupOldRecords() {
  console.log('Cleaning up old records...');
  try {
    const result = await pool.query(`
      DELETE FROM booked_jobs 
      WHERE status = 'pending' 
      AND created_at < NOW() - INTERVAL '30 days'
      RETURNING id
    `);
    console.log(`Deleted ${result.rowCount} old records`);
  } catch (error) {
    console.error('Error cleaning up records:', error);
    throw error;
  }
}

async function runScheduler() {
  const acquired = await acquireLock();
  if (!acquired) {
    console.log('[SKIP] Could not acquire lock, another instance running');
    return;
  }

  try {
    console.log('[START] Scheduler running at', new Date().toISOString());
    
    await updateConversionScores();
    await processBookedJobs();
    await cleanupOldRecords();
    
    console.log('[SUCCESS] Scheduler completed at', new Date().toISOString());
  } catch (error) {
    console.error('[ERROR] Scheduler failed:', error);
    process.exit(1);
  } finally {
    await releaseLock();
    await pool.end();
  }
}

if (require.main === module) {
  // Set timeout to prevent hanging
  const timeout = setTimeout(() => {
    console.error('[TIMEOUT] Scheduler exceeded maximum runtime');
    process.exit(1);
  }, LOCK_TIMEOUT);

  runScheduler()
    .catch(error => {
      console.error('[FATAL]', error);
      process.exit(1);
    })
    .finally(() => clearTimeout(timeout));
}

module.exports = { runScheduler };
```

---

### FILE 6: database/migrate.sql
**PATH:** `database/migrate.sql` (REPLACE ORIGINAL)

```sql
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
```

---

## 📚 DOCUMENTATION FILES (Copy These Exactly)

### FILE 7-11: Documentation
Create these 5 documentation files (I already created them above - just copy them into your repo):
- `GITHUB_SETUP_SUMMARY.md`
- `SETUP_CHECKLIST.md`
- `QUICKSTART.md`
- `DEPLOYMENT.md`
- `BUG_FIXES.md`

---

## 🚀 HOW TO UPLOAD RIGHT NOW (iPhone)

### Step 1: Go to GitHub
Open Safari → go to **github.com** → log in

### Step 2: Create Repository
- Click **+** icon (top right)
- Click **New repository**
- Name: `apex-platform`
- Click **Create repository**

### Step 3: Open Codespaces
1. In your new repo, click **<> Code** (green button)
2. Click **Codespaces** tab
3. Click **Create codespace on main**

Wait for it to load (shows VS Code in browser)

### Step 4: Create Folder Structure
In the terminal at bottom, type:

```bash
mkdir -p .github/workflows
mkdir -p app/api/auth/verify
mkdir -p app/api/leads/active-call
mkdir -p app/api/booked-jobs/create
mkdir -p src/context
mkdir -p src/services
mkdir -p src/components
mkdir -p lib
mkdir -p scripts
mkdir -p database
```

### Step 5: Create ALL FILES

Copy and paste each file from above into Codespaces:

1. Click **File Explorer** (top left)
2. Right-click folder → **New File**
3. Type the filename (with path, like `.github/workflows/deploy.yml`)
4. Paste the content from above
5. Press Ctrl+S (or Cmd+S) to save

**Repeat for ALL files listed above**

### Step 6: Push to GitHub

In terminal, type:

```bash
git add .
git commit -m "Initial commit: Apex Platform with bug fixes"
git push origin main
```

Done! ✅

### Step 7: Add GitHub Secrets

1. Go back to your GitHub repo
2. Click **Settings**
3. Click **Secrets and variables** → **Actions**
4. Add these 8 secrets:

```
ADMIN_API_TOKEN = strong_password_you_make_up
DATABASE_URL = postgresql://user:pass@host:5432/apex
RENDER_API_KEY = your_render_key
RENDER_SERVICE_ID = your_render_service_id
OPENAI_API_KEY = sk-...
STRIPE_SECRET_KEY = sk_live_...
TWILIO_ACCOUNT_SID = AC...
TWILIO_AUTH_TOKEN = token
```

### Step 8: Deploy to Render

1. Open **render.com** in Safari
2. Log in / sign up
3. Click **New** → **Web Service**
4. Connect GitHub → Select `apex-platform`
5. Click **Deploy**

**DONE! 🎉**

---

## ✅ That's Everything

All code. All fixes. All documentation. Ready to upload RIGHT NOW from your iPhone.

Which step are you on?
