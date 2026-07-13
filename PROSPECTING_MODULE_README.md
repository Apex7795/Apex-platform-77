# Prospecting & Enrichment Module — Apex Junk Solutions

Adds business discovery (Google Places), contact enrichment (Hunter.io), and
one-click email outreach to your existing platform.

## Files added

```
scripts/migrate_prospects.js              # run this first
lib/prospecting/googlePlaces.js
lib/prospecting/enrichment.js
lib/prospectOptOutTokens.js
services/prospectOutreach.js
jobs/prospectDiscovery.js
app/api/prospects/route.js                # GET list
app/api/prospects/discover/route.js       # POST run discovery for one city
app/api/prospects/[id]/route.js           # PATCH status
app/api/prospects/[id]/outreach/route.js  # POST send outreach email
app/api/prospects/opt-out/route.js        # GET unsubscribe link target
app/api/prospects/reply/route.js          # GET reply-consent link target
components/ProspectingTab.jsx             # admin dashboard tab
```

## Setup

1. Run the migration:
   ```
   node scripts/migrate_prospects.js
   ```
2. Add to `.env`:
   ```
   GOOGLE_PLACES_API_KEY=...
   HUNTER_API_KEY=...
   OUTREACH_FROM_EMAIL=you@apexjunksolutions.com
   PROSPECTING_HOUSE_TENANT_ID=...   # a tenant row that represents Apex's own outreach, see note below
   ```
3. Wire up `sendViaEmailProvider()` in `services/prospectOutreach.js` to your
   actual email provider (SendGrid, Postmark, Resend, etc.) — it's stubbed
   with a console.log placeholder so nothing sends until you connect one.
4. Add `<ProspectingTab />` as a tab in your existing admin dashboard.

## Test run (per the original plan)

Before scheduling this nationwide, test one city:

```
curl -X POST http://localhost:3000/api/prospects/discover \
  -H "Content-Type: application/json" \
  -d '{"city": "Sacramento, CA"}'
```

This runs discovery + enrichment once and returns counts, so you can see
data quality before committing to a schedule.

## Why email-only outreach, not SMS

TCPA restrictions on unsolicited SMS are genuinely unsettled for B2B
numbers scraped from a directory — some courts have found them exempt,
others haven't. Cold email under CAN-SPAM is settled: it's legal as long
as you don't falsify headers and you honor opt-outs, which is why every
outreach email includes a signed, one-click unsubscribe link
(`lib/prospectOptOutTokens.js`) that immediately and permanently flags
`opted_out = true` on the prospect.

This is now built in: every outreach email includes an "Interested?" link
(`app/api/prospects/reply/route.js`). Clicking it is the prospect's own
affirmative action — the same signal an inbound phone call already gives
you — so at that point they get inserted into your existing `leads` table
and start flowing through `jobs/leadRescue.js` exactly like any other lead,
SMS included. Prospects who never click that link never receive SMS.

You'll need a "house" tenant row in your `tenants` table to represent Apex's
own outreach pipeline (as opposed to a paying customer's), and its `id` goes
in `PROSPECTING_HOUSE_TENANT_ID`. This keeps prospect-turned-leads visible
in your own dashboard without mixing them into a customer's lead list.

## Design notes matching your existing architecture

- `prospects` has **no RLS policy**, matching `campaign_templates` — this
  is Apex's own acquisition data, not tenant-owned data, so there's no
  tenant to scope it to.
- Opt-out tokens reuse the same HMAC pattern as `lib/actionTokens.js`
  (signed, timing-safe verified) but are a separate, narrower token type
  since they only ever do one thing.
- `contact_attempts` and `last_contacted_at` mirror the shape of
  `rescue_stage` / `last_touched_at` on `leads`, so the mental model stays
  consistent between the two pipelines.
