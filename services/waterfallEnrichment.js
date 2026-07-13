// services/waterfallEnrichment.js
// "Waterfall" enrichment: try providers in priority order, stop at the
// first one that returns a usable email. Only Hunter.io is actually wired
// in right now (reusing lib/prospecting/enrichment.js) — firmographics and
// intent signals need a dedicated data provider (e.g. Clearbit, Apollo,
// Crunchbase) that isn't configured yet. Returning fabricated firmographic
// data would be worse than returning null, so this is explicit about what
// it doesn't have rather than inventing plausible-looking numbers.
const { enrichContact } = require('../lib/prospecting/enrichment');

// --- Provider 1: Hunter.io (email only) ---
async function tryHunter(domain) {
  try {
    const result = await enrichContact({ website: domain });
    if (result?.email) {
      return { emails: [result.email], source: 'hunter', confidence: result.confidence ?? null };
    }
  } catch (err) {
    console.error('waterfallEnrichment: Hunter.io provider failed', { domain, error: err.message });
  }
  return null;
}

// --- Provider 2 slot: not configured ---
// Add a real fallback here (Clearbit, Apollo, Snov.io, etc.) once you've
// picked one. Kept as an explicit no-op rather than removed, so the
// waterfall shape (try each, stop at first hit) is obvious for whoever
// wires the next provider in.
async function tryFallbackProvider(_domain) {
  return null;
}

// --- Main entry point ---
// Returns { emails: string[], firmographics: object|null, intentSignals: object|null }
// firmographics/intentSignals are always null until a real provider for
// those is configured — do not fill these with guessed values.
async function enrichDomain(domain, companyName) {
  if (!domain) {
    throw new Error('enrichDomain requires a domain');
  }

  const providers = [tryHunter, tryFallbackProvider];
  let emailResult = null;

  for (const provider of providers) {
    emailResult = await provider(domain);
    if (emailResult) break;
  }

  return {
    emails: emailResult?.emails || [],
    emailSource: emailResult?.source || null,
    // Explicitly null, not {} — {} would look like "checked, found nothing,"
    // which is a different claim than "never checked."
    firmographics: null,
    intentSignals: null,
    companyName: companyName || null,
  };
}

module.exports = { enrichDomain };
