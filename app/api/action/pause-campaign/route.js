// app/api/action/pause-campaign/route.js
import { pool, runWithTenant } from '../../../../lib/db';
import { verifyActionToken } from '../../../../lib/actionTokens';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const campaignId = searchParams.get('id');

  if (!token || !campaignId) {
    return htmlResponse('Missing token or campaign ID.', 400);
  }

  const payload = verifyActionToken(token, {
    expectedAction: 'pause_campaign',
    expectedResourceId: campaignId,
  });
  if (!payload) {
    return htmlResponse('This link is invalid or has expired. Please log in to your dashboard instead.', 403);
  }

  try {
    const result = await runWithTenant(payload.tenantId, (client) =>
      client.query(
        `UPDATE ad_campaigns SET status = 'paused'
         WHERE id = $1 AND tenant_id = $2
         RETURNING id`,
        [campaignId, payload.tenantId]
      )
    );

    if (result.rowCount === 0) {
      // RLS scoping means this also silently blocks any cross-tenant attempt
      return htmlResponse('Campaign not found.', 404);
    }

    return htmlResponse('Campaign paused successfully.', 200);
  } catch (err) {
    console.error('Pause campaign action error:', err.message, { campaignId });
    return htmlResponse('Something went wrong. Please try again from your dashboard.', 500);
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

// --- Generating the link for the SMS digest ---
// import { generateActionToken } from '../../../../lib/actionTokens';
//
// const token = generateActionToken({
//   tenantId: tenant.id,
//   action: 'pause_campaign',
//   resourceId: campaign.id,
//   ttlSeconds: 60 * 60 * 24, // link valid for 24 hours
// });
//
// const link = `${process.env.APP_URL}/api/action/pause-campaign?token=${token}&id=${campaign.id}`;
