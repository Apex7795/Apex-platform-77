// app/api/prospects/opt-out/route.js
// GET /api/prospects/opt-out?token=...  -> the unsubscribe link in outreach emails.
// No login required, same one-click pattern as the campaign action links,
// but scoped to a single signed purpose so it can only ever opt someone out.
import { pool } from '../../../../lib/db';
import { verifyOptOutToken } from '../../../../lib/prospectOptOutTokens';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  const payload = verifyOptOutToken(token);
  if (!payload) return htmlResponse('This link is invalid or has expired.', 403);

  try {
    await pool.query(
      `UPDATE prospects
       SET opted_out = true, opted_out_at = now(), status = 'opted_out', updated_at = now()
       WHERE id = $1`,
      [payload.prospectId]
    );

    return htmlResponse("You've been removed from our list and won't be contacted again.", 200);
  } catch (err) {
    console.error('Prospect opt-out error:', err.message, { prospectId: payload.prospectId });
    return htmlResponse('Something went wrong processing your request. Please email us directly to opt out.', 500);
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
