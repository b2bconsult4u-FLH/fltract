# Optional Property Records module

Built October 3, 2026. **Not activated in production.**

The reusable intake core stores the inquiry, contact details and consent. This industry module separately researches a submitted property against county Property Appraiser publications. A plumber can disable or remove it without migrating the core CRM schema.

## What is built

- Feature switch, isolated `PROPERTY_DB` schema and optional private `PROPERTY_CARDS` object storage.
- Published-record import and exact parcel/address lookup; an Indian River CAMA export adapter.
- Capture of parcel/folio and separate county ID, published description, owner names/mailing addresses, acreage, use code, assessment year/values, exemptions, improvements, sales and deed references.
- Private card copy retention with source URL and SHA-256 when card bytes are supplied by trusted import code.
- Append-only research/review history attached to each inquiry/property, retaining the original client input.
- Nonblocking intake integration after the inquiry is saved. Failed lookups stay available for research/retry.
- Optional public form fields for an explicit parcel ID and address/general-location distinction. They clear on a second property while existing client-contact retention continues.

## Remaining live prerequisites

The live public form currently posts to `fltract-intake.../intake`. The checked-in replacement Worker accepts `/submit` and different consent/contact values. This module does **not** switch that endpoint or solve the pre-existing migration discrepancy. Deploy and verify the replacement intake separately before routing the public form to it.

County websites are not interchangeable APIs. This version uses imported official published data; it does **not** automatically scrape county websites or claim all 67 county connections work. Indian River's official export download was blocked from this execution environment. The other four counties have source registries and accept normalized records from trusted importers, but their automatic download/parser connections still require implementation and live verification.

No synthetic test records should be imported into production. Load actual, current county publications and test known parcels before enabling a county. Unloaded/unsupported counties and unidentifiable locations return `needs_research`; ambiguous or stale records return `needs_review`. `matched` establishes a match to a published property record, never client ownership authority or a full legal description. Missing owner/description/card fields remain explicit warnings.

## Activation

1. Apply `migration.sql` to a separate D1 database. Bind it as `PROPERTY_DB` on the replacement intake Worker; do not modify core inquiry/contact/consent tables.
2. Bind private R2 storage as `PROPERTY_CARDS` to the trusted importer/private admin if retaining downloaded card bytes. Do not expose the bucket or raw HTML to the public form; download cards through authenticated admin code as attachments.
3. Feed normalized official records through `ingestPublication`. `source` has `county`, `kind` (`published_export` or `record_card`), official `url`, `retrieved_at` and `published_at` (required for automatic export matching; an unknown publication date requires review). Each record requires explicit restriction review/status. `cards` is an optional Map keyed by the published parcel ID, containing official `url`, `content_type` and actual `bytes`. Imports remain invisible until complete.
4. For countywide data, call `beginPublication` with its expected record count, then `ingestRecords` in chunks of at most 200 records across separate trusted invocations, then `finishPublication`. Finishing checks the total count before enabling search. Do not attempt the entire county in one Worker request. Provide a consistent complete snapshot rather than a subset: lookup selects the latest completed publication. A record-card-only subset should use a separate database until an incremental county adapter is added. Do not let a partial snapshot supersede countywide records.
5. Use the Indian River adapter with parsed named rows from the published PROPERTY, OWNER, VALUES, EXEMPTION, IMPROVEMENT and SALES files. Pass `restrictionsReviewed: true` only after reviewing the actual public export. The adapter does not process NAL files or retain SSNs. Values are joined to the property's roll year.
6. Set `PROPERTY_RECORDS_ENABLED="true"` only after the migration/data load and deployment checks. Absent or any other value disables the module and causes no module database calls.
7. Enable optional browser fields with `window.intakeModules = { propertyRecords: { enabled: true } }` before loading `/assets/js/property-records.js`. The current form includes a disabled configuration; enable only once its receiving Worker stores these fields through the module.
8. Private admin code can use `createRepository(...).history(inquiryId)` and `recordReview(...)`. Authenticate/authorize the caller before exposing either method. No new public read, import or review endpoint is included. Admin panel wiring and a scheduled import/retry runner remain activation work.

The hook first durably queues a job and then runs research through `ctx.waitUntil`. `runJob` can retry a stored job from private operations. If queueing fails, the core inquiry still saves; the intake response reports the module as unavailable and operational logs record the failure. Recovery should requeue such inquiries from core CRM; no automatic recovery scheduler is included yet.

Deploy the Worker using a module-aware tool such as Wrangler from the repository root. It now imports module files; pasting only `worker.mjs` into a single-file dashboard editor will not include its dependencies.

## Disable / remove for another industry

Set `PROPERTY_RECORDS_ENABLED="false"` or omit it; disable the browser configuration. No county lookup or module storage is used. To strip it completely, delete this directory and the optional browser script, then remove the one Worker import, the `afterInquirySaved` call and its optional response field, and the form's two script tags. The core consent, acknowledgment, inquiry database and follow-up routines are unchanged.

## Validation

Run `node --test modules/property-records/tests/*.test.mjs`. Tests use clearly synthetic records and an in-memory SQLite-backed D1 substitute; no real inquiries or emails are sent. They cover module-off behavior, exact matches, conflicts/multiple results, stale/restricted records, county isolation, actual card storage, safe failures and the inquiry-save integration. Live county retrieval, Cloudflare deployment and admin rendering are not covered by local tests.

## Source references checked October 3, 2026

- Indian River publications: https://www.ircpa.org/site-links/pro-tools-page/
- Indian River field layout: https://www.ircpa.org/media/6549/cama_web-export-data-dictionary.pdf
- Indian River description limits: https://www.ircpa.org/media/10914/deed-information-002.pdf
- Brevard publications: https://www.bcpao.us/PublicData.aspx?t=1.2
- St. Lucie: https://www.paslc.gov/
- Martin: https://www.pamartinfl.gov/
- Okeechobee: https://www.okeechobeepa.com/
