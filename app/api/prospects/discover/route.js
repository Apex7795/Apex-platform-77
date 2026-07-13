// app/api/prospects/discover/route.js
// POST /api/prospects/discover  { "city": "Sacramento, CA", "query": "junk removal" }
// Runs a single-city discovery pass on demand — this is the "test one city
// first" step before scheduling the job to run nationwide.
import { discoverCity, enrichPendingProspects } from '../../../../jobs/prospectDiscovery';
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

  const { city, query } = body;
  if (!city) {
    return new Response(JSON.stringify({ error: 'city is required' }), { status: 400 });
  }

  try {
    const discoveryResult = await discoverCity({ city, query });
    const enrichmentResult = await enrichPendingProspects();

    return new Response(
      JSON.stringify({ discovery: discoveryResult, enrichment: enrichmentResult }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('On-demand discovery error:', err.message, { city });
    return new Response(JSON.stringify({ error: 'Discovery run failed', detail: err.message }), {
      status: 500,
    });
  }
}
