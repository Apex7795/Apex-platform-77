// scripts/cron.js
// Standalone scheduler process for the three background jobs. Run this as
// its own process/container alongside the Next.js app — Next.js API routes
// are request/response and don't stay alive to host a cron scheduler
// themselves, so this is a separate `node scripts/cron.js` process.
//
// IMPORTANT — run exactly ONE instance of this process. If you scale this
// script horizontally the same way you might scale the web app, every
// instance fires these jobs independently and tenants get duplicate SMS
// and duplicate outreach emails. If you need HA, use a distributed
// scheduler/lock (e.g. a Postgres advisory lock around each run) instead
// of just running two copies of this file.
require('dotenv').config();
const cron = require('node-cron');
const { runLeadRescueJob } = require('../jobs/leadRescue');
const { runDailyDigestJob } = require('../jobs/dailyDigest');
const { runProspectDiscoveryJob } = require('../jobs/prospectDiscovery');
const { runProspectHygieneJob } = require('../jobs/prospectHygiene');

// Lead rescue: every 5 minutes, matches the 5-minute/2-hour staging logic
// inside jobs/leadRescue.js itself.
cron.schedule('*/5 * * * *', () => {
  runLeadRescueJob().catch((err) => console.error('leadRescue cron run failed:', err));
});

// Daily digest: fixed 8am server time for now. jobs/dailyDigest.js's own
// comments note that per-tenant local-8am filtering would need an hourly
// run + a timezone column on tenants — not implemented here, matching
// what was already true of the job itself.
cron.schedule('0 8 * * *', () => {
  runDailyDigestJob().catch((err) => console.error('dailyDigest cron run failed:', err));
});

// Prospect discovery: once daily, early morning. Target cities are
// hardcoded in jobs/prospectDiscovery.js's default argument — pass your
// real target list here instead of relying on the default.
cron.schedule('0 6 * * *', () => {
  runProspectDiscoveryJob(['Sacramento, CA']).catch((err) =>
    console.error('prospectDiscovery cron run failed:', err)
  );
});

// Prospect data hygiene: weekly, Sunday 2am — refreshes stale enrichment
// data (30+ days old), respecting opt-out status. See jobs/prospectHygiene.js.
cron.schedule('0 2 * * 0', () => {
  runProspectHygieneJob().catch((err) => console.error('prospectHygiene cron run failed:', err));
});

console.log(
  'Cron worker started: leadRescue (*/5 min), dailyDigest (8am), prospectDiscovery (6am), prospectHygiene (Sun 2am)'
);
