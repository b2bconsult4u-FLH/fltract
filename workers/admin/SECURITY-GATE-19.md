# Issue #19 — security validation, 2026-10-12

Status: OPEN pending live owner-session validation. The review branch now implements origin JWT verification, all-route capabilities, record/list scope, disabled automatic bootstrap, and persistent attempt/completion audit. This review does not certify production secure. Main reviewed: c38bddc73632f840e11c6d995a82c59bb1522129; admin blob f9f98484da129697f8a25a8b268e799fe5782572. No production accounts, data, or Access policies were changed. Development updates below supersede the original findings.

## Confirmed production configuration

- Worker: fltractadmin-fb08; workers.dev and preview URLs both enabled. Current 100% deployment version: b15de794-5434-4ae5-a68a-23e8fca0f855, deployed October 11 at 12:32 UTC. Deployed source has not been downloaded/compared byte-for-byte with main.
- No custom domain for this Worker and no Worker route in any of the 11 zones returned by the connected account. Repository wrangler.jsonc also declares no route. This inventory cannot establish the configuration of other accounts.
- Access app 2c4ee030-b0e6-4a46-a0f6-62e41ca6e562 targets a Worker destination. Its sole returned policy allows Cloudflare account members; no bypass policy was returned, and no additional require condition is configured. Session duration is six hours. This is an account-members policy, not a dedicated FLTract staff allowlist or explicit MFA requirement. Account enforce_twofactor is false; this does not prove the owner's actual MFA status.
- JWT issuer to configure: https://b2bconsult4u.cloudflareaccess.com. Application audience: 4312260f76753fb5e3464d1696f75069a27536a21048ae819ac63e79b46f198b. Worker bindings currently contain only DB and SEND_EMAIL.
- Read-only D1 aggregate confirms one active Administrator with bootstrap_admin=1. Preserve this existing row. No staff identity or client records were retrieved.
- Twelve curl GET probes: /, /clients, /export.csv, /intake-recovery, /security-audit, /inquiry/1, each anonymous and with synthetic spoofed email plus invalid JWT, returned HTTP 302. Root HEAD confirmed redirect to the expected Access login. No redirect was followed; no write or email endpoint was exercised live. An earlier urllib probe returned generic 403 and was not used as evidence of Access behavior.
- Current-version preview host b15de794-fltractadmin-fb08.b2bconsult4u.workers.dev returned 302 for anonymous and spoofed root GETs. Other preview versions and private preview paths remain untested; do not generalize these two probes to all preview coverage.

## Exact code gaps and minimal repairs

| File / function or route | Verified gap | Minimal repair |
|---|---|---|
| worker.mjs accessIdentity / staffContext | Email header is accepted without JWT verification. Empty staff table gives the first supplied identity Administrator. | Validate Cf-Access-Jwt-Assertion signature against configured issuer JWKS, pin issuer and audience, enforce expiration/not-before and an email claim, derive identity only from verified claims. Use a maintained JWT library (Cloudflare documents jose). Remove header fallback. Disable bootstrap once initialized; any future bootstrap must require an explicitly configured verified owner email and atomic insert. |
| worker.mjs fetch entry | Schema initialization and private handlers can run without authentication. Anonymous / returns private dashboard HTML in an isolated execution. | Verify identity before schema work; require a registered active user and admin_access before any private handler. Fail closed on missing config, invalid JWT, unknown/inactive staff. Keep scheduled processing separate from interactive authorization. |
| worker.mjs inquiry/client/property/report handlers | staffCan exists but is scarcely enforced. Anonymous, Employee and CFO all perform same-origin status updates in isolated tests despite lacking edit_clients. Referral-send, research, report approval and most reads have no capability guard. | Central explicit method/path capability map, then object-scope guard before querying sensitive data or mutating records. Return 404/405 for unmapped routes/methods instead of falling through to the main inquiry list. |
| worker.mjs staffHasClientScope / staffHasPropertyScope | Helpers are defined but not invoked by route handlers; a comment explicitly defers global filtering. Lists and exports expose global records to roles permitted to open the page. | Enforce existing scope helpers for individual records; resolve inquiry/library IDs to their client/property before access; filter list SQL, dashboard counts, follow-ups and routing summaries by assignment/team scope. Administrator/CEO retain existing broad scope. |
| worker.mjs securityManagerAuthorized | Actual Administrator role is absent from allowlist. | Add administrator to existing list; this narrow fix is included on the review branch, with active/inactive regression checks. |
| worker.mjs logStaffAccess / denyAndAudit / activity_log | Audit failures are silently swallowed; legacy writes often log action text without verified actor. There is no general successful private-access audit. | Structured denial/request-completion audit with verified actor, method/path, outcome and correlation ID; never log JWTs or tokens. Surface audit-write failures. For privileged writes, pair mutation and audit atomically in a D1 batch where supported. Distinguish attempted operations from committed success. |
| worker.mjs appendAuditEvent / verifyAuditChain | Hash chaining reads latest hash then inserts separately; concurrent requests can fork the chain. Hash input uses full reason but stored reason is truncated to 1000 characters. | Canonicalize stored values before hashing; serialize chain appends or replace the chain integrity claim with an appropriate concurrency-safe design. Access audit alone does not fix these integrity claims. |
| worker.mjs sameOriginPost | Origin mismatch can fall through to an acceptable Referer or Sec-Fetch-Site. This check is CSRF defense, not authentication. | Reject a present mismatching/malformed Origin immediately; use fallback only if Origin is absent. Keep this check in addition to JWT/authorization. |
| wrangler.jsonc / deployed Access settings | No declared JWT issuer/audience, route exposure policy, or observability. Preview exposure is enabled. | Add issuer/audience and observability as code. Preserve workers.dev as it is the current administrator entry point. Disable previews if unnecessary, or explicitly prove their Access coverage. Do not disable workers.dev until a replacement protected login is verified. |
| .github/workflows/fltract-foundation-tests.yml | Push coverage targets an old integration branch; current wildcard runs property tests only. | Add main push coverage and explicit admin security acceptance tests; convert characterization cases to expected 401/403/no-side-effects assertions after repairs. |

## Minimum route permission map to implement

All entries require verified identity, active registered staff, and admin_access. Record scope is required in addition to the capability, including report/library/inquiry parent lookup. Enumerate exact existing routes in code; this table groups them for review.

| Routes | Required capability / boundary |
|---|---|
| /, /clients, /client/:id, /property/:id, /inquiry/:id, /followups | view_clients plus scoped records and scoped aggregate counts |
| /inquiry/:id/status, note, archive, restore; /property/:id/update | edit_clients plus record scope |
| /inquiry/:id/followup and follow-up management | manage_followups plus inquiry scope |
| /inquiry/:id/permission and consent/compliance reads | Explicit compliance-write permission decision; view_compliance alone must not silently authorize writes |
| /inquiry/:id/referral | prepare_referrals plus inquiry scope |
| /inquiry/:id/referral-send | approve_referrals plus inquiry scope; review approved prepared referral before email |
| /property/:id/official-research; mini-comp save/comparable/delete | research_property plus property scope |
| /property/:id/mini-comp, report, library; /library/item/:id, /library/version/:id | review_reports plus parent property/client scope |
| /property/:id/mini-comp/approve | approve_reports plus property scope |
| client/property assignment create/end | manage_assignments plus authorized client/property/team scope |
| /export.csv | export_data; current integrityAuthorized incorrectly permits Manager/CFO relative to staffCan matrix |
| /security-audit | view_audit or a documented narrower security-administrator permission; include Administrator |
| /intake-recovery | Explicit manager recovery permission; existing role rank also admits CFO. Retain manager recovery behavior while reconciling intended roles |
| /work-routing and task history/progress | Scoped manager or current assignee; manager-only deadline/redirect/run/check-deadlines |
| /training, /training/start, /my-work, /sops acknowledgement | Own authenticated user; manager views/actions retain explicit manager checks |
| /integrity, /dry-run, /sops/manage, training management | Explicit existing privileged checks, with subject scope where production records are read |

## Checks and safe rollout

Existing suite: 34/34 passed after retrieving its contact-page fixture; Worker syntax passes. Added eight isolated checks execute production functions/Worker against synthetic DB doubles: seven reproduce unresolved gaps, one verifies the narrow Administrator role repair. Passing characterization tests are NOT security acceptance. No live writes, staff bootstrap, referral send, or client-data fetch was used.

Before closing #19: configure verified issuer/audience; preserve the existing Administrator row; complete a staging matrix for anonymous/spoofed headers, invalid signature, wrong issuer/audience, expired/future token, unknown/inactive staff, permitted Administrator, lower roles, unassigned IDs and every private read/write method. Assert denied requests cause no business write, email, bootstrap or sensitive read; assert expected denial audit. Validate key rotation/JWKS failure and audit-storage failure behavior.

Verify the owner can still log in, read assigned/global records as intended, access audit, and complete an approved synthetic operation through the current URL. Confirm preview/custom-route coverage independently. Only then deploy the full gate and permissions; retain rollback version and repeat read-only live denials plus an authorized session smoke test. This review branch changes no Access policy or deployed Worker, so current administrator login remains intact.

References: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ ; https://developers.cloudflare.com/workers/best-practices/workers-best-practices/


## Development update — October 12

Implemented in worker.mjs and new security.mjs:

- Pinned jose 6.2.12 verifies RS256 signature, issuer, audience, expiration, not-before, issue time, subject and email. Header email is ignored. JWKS resolvers are cached with bounded cardinality; no identities are cached. JWKS outage fails closed.
- Gateway authenticates before DB access, requires an active existing staff account, then matches explicit method/path capabilities and record scope. Automatic first-identity bootstrap is removed. Existing Administrator row and broad Administrator/CEO record access are preserved.
- Existing assignment policy now filters inquiry dashboard/counts, client directory, follow-ups and work lists. Unassigned inquiry/client/property/library/task IDs are denied before handlers. Global integrity/dry-run/export are restricted until a scoped implementation exists. Manager intake recovery and management routing retain explicit management access. Employee researchers receive report-read capability to view their own scoped research, without approval rights.
- Present Origin mismatch is an immediate rejection; Referer/Fetch-Site fallback applies only when Origin is absent.
- A registered Administrator can open security audit. CFO no longer receives generic task-manager privileges from trainingManagerAuthorized.
- Durable actor/correlation/route audit attempt must succeed before business changes. Denials and completions are recorded. Authentication denials are structured logs without DB access or trusting spoofed actor headers. Legacy audit errors and completion-audit failures are visible structured incidents. A completion audit failure preserves the already-completed response to avoid inducing duplicate writes; this remains a documented limitation of the legacy non-atomic handlers.
- Audit chain insert compares predecessor inside the atomic INSERT and retries contention; hashes use the stored truncated reason. Real SQLite concurrency and long-reason verification tests pass. Historic audit rows are not rewritten.
- wrangler config declares issuer/audience, keeps workers.dev login, requests previews disabled at production deployment, and enables observability. Version-only upload does not apply these route-exposure settings. CI installs locked dependencies, covers main and runs the security suite.

Validation: 89 tests pass (34 existing, 55 security). Coverage includes 56 concrete private route variants with anonymous and forged JWT denial before DB access, bad signature/issuer/audience/time claims, unknown/inactive staff, owner read/write, role denial, unassigned IDs, real SQLite list rendering excluding hidden rows, audit outage before mutation, and concurrent hash-chain insertion. Wrangler 4.149.0 dry-run bundles successfully. These tests use synthetic identities and data, never a forged production JWT or production write.

Remaining gate: verify a real owner Access session against the uploaded candidate, verify operational error/audit handling, and then promote the tested version and apply production preview/observability settings. No claim of full production acceptance is made until that owner session succeeds. Existing policy has no explicit MFA requirement; application JWT/registration checks do not change the identity-provider policy.
