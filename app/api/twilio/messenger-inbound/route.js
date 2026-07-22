// app/api/twilio/messenger-inbound/route.js
// Handles inbound Facebook Messenger messages via Twilio's Messenger sender.
// Point this at the Messenger sender's inbound webhook in the Twilio Console
// (Messaging > Senders > Facebook Messenger).
//
// Twilio delivers Messenger messages through the same webhook contract as
// SMS: From/To use a `messenger:<page-scoped-id>` address instead of a phone
// number, and Body carries the message text.
import twilio from 'twilio';
import { query, runWithTenant } from '../../../../lib/db';

const OPT_OUT_KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];

export async function POST(req) {
  let params;
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-twilio-signature');
    params = Object.fromEntries(new URLSearchParams(rawBody));
    const webhookUrl = `${process.env.WEBHOOK_URL}/api/twilio/messenger-inbound`;

    const isValid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, webhookUrl, params);
    if (!isValid) {
      console.error('Invalid Twilio signature on /messenger-inbound', { webhookUrl });
      return new Response('Invalid signature', { status: 403 });
    }

    const { From, Body } = params;
    const normalizedBody = (Body || '').trim().toLowerCase();

    // Same lookup strategy as sms-inbound: match against an existing lead
    // for this sender. A tenant's Facebook Page isn't mapped to a tenant_id
    // anywhere yet (there's no messenger equivalent of tracking_numbers), so
    // a Messenger contact that has never shown up as a lead through another
    // channel first won't resolve to a tenant here.
    const { rows } = await query(
      `SELECT tenant_id FROM leads WHERE caller_number = $1 ORDER BY created_at DESC LIMIT 1`,
      [From]
    );
    const tenantId = rows[0]?.tenant_id;

    if (OPT_OUT_KEYWORDS.includes(normalizedBody)) {
      if (tenantId) {
        await runWithTenant(tenantId, (client) =>
          client.query(`UPDATE leads SET sms_opt_out = true WHERE caller_number = $1 AND tenant_id = $2`, [
            From,
            tenantId,
          ])
        );
      }
      return new Response(
        `<Response><Message>You've been unsubscribed and won't receive further messages. Reply START to resubscribe.</Message></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (tenantId) {
      await runWithTenant(tenantId, (client) =>
        client.query(
          `INSERT INTO leads (tenant_id, source, caller_number, status, context_notes)
           VALUES ($1, 'messenger', $2, 'new', $3)`,
          [tenantId, From, Body || null]
        )
      );
    } else {
      console.error('No tenant match for inbound Messenger contact', { from: From });
    }

    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err) {
    console.error('Messenger inbound webhook error:', err.message, { from: params?.From });
    return new Response('Error', { status: 500 });
  }
}

// Lets you confirm the route is deployed/reachable by hitting it in a browser.
export async function GET() {
  return Response.json({
    status: 'ok',
    endpoint: '/api/twilio/messenger-inbound',
    description: 'Twilio Messenger inbound webhook',
  });
}
