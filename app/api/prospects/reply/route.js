// app/api/prospects/reply/route.js
// GET /api/prospects/reply?token=...  -> the "Interested?" link in outreach emails.
//
// FIXED from the original: the leads INSERT now goes through runWithTenant
// instead of a bare pool.query(). The `leads` RLS policy checks
// current_setting('app.current_tenant_id'), and a raw pool.query() never
// sets that — so this previously would have thrown "unrecognized
// configuration parameter" on every single reply-link click, not just
// silently failed. runWithTenant sets it via SET LOCAL inside the same
// transaction as the insert.
import { pool, runWithTenant } from '../../../../lib/db';
import { verifyReplyToken } from '../../../../lib/prospectOptOutTokens';

const HOUSE_TENANT_ID = process.env.PROSPECTING_HOUSE_TENANT_ID;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  const payload = verifyReplyToken(token);
  if (!payload) return htmlResponse('This link is invalid or has expired.', 403);

  if (!HOUSE_TENANT_ID) {
    console.error('PROSPECTING_HOUSE_TENANT_ID is not set — cannot convert prospect to lead');
    return htmlResponse('Thanks — we got your interest and will follow up shortly.', 200);
  }

  try {
    // prospects has no RLS (by design), so this lookup can stay on the
    // plain pool.
    const { rows } = await pool.query(
      `SELECT id, business_name, phone, email, opted_out FROM prospects WHERE id = $1`,
      [payload.prospectId]
    );
    const prospect = rows[0];
    if (!prospect) return htmlResponse('We could not find your request. Please email us directly.', 404);
    if (prospect.opted_out) return htmlResponse('This contact previously opted out.', 200);

    await pool.query(
      `UPDATE prospects SET status = 'replied', updated_at = now() WHERE id = $1`,
      [prospect.id]
    );

    if (prospect.phone) {
      await runWithTenant(HOUSE_TENANT_ID, (client) =>
        client.query(
          `INSERT INTO leads (tenant_id, source, caller_number, status, context_notes)
           VALUES ($1, 'prospect_reply', $2, 'new', $3)
           ON CONFLICT DO NOTHING`,
          [HOUSE_TENANT_ID, prospect.phone, `Replied to prospecting outreach: ${prospect.business_name}`]
        )
      );
    }

    return htmlResponse("Thanks for your interest! We'll be in touch shortly.", 200);
  } catch (err) {
    console.error('Prospect reply-link error:', err.message, { prospectId: payload.prospectId });
    return htmlResponse('Something went wrong, but we got your interest — we will follow up.', 500);
  }
}

function htmlResponse(message, status) {
  return new Response(
    `<!DOCTYPE html><html><body style="font-family: sans-serif; text-align: center; padding: 60px 20px;">
      <h1>${message}</h1>
    </body></html>`,
    { status, headers: { 'Content-Type': 'text/html' } }
  );
}
