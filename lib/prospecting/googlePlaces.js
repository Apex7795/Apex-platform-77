// lib/prospecting/googlePlaces.js
// Thin wrapper around Google Places API (Text Search) for prospect discovery.
// Requires GOOGLE_PLACES_API_KEY in env.

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// --- Search for businesses matching a query in a given city ---
// e.g. searchBusinesses({ query: 'junk removal', city: 'Sacramento, CA' })
async function searchBusinesses({ query, city }) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set');

  const textQuery = `${query} in ${city}`;

  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      // Field mask keeps the bill down — only request what we use.
      // rating/userRatingCount/businessStatus added for fit scoring
      // (services/prospectScoring.js) — each additional field has a small
      // per-call cost impact on Places API "Pro" SKU pricing, worth
      // knowing if discovery volume gets large.
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,' +
        'places.websiteUri,places.addressComponents,places.rating,places.userRatingCount,' +
        'places.businessStatus',
    },
    body: JSON.stringify({ textQuery, maxResultCount: 20 }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Google Places search failed: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const places = data.places || [];

  return places.map((p) => {
    const cityComponent = p.addressComponents?.find((c) =>
      c.types.includes('locality')
    );
    const stateComponent = p.addressComponents?.find((c) =>
      c.types.includes('administrative_area_level_1')
    );

    return {
      source_place_id: p.id,
      business_name: p.displayName?.text || 'Unknown Business',
      phone: p.nationalPhoneNumber || null,
      website: p.websiteUri || null,
      address: p.formattedAddress || null,
      city: cityComponent?.longText || null,
      state: stateComponent?.shortText || null,
      rating: typeof p.rating === 'number' ? p.rating : null,
      review_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
      // Google returns e.g. 'OPERATIONAL' | 'CLOSED_TEMPORARILY' |
      // 'CLOSED_PERMANENTLY'. Absence of the field (undefined) most often
      // means Google simply has no status data, not that it's confirmed
      // open — treat that case as unknown, not operational, in the scorer.
      business_status: p.businessStatus || null,
    };
  });
}

module.exports = { searchBusinesses };
