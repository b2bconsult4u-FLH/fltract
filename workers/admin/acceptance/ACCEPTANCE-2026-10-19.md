# Authenticated release-candidate acceptance — October 19, 2026

Candidate parent: 14a57460229eb5e326e7b829c2f80ead8e18e1a1 (PR #24).

The owner requested completion of the remaining test while on the laptop. Secure email-code authentication succeeded; the protected dashboard rendered with the owner's existing Administrator account. No Access policies or production configuration were changed in this session.

## Real browser and preview D1

The review-only entry point serves the checked-in contact HTML/CSS at `/__review/contact`, enabling its existing submission handler only for this private page and mapping submission to the real intake handler using preview D1. Every review request first passes real JWT and staff checks. POST additionally requires the exact same origin, a maximum 16 KiB streamed body, a SYNTHETIC- location and an example.invalid email. The adapter maps that already-validated private origin to the canonical intake origin; production CORS and production public-form disablement are unchanged. No email binding is passed to this test handler; it does not send mail. Production uses worker.mjs, never review-worker.mjs.

Observed:

- Empty submit marks required fields and displays the validation message.
- First completed synthetic submit displays the actual confirmation modal.
- Submit Another Property retains contact information, clears county/location/property choices, and resets required acknowledgment.
- Second property submits successfully with a fresh acknowledgment and confirmation.
- Private CRM client page shows both property records and both inquiry histories under one client.
- A deliberately rejected fixture gets HTTP error text through the real form's error handler. Entered name, county, location and acknowledgment remain; submit becomes available again. The rejection occurs in the test-only adapter before persistence.

Read-only D1 verification after the two successful submissions:

| Inquiry | Property | Client | Report | Queue | County |
| --- | --- | --- | --- | --- | --- |
| 17 | 17 | 17 | 25 | 17 | Indian River |
| 18 | 18 | 17 | 26 | 18 | St. Lucie |

Both queues were Queued and both reports Needs Research at intake verification. Consent version FLTRACT-CONSENT-2026-09-27-V1, timeframe, owner status and distinct source locations persisted. Optional marketing/call permissions remained false. Locations explicitly identify synthetic non-parcels; parcel and source facts were not invented. Mail-log failures for these four attempts are expected because the test intentionally omits SEND_EMAIL; this is not a mail-delivery acceptance claim. Earlier controlled delivery evidence remains in the intake closeout documentation.

## Live test exposed and repaired an approval-lock defect

To test an already-open draft form, report 25 was explicitly marked as a synthetic approval-lock fixture through preview D1, with summary/limitations stating that no researched property, valuation or actual human approval exists. The initial stale Save Mini-Comp Draft incorrectly overwrote the Approved state. This was a real defect, not a passing check.

The save route now rejects already-approved reports and conditionally updates only non-approved reports, returning 409 before queue/work/library effects if the update loses the race. Comparable additions and deletions now use transactional conditional mutations so approval after the initial read prevents changes. Approved pages disable Add Comparable and Save Mini-Comp Draft.

Three new real-SQLite regression tests exercise normal draft writes plus already-approved and approval-after-read rejection for save/add/delete. They compare complete report/comparable/queue/activity state and check that rejected operations cause no downstream completion/library calls. All 130 tests pass.

Repeated live stale-form test against repaired preview version b52cf8ca-7c58-4614-af72-e4c0f0150955 returned the visible refusal: Approved reports cannot be changed through a draft form. D1 read-back confirmed report 25 remained Approved with the exact synthetic fixture summary. Reloaded page displayed disabled draft-save controls. This fixture remains test-only and must never be presented as a real approved report or copied into production.

Evidence images: confirmation-2026-10-19.jpg and approved-refusal-2026-10-19.jpg. October 18 narrow-screen evidence remains applicable to the same public form and candidate-table layout. This session used a desktop cloud browser, not a physical Safari/iPhone device.

## Release boundary

These remaining release-candidate interaction checks are complete after the approval-lock repair. Production-target deployment, owner-only live-site restriction and post-deployment smoke checks are separate operations; no production launch is claimed. The article/blog publishing component discussed with the owner is also still in project scope; this acceptance covers the existing intake/CRM/mini-comp build only.
