# Optional Mini Comps module

Built October 3, 2026. **Default off; not live in production.** Depends on a matched subject-property event, not on client-supplied property facts. Core intake/contact/consent tables remain unchanged. Both this module and the Property Records module can be disabled or removed for another industry.

## Intake/report behavior

An enabled intake gets a private report placeholder immediately after its inquiry is saved. After Property Records appends a match/research event, it invokes an optional callback. Mini Comps then appends a comparison report, or an explicit insufficient-data result when the property is unidentified or data are inadequate. Generation failure preserves the inquiry and receipt. Retrying appends a new report; earlier reports remain in history.

The JSON report contains the subject's dated appraiser values, a separate verified subject-characteristics profile, selected sold properties, sale dates/prices, acreage/building area, unit prices, distance, evidence links/deed references and reasons for selection/exclusion. Observed sale prices are unadjusted. No estimated subject value is calculated, including when three or more sales are selected.

`renderReport` creates an escaped HTML card with the subject, comparison table, observed statistics and review limits. `miniCompCard` loads the latest report only after the host CRM supplies a successful inquiry-access check. It is ready to call from the private inquiry detail page. The production admin Worker source is not in this repository, so the deployed admin panel has **not** been wired to it. No public report/download, automatic client email, or public import endpoint is added.

## Initial selection policy

These are configurable engineering defaults for preliminary internal research, not appraisal standards or a validated market valuation model:

- Same county, exact published property-use code and improvement class.
- Prior 365 days, within 10 miles of the subject's verified coordinates.
- Acreage between 0.5 and 2 times the subject; the same ratio limit for building area on improved properties.
- Source-supported qualified sale, full interest and single parcel; characteristics at the time of sale must be verified.
- At least three distinct comparable parcels for an observed-price summary; display at most five.
- Published source dates no more than 30 days old. Unknown/restricted profiles, missing size/location and stale sources require research/review.

One most-recent qualifying sale per parcel is counted. Repeat flips, duplicates, package transfers, partial interests and subject-property sales cannot inflate the comparable count. Rank favors nearby sales with similar size and more recent dates. A candidate query that exceeds 500 rows stops with `candidate_search_incomplete` rather than ranking an arbitrary truncated set. Initial database filters constrain county/use/improvements/date/geography; detailed exclusions cover that candidate pool, not every sale in the county.

Mixed/unknown improvement classes require review. Vacant land uses total sale price per acre; improved property uses total sale price per building square foot, including its land component. Do not use either unit price as an adjusted subject valuation. Zoning, access, utilities, flood/wetland conditions, development rights and building condition remain review items.

## Activation and data contract

1. Apply `migration.sql` to a separate D1 database bound as `MINI_COMP_DB` on the replacement intake and private admin Workers.
2. Load actual county publications through `beginDataset`, `importChunk` (up to 200 profiles/sales per invocation), then `finishDataset`. Complete a county snapshot before enabling it; source counts are checked before the dataset becomes searchable. Prior complete datasets stay usable after an interrupted import.
3. Each profile supplies county, string parcel ID, situs address, acreage, optional building area, exact county property-use code, explicit improvement class, numeric latitude/longitude, `restricted: false`, and a source with approved URL/publication/retrieval dates. Subject enrichment must agree with the matched parcel's county/ID, acreage and supplied use code.
4. Each sale supplies a stable sale ID, valid ISO sale date, positive price, deed reference, qualification (`qualified`, `unqualified` or `unknown`), published qualification code if available, explicit `single_parcel`, `full_interest`, `characteristics_verified_at_sale`, `profile_at_sale`, and its source. Use the official qualification meaning for that county and sale year; do not infer qualification from price or deed type. Missing transaction flags default to excluded. A current profile cannot be relabeled as sale-time data without source support.
5. Import adapters must gather verified coordinates, improvement classes/building sizes and sale qualification/interest/package information. **The first module's basic Indian River export adapter does not supply all these fields.** Its sale price/history alone is insufficient to enable Mini Comps. Automatic enriched county importers remain implementation/live-verification work.
6. Set `MINI_COMPS_ENABLED="true"` only after current data and replacement intake deployment are verified. Keep `PROPERTY_RECORDS_ENABLED="true"` for the automatic matched-record callback. Neither flag changes the existing live public endpoint in this change.
7. In the authenticated inquiry page call `miniCompCard({ inquiryId, env, authorize: id => existingInquiryAccessCheck(id) })`. Use the real authenticated account/access policy; do not trust a user-supplied header. Private report history is available through `createRepository(...).history(inquiryId)`.
8. Human-confirmed property matches can be passed to `afterPropertyResolved` from authorized admin operations. Reports waiting on failed research can be regenerated through the same function after research recovers. A dedicated queued report processor and scheduled dispatch recovery are available in `../../workers/mini-comps/README.md`. Automatic county import and human-review UI wiring remain unfinished.

Deploy with a module-aware build/deployment tool from the repository root. This source relies on relative module imports; single-file dashboard pasting is insufficient.

## Disable / remove

Omit `MINI_COMPS_ENABLED` or set it to `"false"`; it makes no database calls. To remove it, delete `modules/mini-comps`, remove the Mini Comps import, `queueMiniComp` call, `onPropertyResult` callback and optional response field from the intake Worker. The property module's callback is generic and optional; it can remain. Shared Florida source configuration is in `industry/florida/county-sources.mjs` so deleting either module does not delete another module's configuration.

## Validation

Run `node --test modules/property-records/tests/*.test.mjs modules/mini-comps/tests/*.test.mjs` on Node 24. Tests use synthetic parcels, in-memory SQLite and stubbed email paths; they send no live inquiries or mail. Coverage includes land/improvement separation, sale qualification and ownership-interest flags, geography/date/size filters, distinct-parcel counting, missing/stale data, partial imports, HTML escaping, failure isolation, event chaining and independent module removal. Live source ingestion, Cloudflare deployment and production CRM presentation remain unverified.

Source interpretation reference: Florida Department of Revenue's official current/prior-year transfer-code page, checked October 3, 2026: https://www.floridarevenue.com/property/Pages/Cofficial_CompleteSubRollEval.aspx . County-specific codes must be mapped against the appropriate year before activation; this module deliberately does not guess their meaning.

## Optional dedicated processing

Set `MINI_COMP_QUEUE_ENABLED="true"` only after deploying and verifying the separate processor. Matched-property events then persist durable tasks and enqueue IDs instead of generating inline. Apply the additional queue migration and follow `../../workers/mini-comps/README.md` for bindings, capacity, retries and operations. This flag is independent of the main module flag and defaults off.
