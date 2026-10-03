# Intake connection repair and deployment

Prepared October 3, 2026. Not deployed. The public form in this branch targets the replacement `fltract-intake-5a25` Worker at `/submit`; the existing live form must stay on its legacy endpoint until the replacement is verified. Do not merge/publish this form first.

The Worker accepts all seven current form inquiry options, retains the four older canonical inquiry types for existing integrations, and supports Industrial/Commercial properties. Form contact choices match the Worker: Email, Phone, Either Email or Phone. Text contact is not offered. Phone is optional for email-only inquiries; a selected call preference requires a 10-digit number and explicit live-call permission. Both required acknowledgments are independent; optional marketing email and live calls are unchecked. A legacy combined consent boolean is not translated into those acknowledgments.

Timeframe, owner status, best contact time, referral source and source page are retained in the existing details column under Intake context, avoiding an unverified core schema migration. The received request is limited to 16 KiB and must be a JSON object or URL-encoded form. Multipart/uploads are rejected. Both old/new honeypot names are recognized. Validation errors leave form entries intact; second-property submissions retain contact details and require new consent review.

## Exact launch sequence

1. Confirm the Cloudflare account, replacement Worker, production D1 database ID and existing deployed bindings. Replace the configuration's DB ID placeholder. Export current Worker configuration/code and identify rollback version before changing anything.
2. Verify production columns used by the INSERT, consent_history, compliance_rules, activity_log and email_log. No schema or database ID is guessed. Confirm the sending domain and unrestricted-recipient Email Service binding are enabled; an Email Routing-only recipient-restricted binding is insufficient for arbitrary client acknowledgments.
3. Use module-aware Wrangler deployment from this directory; preserve any existing dashboard bindings/settings in the final configuration. All optional modules remain off in this initial connection repair. Do not enable clients, property records, reports or queue features without their migrations/bindings/data.
4. Deploy the replacement Worker first. Verify its health, CORS OPTIONS, denied invalid payloads and a clearly identified test intake saved into the protected CRM. Send a real acknowledgment only to an owner-approved test address. Do not test against a random person's address.
5. After that verification, publish contact/index.html and assets/js/property-records.js using the existing site's deployment mechanism. Retain prior form/version for rollback. Verify live browser validation, submission confirmation and second-property flow, with stored inquiry and email evidence.
6. Update the master checklist: built complete; connected/live checked only after deployed evidence. If any gate fails, keep the current public form endpoint unchanged and report the specific blocker.

## Current launch blocker

During this session Cloudflare's sign-in page displayed “There was a problem with verification. Please reload and try again.” One reload returned the same error. No authenticated deployment dashboard was reached. Production DB ID, schema, email settings and current Worker version cannot be verified through this blocked browser. No replacement deployment or public form switch has been performed.

## Validation

Run `node --test workers/intake/tests/*.test.mjs core/access-control/tests/*.test.mjs core/client-identity/tests/*.test.mjs modules/property-records/tests/*.test.mjs modules/mini-comps/tests/*.test.mjs` on Node 24. Tests use synthetic data, stubbed core DB/email and SQLite optional databases; no real email or inquiries are sent. Synthetic passing tests do not establish production schema compatibility or mail delivery.
