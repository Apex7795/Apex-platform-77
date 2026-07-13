// jobs/prospectHygiene.js
// Refreshes enrichment data for prospects whose last enrichment is stale.
// Exports a run function rather than self-scheduling — scheduling lives
// centrally in scripts/cron.js, same pattern as the other jobs.
const { pool } = require('../lib/db');
const waterfallEnrichment = require('../services/waterfallEnrichment');

const STALE_DAYS = 30;
const BATCH_LIMIT = 200; // cap per run so a large backlog doesn't turn one
                          // cron tick into an hours-long synchronous job
const DELAY_BETWEEN_REQUESTS_MS = 1000; // respect enrichment provider rate limits

async function getStaleProspects(limit) {
  const { rows } = await pool.query(
    `SELECT id, domain, business_name
     FROM prospects
     WHERE domain IS NOT NULL
       AND (last_enriched_at IS NULL OR last_enriched_at < NOW() - INTERVAL '${STALE_DAYS} days')
       AND status != 'converted'
       AND opted_out = false
     ORDER BY last_enriched_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function runProspectHygieneJob() {
  console.log('Starting automated data hygiene cycle...');

  try {
    const staleProspects = await getStaleProspects(BATCH_LIMIT);
    console.log(`Found ${staleProspects.length} stale prospects (capped at ${BATCH_LIMIT}). Refreshing...`);

    let refreshed = 0;
    for (const prospect of staleProspects) {
      try {
        const freshData = await waterfallEnrichment.enrichDomain(prospect.domain, prospect.business_name);

        if (freshData.emails.length > 0) {
          await pool.query(
            `UPDATE prospects
             SET emails = $1,
                 email = COALESCE(email, $2),  -- keep legacy singular column populated
                                                -- without clobbering a value that was
                                                -- already there (e.g. manually corrected)
                 firmographics = $3,
                 intent_signals = $4,
                 last_enriched_at = NOW(),
                 updated_at = NOW()
             WHERE id = $5`,
            [
              JSON.stringify(freshData.emails),
              freshData.emails[0],
              freshData.firmographics ? JSON.stringify(freshData.firmographics) : null,
              freshData.intentSignals ? JSON.stringify(freshData.intentSignals) : null,
              prospect.id,
            ]
          );
          refreshed += 1;
        } else {
          // Still stamp last_enriched_at even on a miss, so a
          // permanently-unenrichable domain doesn't sort to the front of
          // every future run and burn API calls on repeat.
          await pool.query(`UPDATE prospects SET last_enriched_at = NOW() WHERE id = $1`, [prospect.id]);
        }
      } catch (err) {
        // One bad enrichment shouldn't stop the batch
        console.error('Hygiene enrichment failed for prospect', prospect.id, err.message);
      }

      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
    }

    console.log(`Data hygiene cycle complete. ${refreshed}/${staleProspects.length} refreshed.`);
  } catch (error) {
    console.error('Error during data hygiene cycle:', error);
  }
}

module.exports = { runProspectHygieneJob };
