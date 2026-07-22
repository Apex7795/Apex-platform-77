// app/api/twilio/sms-inbound/route.js
// Handles inbound SMS replies, including STOP/opt-out keywords.
// Point this at your Twilio Messaging Service's inbound webhook.
import twilio from 'twilio';
import { query, runWithTenant } from '../../../../lib/db';

const OPT_OUT_KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];

export async function POST(req) {
  let params;
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-twilio-signature');
    params = Object.fromEntries(new URLSearchParams(rawBody));
    const webhookUrl = `${process.env.WEBHOOK_URL}/api/twilio/sms-inbound`;

    const isValid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, webhookUrl, params);
    if (!isValid) {
      console.error('Invalid Twilio signature on /sms-inbound', { webhookUrl });
      return new Response('Invalid signature', { status: 403 });
    }

    const { From, Body } = params;
    const normalizedBody = (Body || '').trim().toLowerCase();

    // Find which tenant this number belongs to via their caller history.
    // Goes through the lookup_tenant_by_caller() SECURITY DEFINER function
    // (db/migrate_rls_hardening.sql), not a direct SELECT — this is a
    // cross-tenant read done before tenant_id is known, which app_user's
    // RLS grant deliberately can't do directly.
    const { rows } = await query(`SELECT lookup_tenant_by_caller($1) AS tenant_id`, [From]);
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
      // Twilio's Advanced Opt-Out (if enabled on the Messaging Service) handles
      // the carrier-level block automatically; this just keeps our own DB in sync.
      return new Response(
        `<Response><Message>You've been unsubscribed and won't receive further messages. Reply START to resubscribe.</Message></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Not an opt-out keyword — just acknowledge receipt, no auto-reply needed.
    // (Real conversation handling/routing to the business owner is a separate concern.)
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err) {
    console.error('SMS inbound webhook error:', err.message, { from: params?.From });
    return new Response('Error', { status: 500 });
  }
}
