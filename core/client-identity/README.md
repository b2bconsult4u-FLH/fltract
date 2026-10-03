# Persistent client and inquiry references

Built October 3, 2026. **Not deployed; client linking defaults off.** This is reusable core identity infrastructure, independent of the optional property/comp modules.

## Behavior

Each client record has a stable database ID and opaque UUID. FLTract displays it as `FLT-C-000123`. Each already-saved property inquiry keeps its own ID, displayed as `FLT-I-000456`. Prefixes are customer configuration; keep them stable once references are issued. References are identifiers, never passwords or account-access credentials.

The additive `inquiry_client_links` table connects inquiries to clients. Property-record and mini-comp histories already use inquiry IDs, so they remain attached without rewriting reports. `clientAccount` supplies the private CRM with a client and its linked inquiry records after the host explicitly authorizes the account read. Production admin-page wiring remains necessary; this does not create a public client login/portal.

First intake creates a client. Its response includes client/inquiry references and a signed, contact-bound continuation token. The form keeps that token only in JavaScript memory and resubmits it for another property during the same session. A valid token with unchanged name/email links the second property to the existing client; it never grants permission to read private account data. Token lifetime is 24 hours and refreshing/reopening the page clears browser continuity.

Matching email addresses—even with matching names—are **not** enough to merge people. An independent submission creates another client record, flags review, and records possible existing client IDs privately. Invalid/expired tokens or changed name/email likewise create separate reviewable records. Recognizing returning clients across independent sessions needs verified identity or an authorized CRM review/link workflow; neither is implemented here. Review flags/candidate IDs are not returned publicly. A signed token preserves submission continuity, not proof of the person's legal identity.

Existing inquiry linking is idempotent. New client, link and audit-event writes are one D1 transaction to avoid orphan clients. The core inquiry is saved first; failed/missing client configuration does not lose intake, acknowledgment or consent. Primary contact details are not silently overwritten. Original per-inquiry contact and consent snapshots remain authoritative for that inquiry.

Acknowledgment text/HTML includes the client reference when available and the inquiry reference. The signed continuation token is returned only in the submission response; it is not emailed, logged or stored in Library/GitHub. The successful form notice displays references with escaped/plain text. The current live `/intake` endpoint remains unchanged; it must support this response contract before live references/session linking will work.

## Activation

1. Apply `migration.sql` to the existing core D1 `DB` (`fltractproduction`) after confirming its existing `inquiries(id)` schema. The migration adds tables/indexes and preserves original tables/history.
2. Configure a cryptographically random secret with at least 32 bytes as the Worker secret `CLIENT_CONTINUATION_SECRET`. Do not commit the real secret or log it. Rotation invalidates previously issued continuation tokens.
3. Set `CLIENT_IDENTITIES_ENABLED="true"` only after deployment/migration verification. Optional `CLIENT_REFERENCE_PREFIX="FLT-C"` and `INQUIRY_REFERENCE_PREFIX="FLT-I"` defaults preserve the approved FLTract reference scheme.
4. Deploy the replacement intake with all module imports. Repair/verify the existing live form-to-Worker endpoint/field mapping before switching the form.
5. Wire the authorized private CRM client account page and its inquiry links; each inquiry then loads its own existing property/mini-comp reports. Authentication is mandatory; a submitted client number or continuation token does not authorize a read.

No historic inquiries are automatically merged or rewritten. A future authorized backfill/review task can attach older records using documented identity evidence. Unlinked legacy/failed-link inquiries remain visible in the original CRM. A failed-link recovery runner and reviewed client-merge operation are not included yet.

## Verification

Run `node --test core/client-identity/tests/*.test.mjs modules/property-records/tests/*.test.mjs modules/mini-comps/tests/*.test.mjs` on Node 24. Synthetic tests cover distinct IDs, second-property continuity, shared emails, tampering/expiry/contact changes, idempotency, transactional rollback, unchanged consent, disabled/missing configuration, authorized account reads and receipt/reference behavior. No live inquiries or emails are sent. Production browser behavior, migration and deployment remain unverified.
