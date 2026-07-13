// app/api/action/launch-campaign/route.js
import { pool, runWithTenant } from '../../../../lib/db';
import { verifyActionToken } from '../../../../lib/actionTokens';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const category = searchParams.get('category');

  const payload = verifyActionToken(token, { expectedAction: 'launch_campaign' });
  if (!payload) return htmlResponse('Invalid or expired link.', 403);

  try {
    const template = await pool.query(
      'SELECT headline, body FROM campaign_templates WHERE category = $1 LIMIT 1',
      [category]
    );
    if (template.rowCount === 0) return htmlResponse('Template not found.', 404);

    // Idempotency guard: don't launch a duplicate active campaign for the
    // same category if the tenant clicks the link twice.
    const existing = await runWithTenant(payload.tenantId, (client) =>
      client.query(
        `SELECT id FROM ad_campaigns WHERE tenant_id = $1 AND category = $2 AND status = 'active'`,
        [payload.tenantId, category]
      )
    );
    if (existing.rowCount > 0) {
      return htmlResponse(`A campaign for ${category} is already active.`, 200);
    }

    const campaign = await runWithTenant(payload.tenantId, (client) =>
      client.query(
        `INSERT INTO ad_campaigns (tenant_id, platform, category, status, daily_budget_cents)
         VALUES ($1, 'google', $2, 'active', 5000)
         RETURNING id`,
        [payload.tenantId, category]
      )
    );

    await runWithTenant(payload.tenantId, (client) =>
      client.query(
        `INSERT INTO audit_logs (tenant_id, action_type, resource_id, metadata)
         VALUES ($1, 'launch_campaign', $2, $3)`,
        [payload.tenantId, campaign.rows[0].id, JSON.stringify({ category })]
      )
    );

    // NOTE: trigger the actual Google/Meta Ads API call here using
    // template.rows[0].headline / .body once ad platform integration is live.

    return htmlResponse(`Campaign for ${category} launched successfully!`, 200);
  } catch (err) {
    console.error('Launch campaign error:', err.message, { category, tenantId: payload.tenantId });
    return htmlResponse('Launch failed. Please try from your dashboard.', 500);
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
