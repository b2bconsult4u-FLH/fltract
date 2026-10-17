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
