// app/api/prospects/enrich-and-outreach/route.js
// POST /api/prospects/enrich-and-outreach  { "domain": "...", "companyName": "..." }
//
// Converted from an Express-style (req, res) controller to this project's
// Next.js App Router convention to match every other route in the tree.
//
// Two correctness fixes from the original version of this flow:
// 1. The prospect INSERT now includes `source` (NOT NULL in the schema)
//    and upserts on the new unique `domain` index instead of blindly
//    inserting a duplicate row every time the same domain is submitted.
// 2. Outreach now goes through services/prospectOutreach.js's
//    sendOutreachEmail() instead of calling sendViaEmailProvider()
//    directly — that's what applies the opt-out check, unsubscribe link,
//    reply-conversion link, and outreach log write. Calling the email
//    provider directly, as the original version did, sends outreach email
//    with no unsubscribe mechanism and no compliance logging.
import { pool } from '../../../../lib/db';
import { enrichDomain } from '../../../../services/waterfallEnrichment';
import { generateIcebreaker } from '../../../../services/aiPersonalization';
import { sendOutreachEmail } from '../../../../services/prospectOutreach';
import { requireAdminAuth } from '../../../../lib/adminAuth';

export async function POST(req) {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { domain, companyName } = body;
  if (!domain || !companyName) {
    return new Response(JSON.stringify({ error: 'domain and companyName are required' }), { status: 400 });
  }
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

  try {
    // 1. Run waterfall enrichment
    const enrichedData = await enrichDomain(cleanDomain, companyName);

    if (enrichedData.emails.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No contact data found across enrichment waterfall.' }),
        { status: 404 }
      );
    }
    const primaryEmail = enrichedData.emails[0];

    // 2. Generate AI icebreaker (degrades gracefully if firmographics/
    // intentSignals are null — see services/aiPersonalization.js)
    const icebreaker = await generateIcebreaker(
      companyName,
      enrichedData.firmographics?.industry || 'B2B',
      enrichedData.intentSignals
    );

    // 3. Upsert the prospect (source = 'manual_api' distinguishes this
    // entry point from 'google_places' discovery). ON CONFLICT (domain)
    // means re-submitting the same domain refreshes it instead of
    // creating a duplicate row.
    const { rows } = await pool.query(
      `INSERT INTO prospects
         (business_name, domain, email, emails, firmographics, intent_signals,
          status, source, last_enriched_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'outreach_pending', 'manual_api', NOW())
       ON CONFLICT (domain) DO UPDATE SET
         business_name = EXCLUDED.business_name,
         email = COALESCE(prospects.email, EXCLUDED.email),
         emails = EXCLUDED.emails,
         firmographics = EXCLUDED.firmographics,
         intent_signals = EXCLUDED.intent_signals,
         last_enriched_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        companyName,
        cleanDomain,
        primaryEmail,
        JSON.stringify(enrichedData.emails),
        enrichedData.firmographics ? JSON.stringify(enrichedData.firmographics) : null,
        enrichedData.intentSignals ? JSON.stringify(enrichedData.intentSignals) : null,
      ]
    );
    const prospect = rows[0];

    if (prospect.opted_out) {
      // Enrichment/upsert still happened (data stays fresh), but do not
      // contact someone who already opted out.
      return new Response(
        JSON.stringify({ message: 'Prospect enriched but previously opted out — no email sent.', data: { prospect } }),
        { status: 200 }
      );
    }

    // 4. Send via the existing compliant outreach pipeline
    const sendResult = await sendOutreachEmail(prospect.id, { openingContext: icebreaker });

    return new Response(
      JSON.stringify({
        message: 'Prospect enriched and outreach sent.',
        data: { prospect, ai_icebreaker_used: icebreaker, sendResult },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('enrich-and-outreach error:', err.message, { domain: cleanDomain });
    return new Response(JSON.stringify({ error: 'Failed to process prospect pipeline.' }), { status: 500 });
  }
}
