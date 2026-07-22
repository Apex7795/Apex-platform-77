// app/api/twilio/voice/route.js
import twilio from 'twilio';
import { query, runWithTenant } from '../../../../lib/db';

export async function POST(req) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-twilio-signature');
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    const webhookUrl = `${process.env.WEBHOOK_URL}/api/twilio/voice`;

    const isValid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, webhookUrl, params);
    if (!isValid) {
      console.error('Invalid Twilio signature on /voice', { webhookUrl });
      return new Response('Invalid signature', { status: 403 });
    }

    const { CallSid, From, To } = params;

    // Goes through the lookup_tracking_number() SECURITY DEFINER function
    // (db/migrate_rls_hardening.sql), not a direct SELECT — this is a
    // cross-tenant read done before tenant_id is known, which app_user's
    // RLS grant deliberately can't do directly.
    const { rows } = await query('SELECT * FROM lookup_tracking_number($1)', [To]);
    const tenant = rows[0];

    if (!tenant) {
      console.error('No tenant found for dialed number', { To, CallSid });
      return new Response('<Response><Say>This number is no longer in service.</Say></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    await runWithTenant(tenant.tenant_id, (client) =>
      client.query(
        `INSERT INTO leads (tenant_id, source, call_sid, caller_number, status)
         VALUES ($1, 'call', $2, $3, $4) ON CONFLICT (call_sid) DO NOTHING`,
        [tenant.tenant_id, CallSid, From, 'new']
      )
    );

    return new Response(
      `<Response>
        <Say>Connecting.</Say>
        <Record action="/api/twilio/recording-complete"
                recordingStatusCallback="/api/twilio/recording-status"
                recordingStatusCallbackEvent="completed" />
        <Dial>${tenant.forwards_to}</Dial>
      </Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    );
  } catch (err) {
    console.error('Voice webhook error:', err.message);
    return new Response('<Response><Say>We are experiencing a technical issue.</Say></Response>', {
      status: 500,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
