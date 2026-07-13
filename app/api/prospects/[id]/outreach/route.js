// app/api/prospects/[id]/outreach/route.js
// POST /api/prospects/:id/outreach  -> the "One-Click Outreach" button's target.
// Deliberately email-only; see README for why SMS is excluded from cold outreach.
import { sendOutreachEmail } from '../../../../../services/prospectOutreach';
import { requireAdminAuth } from '../../../../../lib/adminAuth';

export async function POST(req, { params }) {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  const { id } = params;

  try {
    const result = await sendOutreachEmail(id);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Prospect outreach error:', err.message, { id });
    // Distinguish "blocked by opt-out/missing email" from a hard failure so
    // the dashboard can show a useful message instead of a generic error.
    const clientErrors = ['opted out', 'no enriched email', 'not found'];
    const isClientError = clientErrors.some((s) => err.message.toLowerCase().includes(s));
    return new Response(JSON.stringify({ error: err.message }), {
      status: isClientError ? 400 : 500,
    });
  }
}
