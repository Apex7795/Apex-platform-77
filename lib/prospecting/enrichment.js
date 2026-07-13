// lib/prospecting/enrichment.js
// Given a business website, attempts to find a contact email via Hunter.io's
// Domain Search endpoint. Requires HUNTER_API_KEY in env.

function extractDomain(website) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// --- Attempt to enrich a prospect with a contact email ---
// Returns { email, confidence } or null if nothing found / no website.
async function enrichContact({ website }) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new Error('HUNTER_API_KEY is not set');

  const domain = extractDomain(website);
  if (!domain) return null;

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}&limit=1`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error('Hunter.io enrichment failed', { domain, status: res.status });
    return null;
  }

  const data = await res.json();
  const emails = data.data?.emails || [];

  // Prefer a generic/owner-type role if Hunter tagged one, otherwise take
  // the highest-confidence result Hunter returned.
  const best =
    emails.find((e) => ['owner', 'ceo', 'founder'].includes((e.position || '').toLowerCase())) ||
    emails[0];

  if (!best?.value) return null;

  return { email: best.value, confidence: best.confidence ?? null };
}

module.exports = { enrichContact };
