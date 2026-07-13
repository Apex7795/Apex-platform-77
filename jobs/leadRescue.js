// jobs/leadRescue.js
// Run on a schedule (e.g. every 5-10 minutes via cron or n8n).
// Sends the immediate "sorry we missed you" SMS, then a personalized
// follow-up 2 hours later if there's still no reply.
const twilio = require('twilio');
const OpenAI = require('openai');
const { pool, runWithTenant } = require('../lib/db');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const IMMEDIATE_MESSAGE =
  "Hey, sorry we missed your call! Did you still need that junk removal " +
  'estimate? Text me a photo of the area and I can give you a rough quote right now.';

const FOLLOWUP_SYSTEM_PROMPT = `You are a polite, professional junk removal dispatcher
texting a potential customer who called but hasn't replied to a first follow-up.
Write ONE short SMS (under 300 characters) that is friendly, low-pressure, and specific
to any context provided. Do not use emojis. Do not sound like a bot. If no specific
context is given, keep it general but warm. Respond with ONLY the message text, nothing else.`;

// --- Find leads that need action ---
// Uses the unrestricted pool directly since this scans across all tenants;
// each individual SMS send/update still goes through runWithTenant.
async function findLeadsNeedingRescue() {
  const { rows } = await pool.query(`
    SELECT id, tenant_id, caller_number, status, rescue_stage, context_notes, last_touched_at
    FROM leads
    WHERE status IN ('new', 'no_answer')
      AND sms_opt_out = false
      AND (
        (rescue_stage = 0 AND last_touched_at < now() - interval '5 minutes')
        OR
        (rescue_stage = 1 AND last_touched_at < now() - interval '2 hours')
      )
    LIMIT 100
  `);
  return rows;
}

// FIXED: was sending SMS `from: tenant.owner_phone` — the business owner's
// own personal number, which Apex does not control. Twilio requires the
// `from` number to be one you've provisioned/verified on your own account,
// so every send would have failed against Twilio's API in production. This
// now looks up the tenant's actual provisioned tracking number instead.
// If a tenant somehow has no active tracking number (shouldn't happen post
// onboarding, but data can drift), this fails loud in the log rather than
// silently attempting a send that Twilio would reject anyway.
async function getTenantFromNumber(tenantId) {
  const { rows } = await pool.query(
    `SELECT phone_number FROM tracking_numbers WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
    [tenantId]
  );
  return rows[0]?.phone_number || null;
}

async function sendImmediateRescue(lead) {
  const fromNumber = await getTenantFromNumber(lead.tenant_id);
  if (!fromNumber) {
    console.error('No active tracking number for tenant — skipping rescue SMS', { tenantId: lead.tenant_id, leadId: lead.id });
    return;
  }

  await twilioClient.messages.create({
    body: IMMEDIATE_MESSAGE,
    to: lead.caller_number,
    from: fromNumber,
  });

  await runWithTenant(lead.tenant_id, (client) =>
    client.query(`UPDATE leads SET rescue_stage = 1, last_touched_at = now() WHERE id = $1`, [lead.id])
  );
}

async function sendPersonalizedFollowup(lead) {
  const userPrompt = lead.context_notes
    ? `Context from the original call: ${lead.context_notes}`
    : 'No specific context available — keep the message general.';

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: FOLLOWUP_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: 120,
  });

  const message = completion.choices[0].message.content.trim();

  const fromNumber = await getTenantFromNumber(lead.tenant_id);
  if (!fromNumber) {
    console.error('No active tracking number for tenant — skipping rescue SMS', { tenantId: lead.tenant_id, leadId: lead.id });
    return;
  }

  await twilioClient.messages.create({
    body: message,
    to: lead.caller_number,
    from: fromNumber,
  });

  await runWithTenant(lead.tenant_id, (client) =>
    client.query(`UPDATE leads SET rescue_stage = 2, last_touched_at = now() WHERE id = $1`, [lead.id])
  );
}

async function runLeadRescueJob() {
  const leads = await findLeadsNeedingRescue();
  console.log(`Lead rescue job: processing ${leads.length} leads`);

  for (const lead of leads) {
    try {
      if (lead.rescue_stage === 0) {
        await sendImmediateRescue(lead);
      } else if (lead.rescue_stage === 1) {
        await sendPersonalizedFollowup(lead);
      }
    } catch (err) {
      // One bad lead shouldn't stop the batch
      console.error('Lead rescue failed for lead', lead.id, err.message);
    }
  }
}

module.exports = { runLeadRescueJob };

// --- Scheduling (e.g. with node-cron) ---
// const cron = require('node-cron');
// cron.schedule('*/5 * * * *', runLeadRescueJob);
//
// Or trigger this same function from an n8n Schedule Trigger node hitting
// a dedicated /api/jobs/lead-rescue endpoint that calls runLeadRescueJob().
