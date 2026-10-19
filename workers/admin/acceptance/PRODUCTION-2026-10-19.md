# Owner-only production deployment — October 19, 2026

Owner authorized restricting the live website to their email, deploying the tested build and checking production. PR #24 merged at 6ab7082a8897b53e39fe33b4f329b3a97a70bcd7. All three Cloudflare connected builds successfully deployed that commit.

| Worker | Prior rollback version | Active deployed version |
| --- | --- | --- |
| fltract | 64edbe0f-f61f-403c-a241-e40c7399e55e | 858c6a06-a558-4ef7-b683-0f3d80d207d6 |
| fltractadmin-fb08 | f2d85201-a1c0-4c09-ade2-9c5142d209b4 | bbf603be-0be6-4e80-b75a-0aeb67552b3f |
| fltract-intake-5a25 | daf0ab5f-c647-4aa5-a3a6-44077c11cff2 | ba3a2c87-d72f-48c8-aebc-869158b50e81 |

Active admin and intake VERSION resources (not latest-upload settings) were read back. Both bind production D1 f2ca6407-6d2d-4c7d-b7d2-5f6e8d96a274 and unrestricted existing SEND_EMAIL. Admin retains its original production Access audience 4312260f76753fb5e3464d1696f75069a27536a21048ae819ac63e79b46f198b. Admin schedules remain hourly deadline checks, daily 13:00 UTC and five-minute mini-comp research; intake retains its fifteen-minute retry schedule. No preview-bound version was promoted.

The apex domain is attached to the separate fltract-public-boundary Worker, version 7e9ecc8d-ff26-4922-8009-937f2fbb0181, which retains a deny-by-default path allowlist and ASSETS service binding to fltract. That boundary version was not changed. Its direct workers.dev endpoint remains disabled. fltract's connected build enables its workers.dev address, which is covered by the new Access application.

## Temporary owner-only Access application

Application 5dcf931e-2d1c-4050-9cdf-82cd5b4fa061 (FLTract Owner-Only Live Review), audience 021541bd6ba0ef6bd7119acd93218c888722e8345abb3bcd3e5211fdb1ba6c53, protects the apex and www hostnames plus the fltract and fltract-public-boundary Workers. Its sole application-specific policy 1f7accd8-bd5c-438e-9a3e-df6fa75967fd allows exactly b2bconsult4u@gmail.com and requires the existing email-code provider 101c7c09-c6b4-41d9-aab0-f46bb687a258. Session duration is six hours; the restriction itself persists until removed. The production admin and preview Access applications and shared account-member policy were not changed.

Initial multi-domain sign-in attempted a callback through www.fltract.com, which had no DNS/custom-domain mapping. Eager cookie redirects were disabled, and www was mapped to the existing public boundary Worker under the same owner-only Access protection. New custom domain ID bb2849e732753dbd968b51adc01bc4d6db4dd2bf. The apex mapping was preserved. No additional public content or private admin route was exposed.

## Verification and remaining check

- Anonymous apex contact and direct fltract Worker requests redirect to Cloudflare Access.
- Anonymous admin and a spoofed email/invalid-JWT admin request redirect to Access rather than returning private content.
- Authenticated apex /contact/ rendered in the browser using the existing owner email-code session. Clicking submit displayed the unchanged Submission is not yet active hold. No production inquiry was submitted.
- Intake GET / returned 200 ready with the expected consent version. Its health response advertises backend submission support; the launch hold is in the public form, not a claim that the endpoint is disabled.
- Read-only production D1 counts were 10 inquiries and 1 property, consistent with retained historical manual tests. No backfill, deletion or synthetic preview fixture copy was performed.
- Production-admin signed-in smoke remains incomplete. The unchanged Cloudflare account-member provider led to Google account selection, then Cloudflare visibly returned Unable to sign in. Try again or use your email and password. The attempt stopped without a retry loop or policy relaxation. Do not claim authenticated production CRM acceptance.
- The ordinary anonymous HTTP preflight expects a public 200 site and will intentionally encounter Access redirects during this temporary restriction. Its last passing run predates the restriction; do not treat that as authenticated production content verification.

Rollback production code by re-reading current deployments, then restoring the recorded prior versions while preserving production bindings and schedules. To remove the temporary website restriction at launch, remove only this new Access application/policy after final verification; do not edit the shared account-member policy or delete the account-level email provider. The new www custom domain can remain as a protected/public alias or be removed independently if explicitly desired. Public form enablement and the article/blog publishing component remain separate work.

## Production admin authentication completed — 14:18 UTC

This supersedes the incomplete admin-login status above. After both Google and direct Cloudflare dashboard login returned errors, the owner explicitly approved adding the same exact-email code method to production admin. Created reusable policy 7bc0b8b0-f521-4890-8b82-8152127e774c, allowing only b2bconsult4u@gmail.com AND requiring email-code provider 101c7c09-c6b4-41d9-aab0-f46bb687a258, six-hour duration. Attached it at precedence 2 only to production admin application 2c4ee030-b0e6-4a46-a0f6-62e41ca6e562 and added that existing provider to allowed_idps. Original account-member provider/policy, Worker destination, audience, six-hour duration, HttpOnly/binding-cookie/preflight settings were preserved. The shared account-member policy was not edited.

Fresh navigation to the exact production admin hostname successfully rendered the dashboard using the existing owner email-code session. Security & Audit also rendered and recorded the owner as Administrator, with a completed dashboard visit. No new code request was necessary. No customer or historical-test record was edited. Screenshot: production-admin-2026-10-19.jpg. The signed-in production-admin smoke blocker is resolved; public form submission enablement is still outstanding.

Authentication rollback: detach only policy 7bc0b8b0-f521-4890-8b82-8152127e774c from production admin and remove only the email-code provider from its allowed_idps, preserving the original policy/provider and all other settings. Do not delete the account-level provider. The policy persists until explicitly removed; six hours is the session limit, not automatic expiry.

## Live form enabled for owner test — 14:29 UTC

Owner explicitly requested enabling the form. PR #25 merged at a2b4189ee5fe4eef27f9b67d8a54313ad56798c8; static Worker version 1f165a09-1035-411a-bc97-684338f8994f deployed at 100%. This supersedes the earlier public-form hold statements. The site remains behind the same exact-email Access policy; it has not opened to the public.

Candidate checks passed all 14 content checks and all 130 tests. GitHub Foundation run 39269163815 and preflight run 39269163839 passed. Source preflight now requires explicit --intake-enabled for enabled state. The temporary workflow uses --live --expect-access, requiring anonymous HTTP 302 to the exact account Access login origin for all 19 paths; it does not substitute for protected-content or origin-404 inspection. Default public-content checks remain available when the Access restriction is removed.

Fresh authenticated /contact/ loaded the enabled source. An empty submit now displayed Please complete the fields marked in red rather than the former launch-hold message. No production inquiry or email was generated. Exact-email Access policy was re-read after deployment. Screenshot: form-enabled-2026-10-19.jpg. Owner's completed live inquiry and receipt verification are the next step.
