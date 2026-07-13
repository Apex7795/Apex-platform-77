// services/prospectOutreach.js
// Generates a short, personalized outreach email for a discovered prospect
// and sends it via Postmark. Email-only by design — see README for the
// reasoning on why SMS is deliberately excluded from cold outreach.
const OpenAI = require('openai');
const postmark = require('postmark');
const { pool } = require('../lib/db');
const { generateOptOutToken, generateReplyToken } = require('../lib/prospectOptOutTokens');

let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
let _postmarkClient;
function getPostmarkClient() {
  if (!_postmarkClient) _postmarkClient = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
  return _postmarkClient;
}

const OUTREACH_SYSTEM_PROMPT = `You are writing a brief, professional cold outreach
email from Apex Junk Solutions to the owner of a local junk removal business.
Apex offers a lead-generation platform: tracked phone numbers, automatic call
recording, missed-call SMS recovery, and an AI-generated daily activity digest.
Write ONLY the email body (no subject line, no greeting placeholder brackets).
Keep it under 120 words. No hype, no emojis, no exclamation points. One clear
call to action: reply to this email or book a 10-minute call. Do not invent
specific pricing, guarantees, or client names.`;

async function generateEmailBody({ businessName, city, openingContext }) {
  const userPrompt = openingContext
    ? `Business name: ${businessName}\nCity: ${city || 'their local area'}\n` +
      `Use this as inspiration for your opening line (rephrase in your own words, ` +
      `don't quote it verbatim, and don't state anything it doesn't support): ${openingContext}`
    : `Business name: ${businessName}\nCity: ${city || 'their local area'}`;

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: OUTREACH_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: 200,
  });

  return completion.choices[0].message.content.trim();
}

// --- Send outreach to a single prospect, respecting opt-out status ---
// `openingContext` is optional — pass a pre-generated icebreaker (from
// services/aiPersonalization.js) to give the email a more specific
// opening line. All compliance behavior (opt-out check, unsubscribe link,
// reply link, outreach log) applies identically whether or not it's set —
// callers should always go through this function rather than calling
// sendViaEmailProvider directly, or they lose all of that.
async function sendOutreachEmail(prospectId, { openingContext } = {}) {
  const { rows } = await pool.query(
    `SELECT id, business_name, city, email, opted_out, status
     FROM prospects WHERE id = $1`,
    [prospectId]
  );
  const prospect = rows[0];

  if (!prospect) throw new Error('Prospect not found');
  if (prospect.opted_out) throw new Error('Prospect has opted out — cannot contact');
  if (!prospect.email) throw new Error('Prospect has no enriched email on file');

  const body = await generateEmailBody({
    businessName: prospect.business_name,
    city: prospect.city,
    openingContext,
  });

  const optOutToken = generateOptOutToken(prospect.id);
  const optOutLink = `${process.env.APP_URL}/api/prospects/opt-out?token=${optOutToken}`;

  // Clicking this is the prospect's own affirmative action, which is what
  // lets us follow up by text afterward — the same "they reached out"
  // logic that already applies to inbound callers in the leads table.
  const replyToken = generateReplyToken(prospect.id);
  const replyLink = `${process.env.APP_URL}/api/prospects/reply?token=${replyToken}`;

  const fullBody =
    `${body}\n\n` +
    `Interested? Click here and we'll follow up right away: ${replyLink}\n\n` +
    `---\nDon't want to hear from us again? Click here: ${optOutLink}`;
  const subject = `Quick question for ${prospect.business_name}`;

  await sendViaEmailProvider({ to: prospect.email, subject, body: fullBody, optOutLink });

  await pool.query(
    `UPDATE prospects
     SET status = 'contacted', last_contacted_at = now(),
         contact_attempts = contact_attempts + 1, updated_at = now()
     WHERE id = $1`,
    [prospect.id]
  );

  await pool.query(
    `INSERT INTO prospect_outreach_log (prospect_id, channel, subject, body)
     VALUES ($1, 'email', $2, $3)`,
    [prospect.id, subject, fullBody]
  );

  return { sent: true, to: prospect.email };
}

// --- Sends via Postmark's transactional/broadcast API ---
// Requires POSTMARK_SERVER_TOKEN and OUTREACH_FROM_EMAIL in env. The
// From address must be a Sender Signature (or domain) verified in your
// Postmark account, or sends will fail with a 401/422.
async function sendViaEmailProvider({ to, subject, body, optOutLink }) {
  if (!process.env.POSTMARK_SERVER_TOKEN) {
    throw new Error('POSTMARK_SERVER_TOKEN is not set — cannot send outreach email');
  }
  if (!process.env.OUTREACH_FROM_EMAIL) {
    throw new Error('OUTREACH_FROM_EMAIL is not set — cannot send outreach email');
  }

  await getPostmarkClient().sendEmail({
    From: process.env.OUTREACH_FROM_EMAIL,
    To: to,
    Subject: subject,
    TextBody: body,
    MessageStream: 'outbound',
    // List-Unsubscribe is a mail-client-level unsubscribe (shows up next to
    // Gmail/Outlook's own "Unsubscribe" button), separate from the in-body
    // opt-out link. Belt-and-suspenders for CAN-SPAM compliance and it also
    // helps deliverability/reputation with mailbox providers.
    Headers: optOutLink
      ? [{ Name: 'List-Unsubscribe', Value: `<${optOutLink}>` }]
      : undefined,
  });
}

module.exports = { sendOutreachEmail, generateEmailBody };
