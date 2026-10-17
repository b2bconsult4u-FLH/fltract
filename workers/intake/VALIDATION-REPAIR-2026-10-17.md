# Intake validation repair — October 17, 2026

Built from main 628403046b77b3928cba1d25e177fe87008d0d49. This narrowly ports the still-needed protections from draft PR #7 onto the current intake implementation. It preserves current inquiry options, combined required acknowledgment UI, consent version, structured metadata fields, client/property linking and manager recovery. No production deployment, data write or real email was performed.

## Changes

- Enforce 16 KiB of actual streamed bytes for JSON and URL-encoded intake requests, canceling oversized streams. Reject malformed JSON and non-object JSON with 400, and oversized bodies with 413, before database/email activity.
- Recognize both current and legacy honeypot fields.
- Require explicit live-call permission for a phone contact preference and validate any supplied phone as ten digits. The browser checks optional phone fields too.
- Present server validation messages as plain text while retaining entries after failure.
- Keep PUBLIC_SUBMISSIONS_ENABLED=false. Preserve current production DB ID and bindings; do not restore PR #7's placeholder or older optional-module configuration.

- Add root static-site Wrangler configuration with the required previews block, preserving the deployed site compatibility date and observability. A deny-by-default .assetsignore publishes exactly the 14 existing public assets; Worker code, tests, dependency files, git data and internal documentation are excluded.

## Validation

120 tests pass through npm test (108 existing plus 12 regression tests). Includes real in-memory SQLite linkage/recovery/security tests and isolated browser-script tests. External email is stubbed; fixture addresses use example.invalid. Node syntax and git diff checks pass. Wrangler 4.149.0 deployment dry run bundles the intake successfully with DB and unrestricted SEND_EMAIL bindings. GitHub Actions also passed. Static-site dry run passes, and Wrangler debug output confirms exactly 14 public files survive asset filtering. Local Wrangler server could not start because this container denies network-interface enumeration (uv_interface_addresses); no local HTTP smoke result is claimed. These checks do not certify live delivery.

## Verified deployment state before repair

Cloudflare authenticated API reads work. fltractproduction ID f2ca6407-6d2d-4c7d-b7d2-5f6e8d96a274 matches main and the deployed replacement binding. Core inquiries, consent_history, compliance_rules, activity_log and email_log schema was inspected read-only. Replacement version daf0ab5f-c647-4aa5-a3a6-44077c11cff2 was deployed at 100% on October 13. October 4 email logs show successful acknowledgment/internal sends with provider IDs; this is historical evidence, not receipt verification for the current candidate.

PR #7 remains an old draft against feature/business-access-control-2026-10-03. Its October 3 site preview failed because npx wrangler preview lacked a previews block. It is not evidence that the replacement intake is still undeployed. This repair should be reviewed against main rather than merging the old draft wholesale.

## Remaining acceptance

1. Verify the candidate through a reachable HTTP/browser environment: health, allowed CORS, denied origins, malformed and oversized requests. Direct public probes from this execution environment returned 403/502 and are inconclusive.
2. Before promotion, capture active deployment/configuration and rollback version. Verify the candidate artifact and schema without enabling unrelated modules.
3. Perform one explicitly approved live intake/email test at a controlled address. Verify CRM inquiry, consent history, metadata, downstream linkage/recovery, acknowledgment receipt and internal notification.
4. Enable public submissions only after those gates pass; check live validation, error retention, confirmation and second-property flow.

## Production-schema compatibility acceptance — October 17, 05:56–06:00 Eastern

Re-read the five core production table definitions through a read-only sqlite_master query (zero rows written). Saved schema-only DDL as modules/property-records/tests/fixtures/intake-production-core-2026-10-17.sql. The SQLite integration test now uses this independent fixture rather than constructing a matching table from the Worker's INSERT columns. Production defaults, NOT NULL constraints and foreign keys therefore participate in acceptance.

The expanded integration test verifies all four current form inquiry options; dedicated timeframe/ownership/contact/source fields; unmodified details; required consent snapshots and separate live-call/marketing selections; client continuity; distinct property/mini-comp artifacts; logged customer/internal mail status; preservation of saved inquiry/consent on injected mail-provider failure; and no email after a real SQLite trigger rejects the core insert. Foreign-key checks pass. All test writes occur in an in-memory database, and email sending is stubbed.

This completes isolated core schema/intake compatibility acceptance. It does not verify D1 runtime behavior, live delivery, signed-in CRM rendering, or browser layout. The protected preview browser sign-in failed with “Unable to sign in” after Google account selection; the public contact URL returned a 502 in that browser. Those visual checks remain blocked, and public submissions remain disabled.

## Mini-comp review integration milestone — October 17

Integrated the candidate qualification work from PR #23 (cd9e483acb032375679e389d60626580cacf53bc) into this release candidate. Staff with research permission and record scope can review an imported sale as Yes/No/Unknown with evidence, preserving the original source fields and month-only sale date. Approved reports suppress review/removal controls. The existing three-qualified-sales and verified-subject approval gate remains intact. Production admin Access settings and hourly deadline checks are preserved; preview admin config uses the separate preview DB and restricted email destination.

Expanded isolated acceptance covers incorrect Origin, invalid qualification, missing evidence, candidate/report mismatch, reviewer attribution, preservation of source/date/price/parcel fields, approved-report refusal, and authenticated Employee/Manager scope denial. Found and fixed an approval race: report approval between the initial read and form parsing previously permitted a review write. The transactional candidate update now rechecks the report state and returns 409 without a completed-review activity entry if approval won the race.

Full combined suite: 122/122 passing locally. Admin Worker syntax and deployment dry run pass. This completes implementation/integration acceptance for candidate qualification; it is not live UI acceptance, promotion, or whole-project completion. Browser access and controlled live email receipt remain the release gates already listed above.


## Controlled live email acceptance — October 17, 07:30 Eastern

Uploaded intake test version e54a0265-712b-4890-9657-d11ae9ad826c, built from the same repaired intake bundle as 13444f0. It binds only to fltract-preview D1 and restricts SEND_EMAIL to b2bconsult4u@gmail.com and fltractoffice@gmail.com. No production traffic was assigned. Do not promote this test version with preview bindings.

One-time GitHub push workflow run 39028978657 passed. Synthetic preview inquiry #2 (SYNTHETIC-EMAIL-PR24-39028978657-1) saved with complete client/property processing. Both acknowledgment and internal office notification were Sent with provider message IDs and no failure reason.

Actual acknowledgment receipt verified through connected B2B Gmail: message 1a149a11aa972509, dated 2026-10-17T11:30:55Z; Gmail received it at 11:30:57Z. Its Message-ID exactly matches preview email_log. Gmail Authentication-Results reports SPF, DKIM and DMARC pass. This establishes real receipt, not merely API acceptance.

The internal office notice is provider-accepted, but direct office inbox receipt is not yet verified because that mailbox is not connected. Cloudflare emailSendingAdaptive currently returns no delivery events for the test window, so no delivered event is claimed. Desktop/mobile signed-in acceptance remains blocked as previously documented. Production Worker versions, production data and public submission disablement are unchanged.

The live-email workflow runs only when this branch receives a change to its dedicated script with the exact explicit one-time commit message. Unrelated pushes do not send live test email. Foundation CI also passed on 57bd84b.
