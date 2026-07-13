// services/prospectScoring.js
// Scores a discovered prospect's fit as an Apex customer, using only
// signals actually available from Google Places discovery. Revenue/
// business-age scoring is NOT implemented — that needs a paid
// firmographics provider (see services/waterfallEnrichment.js's stubbed
// second waterfall slot). Review count is used as a volume proxy instead.
//
// Weights are a starting point, not a calibrated model — there's no
// conversion data yet to calibrate against. Revisit once you have a few
// dozen prospects that converted (or didn't) to see which signals
// actually predicted it.

const WEIGHTS = {
  hasWebsite: 20,
  ratingAbove4: 10,
  reviewVolume: { none: 0, low: 8, medium: 20, high: 30 }, // 0, 1-5, 6-25, 26+
  inTargetServiceArea: 25,
};

// Comma-separated "City, ST" list, e.g. "Sacramento, CA,Stockton, CA".
// Empty/unset means "no geographic filter" — every city scores full marks
// for this criterion rather than zero, since an empty allowlist isn't a
// meaningful signal either way.
function getTargetServiceAreas() {
  const raw = process.env.TARGET_SERVICE_AREAS;
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function reviewVolumeScore(reviewCount) {
  if (reviewCount == null) return { points: 0, band: 'unknown' };
  if (reviewCount === 0) return { points: WEIGHTS.reviewVolume.none, band: 'none' };
  if (reviewCount <= 5) return { points: WEIGHTS.reviewVolume.low, band: 'low (1-5)' };
  if (reviewCount <= 25) return { points: WEIGHTS.reviewVolume.medium, band: 'medium (6-25)' };
  return { points: WEIGHTS.reviewVolume.high, band: 'high (26+)' };
}

/**
 * Scores a single prospect. Returns { score, tier, reasons } — does not
 * write to the DB itself, so callers control when/whether to persist.
 *
 * @param {{ website: string|null, rating: number|null, review_count: number|null,
 *            business_status: string|null, city: string|null, state: string|null }} prospect
 */
function scoreProspect(prospect) {
  const reasons = [];

  // Hard disqualifier: confirmed closed. Absence of status data
  // (business_status === null) is treated as unknown/still-eligible, not
  // a disqualifier — Google not having the field isn't evidence of closure.
  if (prospect.business_status === 'CLOSED_PERMANENTLY') {
    return {
      score: 0,
      tier: 'disqualified',
      reasons: ['Google Places reports this business as permanently closed'],
    };
  }

  let score = 0;

  if (prospect.website) {
    score += WEIGHTS.hasWebsite;
    reasons.push(`Has a website (+${WEIGHTS.hasWebsite})`);
  } else {
    reasons.push('No website on file (+0) — also blocks enrichment waterfall');
  }

  if (typeof prospect.rating === 'number' && prospect.rating >= 4.0) {
    score += WEIGHTS.ratingAbove4;
    reasons.push(`Rating ${prospect.rating} ≥ 4.0 (+${WEIGHTS.ratingAbove4})`);
  } else if (typeof prospect.rating === 'number') {
    reasons.push(`Rating ${prospect.rating} below 4.0 (+0)`);
  }

  const volume = reviewVolumeScore(prospect.review_count);
  score += volume.points;
  reasons.push(`Review count ${prospect.review_count ?? 'unknown'} — ${volume.band} band (+${volume.points})`);

  const targetAreas = getTargetServiceAreas();
  if (!targetAreas) {
    score += WEIGHTS.inTargetServiceArea;
    reasons.push('No TARGET_SERVICE_AREAS configured — geographic filter skipped (+full marks)');
  } else {
    const cityState = `${prospect.city || ''}, ${prospect.state || ''}`.trim().toLowerCase();
    const inArea = targetAreas.some((area) => cityState.includes(area));
    if (inArea) {
      score += WEIGHTS.inTargetServiceArea;
      reasons.push(`${prospect.city}, ${prospect.state} is in target service areas (+${WEIGHTS.inTargetServiceArea})`);
    } else {
      reasons.push(`${prospect.city}, ${prospect.state} is outside target service areas (+0)`);
    }
  }

  let tier;
  if (score >= 65) tier = 'hot';
  else if (score >= 35) tier = 'warm';
  else tier = 'cold';

  return { score, tier, reasons };
}

module.exports = { scoreProspect, getTargetServiceAreas };
