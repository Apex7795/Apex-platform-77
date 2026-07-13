# Apex Junk Solutions — Combined Platform + Prospecting Module

This is the platform source (call tracking, lead rescue, campaign actions,
dashboards, billing) merged with the Prospecting & Enrichment module
(business discovery, email outreach, opt-out handling), as one tree.

## What changed in this merge

1. **`db/migrate_combined.sql`** — the migration to actually run. It's
   `db/schema.sql` + `scripts/migrate_prospects.js`'s tables combined into
   one atomic transaction, with one correctness fix applied (see #2 below).
   `db/schema.sql` and `scripts/migrate_prospects.js` are kept in the tree
   for reference/history but you should not run them separately if you've
   run the combined migration.

2. **Fixed: RLS policies now use `current_setting(..., true)`.** The
   original policies (`db/schema.sql`, `scripts/migrate.js`) call
   `current_setting('app.current_tenant_id')` with no second argument.
   Without it, Postgres *throws* on any query where that session variable
   was never set, instead of just returning zero rows. That's not a
   theoretical issue — it's exactly what breaks item #3 below.

3. **Fixed: `app/api/prospects/reply/route.js`** now writes the converted
   lead through `runWithTenant(HOUSE_TENANT_ID, ...)` instead of a bare
   `pool.query(...)`. The original bare call would throw
   `unrecognized configuration parameter` on every single click of a
   "Interested?" link in an outreach email, because it never set the
   tenant session variable the `leads` RLS policy depends on.

## Fixed in this final master build

- **`lib/db.js`: `SET LOCAL` → `set_config()`.** `SET LOCAL app.current_tenant_id = $1`
  bound a parameter to a utility statement, which `pg` doesn't reliably
  support across versions. Changed to
  `SELECT set_config('app.current_tenant_id', $1, true)` — a regular
  function call that binds normally and keeps the same transaction-local
  scoping (`true` = local to the transaction, same as `SET LOCAL` had).

- **`jobs/leadRescue.js`: SMS `from` number.** Was sending
  `from: tenant.owner_phone` — the business owner's own personal number,
  which Apex doesn't control. Twilio requires `from` to be a number
  you've provisioned on your own account, so every send would have failed
  in production. Now looks up the tenant's active row in
  `tracking_numbers` instead, and skips the send (logging loudly, not
  silently) if a tenant has no active tracking number, rather than
  attempting a send Twilio would reject anyway. `jobs/dailyDigest.js` was
  checked too — it already used `owner_phone` correctly there (as the
  `to`, with a platform-owned `from`), so it needed no change.

## Verification performed on this build

No live database or network access was available to test this against a
real Postgres instance or real third-party APIs, so verification was
static and unit-level:

- **Syntax**: every `.js` file passes `node --check`, before and after
  the two fixes above. `.jsx` files checked for balanced
  brackets/braces + a default export (no offline JSX transpiler
  available to fully parse them).
- **Token logic** (`actionTokens.js`, `prospectOptOutTokens.js`): 13 unit
  tests — valid roundtrip, tampered-signature rejection, expiry, wrong
  action/resource rejection, and that an opt-out token can't be replayed
  as a reply-consent token or vice versa. 13/13 passed.
- **Admin auth** (`adminAuth.js`): 6 unit tests, including that a missing
  `ADMIN_API_TOKEN` fails closed (denies everything) rather than silently
  disabling auth. 6/6 passed.
- **Scoring** (`prospectScoring.js`): 5 unit tests — malformed input
  doesn't throw, a strong prospect outscores a weak one, tier is always
  valid. 5/5 passed.
- **Schema cross-reference**: every column in every `SELECT`, `INSERT`,
  and `UPDATE` across the codebase checked against the columns the three
  migration files actually create, in order. 0 mismatches, re-verified
  after both fixes were applied.

**Not verified — still needs real infrastructure before production**: RLS
behavior against an actual Postgres instance, and live Twilio / Postmark /
OpenAI / Google Places / Hunter.io calls. Run the migration and a manual
smoke test against a staging database first.

## Not fixed — flagging instead, since these need a product decision, not just a syntax fix

- **`/api/prospects/*` admin routes now require `Authorization: Bearer
  <ADMIN_API_TOKEN>`** (`lib/adminAuth.js`), applied to `discover`,
  `[id]` PATCH, `[id]/outreach`, `enrich-and-outreach`, and the list
  endpoint. `opt-out` and `reply` are deliberately NOT gated — those are
  public links clicked by prospects from outreach emails, protected by
  their own single-purpose HMAC tokens instead.

  **This closes the API, not the browser dashboard.** `ADMIN_API_TOKEN` is
  a static shared secret — fine for scripts/cron/curl, but it must never
  be embedded in `ProspectingTab.jsx` or any client bundle, since browser
  JS is readable by anyone with devtools. That component still has no
  working auth story; see the warning comment at its top. It needs real
  session-based admin login before going live, with these fetch calls
  either riding that session cookie or going through a server-side proxy.

- **`PROSPECTING_HOUSE_TENANT_ID`** must be set to a real row in `tenants`
  before `reply/route.js` can do anything besides log a warning.

- **`services/prospectOutreach.js`: `sendViaEmailProvider()`** now sends
  via Postmark (`postmark` npm package). Requires `POSTMARK_SERVER_TOKEN`
  and `OUTREACH_FROM_EMAIL` in `.env` — the From address must be a
  verified Sender Signature or domain in your Postmark account, or sends
  will fail with 401/422. Also adds a `List-Unsubscribe` header alongside
  the in-body opt-out link (mail-client-level unsubscribe button, good for
  both CAN-SPAM compliance and sender reputation).

## Scheduling

This is a Next.js app — API routes are request/response and don't stay
alive to host `node-cron` themselves. `scripts/cron.js` is a standalone
worker process that schedules all three background jobs (lead rescue every
5 min, daily digest at 8am server time, prospect discovery at 6am). Run it
as its own process/container:

```bash
npm run cron
```

**Run exactly one instance of this process.** Scaling it like the web app
sends duplicate SMS/emails per job run — see the warning comment at the
top of `scripts/cron.js`.

## Waterfall enrichment + AI-personalized outreach (added this pass)

- **`db/migrate_prospect_enrichment.sql`** — new columns on `prospects`
  (`domain`, `emails` JSONB, `firmographics`, `intent_signals`,
  `last_enriched_at`) plus a unique index on `domain` for upsert/dedup.
  Run this *after* `db/migrate_combined.sql`, not instead of it.
- **`services/waterfallEnrichment.js`** — tries enrichment providers in
  order, stopping at the first hit. Only Hunter.io is actually wired in;
  firmographics/intent signals are explicitly `null` until a real provider
  (Clearbit, Apollo, etc.) is configured — this deliberately does not
  fabricate plausible-looking company data.
- **`services/aiPersonalization.js`** — generates a one-line icebreaker,
  told explicitly not to invent facts when no firmographic/intent data is
  available.
- **`jobs/prospectHygiene.js`** — weekly (Sun 2am) refresh of enrichment
  data older than 30 days. Excludes `opted_out` and `converted` prospects,
  batch-limited to 200/run, 1s delay between requests.
- **`app/api/prospects/enrich-and-outreach/route.js`** — the on-demand
  version: enrich a domain, generate an icebreaker, send outreach. Fixed
  from the version this was adapted from: it now upserts on `domain`
  instead of erroring on the missing-`source` NOT NULL violation, and it
  sends through `sendOutreachEmail()` instead of calling the email
  provider directly — so opt-out checks, the unsubscribe link, the reply
  link, and the outreach log all still apply. **Do not add a second code
  path that calls `sendViaEmailProvider()` directly** — every send should
  go through `sendOutreachEmail()` or these protections get bypassed again.

## Fit scoring (added this pass)

- **`db/migrate_prospect_scoring.sql`** — adds `rating`, `review_count`,
  `business_status`, `fit_score`, `fit_tier`, `fit_reasons` to `prospects`.
  Run after `db/migrate_prospect_enrichment.sql`.
- **`services/prospectScoring.js`** — scores fit using only what Google
  Places actually returns: operational status (hard disqualifier if
  permanently closed), review count as a call-volume proxy, rating ≥ 4.0,
  website presence, and an optional `TARGET_SERVICE_AREAS` geographic
  filter. Explicitly does **not** score revenue or business age — that
  needs a paid firmographics provider that isn't wired in yet (see the
  stubbed second waterfall slot in `services/waterfallEnrichment.js`).
  Weights are a reasonable starting point, not a calibrated model — there's
  no conversion data yet to calibrate against.
- **`lib/prospecting/googlePlaces.js`** — field mask extended to request
  `rating`, `userRatingCount`, `businessStatus` (small per-call cost
  increase on the Places API "Pro" SKU at scale, worth knowing).
- **`jobs/prospectDiscovery.js`** — scores every prospect at discovery
  time and persists it; `enrichPendingProspects()` now skips
  `fit_tier = 'disqualified'` prospects so Hunter.io calls aren't wasted
  on permanently-closed businesses.
- **`GET /api/prospects?tier=hot`** — list endpoint now filters by tier
  and sorts by `fit_score DESC` by default (previously sorted by
  discovery date only).

## Setup

```bash
npm install
# fill in .env: DATABASE_URL, ACTION_TOKEN_SECRET, TWILIO_*, OPENAI_API_KEY,
# STRIPE_*, GOOGLE_PLACES_API_KEY, HUNTER_API_KEY, PROSPECTING_HOUSE_TENANT_ID,
# TARGET_SERVICE_AREAS
node db/migrate_combined.sql              # or: psql $DATABASE_URL -f db/migrate_combined.sql
node db/migrate_prospect_enrichment.sql   # run after migrate_combined.sql
node db/migrate_prospect_scoring.sql      # run after migrate_prospect_enrichment.sql
```

## On the copyright registration angle

Not part of the code, but worth repeating here since it's the stated
end goal for this deposit copy: this codebase (both the original platform
and the prospecting module) is substantially AI-generated across this and
prior sessions. Copyright Office guidance requires disclosing AI's role
in works submitted for registration — a filing that presents this as
wholly human-authored risks the registration being invalidated later.
Worth confirming the right disclosure approach with an IP attorney before
filing, as the earlier copyright documentation itself recommended.
