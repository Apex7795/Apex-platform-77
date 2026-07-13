// jobs/dailyDigest.js
// Run once daily (e.g. 8:00 AM per tenant's local time, or a fixed time to start).
// Sends each tenant owner a short summary of leads needing attention and any
// ad campaign cost concerns.
const twilio = require('twilio');
const OpenAI = require('openai');
const { pool, runWithTenant } = require('../lib/db');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const DIGEST_SYSTEM_PROMPT = `You are summarizing daily business data for a junk removal
company owner. Write a 2-3 sentence SMS-length summary that is direct, useful, and
actionable. No greetings, no sign-off, no emojis. If nothing needs attention, say so briefly.`;

const COST_PER_LEAD_THRESHOLD_CENTS = 5000; // $50

// --- Gather each tenant's data for the digest ---
async function getTenantDigestData(tenantId) {
  const staleLeads = await pool.query(
    `SELECT COUNT(*) FROM leads
     WHERE tenant_id = $1 AND status IN ('new', 'no_answer', 'contacted')
       AND last_touched_at < now() - interval '24 hours'`,
    [tenantId]
  );

  const campaigns = await pool.query(
    `SELECT platform, daily_budget_cents,
            (SELECT COUNT(*) FROM leads
             WHERE leads.tenant_id = ad_campaigns.tenant_id
               AND leads.created_at > now() - interval '7 days') AS leads_last_7d
     FROM ad_campaigns
     WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );

  const expensiveCampaigns = campaigns.rows.filter((c) => {
    const weeklySpendCents = c.daily_budget_cents * 7;
    const costPerLead = c.leads_last_7d > 0 ? weeklySpendCents / c.leads_last_7d : Infinity;
    return costPerLead > COST_PER_LEAD_THRESHOLD_CENTS;
  });

  return {
    staleLeadCount: parseInt(staleLeads.rows[0].count, 10),
    expensiveCampaigns,
  };
}

async function generateDigestMessage(data) {
  if (data.staleLeadCount === 0 && data.expensiveCampaigns.length === 0) {
    return 'No stale leads and ad spend looks healthy today. Nothing needs your attention.';
  }

  const userPrompt = `Stale leads (untouched 24+ hours): ${data.staleLeadCount}
Campaigns with cost-per-lead above $50: ${data.expensiveCampaigns.map((c) => c.platform).join(', ') || 'none'}`;

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: DIGEST_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 150,
  });

  return completion.choices[0].message.content.trim();
}

async function runDailyDigestJob() {
  const { rows: tenants } = await pool.query(
    `SELECT id, owner_phone, business_name FROM tenants WHERE subscription_status = 'active'`
  );

  console.log(`Daily digest job: processing ${tenants.length} tenants`);

  for (const tenant of tenants) {
    try {
      const data = await getTenantDigestData(tenant.id);
      const message = await generateDigestMessage(data);

      await twilioClient.messages.create({
        body: `${tenant.business_name} daily update: ${message}`,
        to: tenant.owner_phone,
        from: process.env.PLATFORM_NOTIFICATION_NUMBER,
      });
    } catch (err) {
      console.error('Daily digest failed for tenant', tenant.id, err.message);
    }
  }
}

module.exports = { runDailyDigestJob };

// --- Scheduling ---
// const cron = require('node-cron');
// cron.schedule('0 8 * * *', runDailyDigestJob); // 8:00 AM server time
//
// For per-tenant local time, store a timezone column on tenants and run
// this hourly, filtering to tenants whose local time is currently 8 AM.
