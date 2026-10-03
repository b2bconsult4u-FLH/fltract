# Business access-control foundation

Built October 3, 2026. Not deployed and not a security certification. This shared core is independent of property/comparison modules. It does not alter public intake or deploy a login page. Existing production admin source is absent from this repository; wiring remains mandatory before claiming live protection.

## Roles and additional access points

| Starter role | Default business permissions | Record scope |
|---|---|---|
| System administrator | Users, roles, settings, access audit | Business; no automatic client/finance access |
| CEO | Business oversight, CRM, reports, tasks, financial view/approval, audit | Business |
| CFO | Financial view, preparation and approval | Business |
| CFO administrative assistant | Financial view and preparation | Assigned financial records |
| Mid-level manager | CRM, reports and tasks | Team |
| Employee | Client view/edit, report view, task view/edit | Assigned records |

No role receives exports by default. Permanent record deletion is not a permission. Roles are independent, not an inherited ladder. Multiple roles may be assigned to one member. Customers can add named custom roles and team memberships; no six-role or staff-seat limit is imposed in this schema. A permission catalog validates grants. Additional modules extend this catalog deliberately, with tests; they cannot invent unrestricted wildcard grants.

The authorized actor can only delegate permissions already held at the necessary scope. Current own roles cannot be edited through saveRole, and own assignments/revocation are rejected. Initial owner provisioning and any broader grant than a business administrator currently holds are trusted operations outside customer-facing APIs. This deliberately does not let technical administrators silently acquire finance/export privileges. Finance approval permission alone does not implement a payment workflow or enforce separation between preparer and approver; finance modules must enforce those rules transactionally.

## Security database and authentication

Apply migration.sql to a new dedicated SECURITY_DB. Provision business IDs, users by verified provider issuer/subject, memberships, six starter roles (seedRoles), assigned roles and teams using a trusted provisioning path. seedRoles skips existing roles; it must not restore deleted custom grants. Do not identify accounts solely by user-supplied email addresses.

The host identity adapter must validate Google OIDC or Cloudflare Access authentication completely: signature and key rotation, issuer, audience, expiry, state/nonce and appropriate MFA/step-up evidence. startSession accepts only the adapter's verified server-side identity. A request header or JSON object is not verified identity. loginFromProvider requires a verifier; no permissive default is supplied. A real provider adapter and production Access policy verification remain deployment work.

Sessions use random opaque tokens, hashed in storage, eight-hour absolute expiry, Secure/HttpOnly/SameSite=Strict host-only cookies. Every authorization reads current session/membership and role grants; disabling a membership or changing a grant takes effect at the next check. There is no stale permission cache. Business identity comes from the session, never from an arbitrary business ID supplied with a record request. Invalid/unregistered resources fail closed.

All state-changing host routes must call requireSameOrigin, use POST/PUT/PATCH/DELETE and requirePermission before acting. Apply the same checks to logout and support operations. Login redirect/callback flow requires the provider's state/nonce safeguards separately; the POST helper is not a complete OAuth callback. Do not log cookies or tokens. Apply authentication endpoint rate limits/bot defenses before recording failures; recordLoginFailure takes safe internal references only. Failed authentication at Google itself is visible in provider logs, not automatically here.

## Record isolation and integration

Register resources through trusted ingestion/admin code, with business_id, kind, ID and optional team/assignee. Kind mappings are client for CRM, inquiry for reports, task for tasks, finance for finance. Both business ownership and scope are checked. Permission checks without a resource require a business-wide grant and cannot be used to retrieve an unfiltered list for team/assigned users. Lists require resource-filtered queries or per-record checks; do not fetch everything then rely on UI hiding.

crmAuthorizer provides the existing private card callbacks:

```js
const authorize = crmAuthorizer({ request, db: env.SECURITY_DB,
  permission: 'reports.view', kind: 'inquiry' });
const card = await miniCompCard({ inquiryId, env, authorize });
```

Use clients.view/client for clientAccount. Register inquiry and client ownership before exposing either. The existing clientAccount helper returns every inquiry linked to that client, so the host must maintain consistent client/inquiry assignments or replace that helper with a filtered, paginated reader before allowing narrower scopes.

The existing CRM/property/report schemas were built for one FLTract deployment. They have NOT been converted into a shared multi-business datastore by this migration. Until every underlying query and constraint is business-scoped, use a separate CRM/module database deployment per business. The host must select those database bindings from verified business configuration, never request input. Resource ACLs alone do not make unscoped shared CRM queries safe. Existing background report tasks remain single-business deployments too. A future pooled deployment requires migrating IDs, tenant keys, joins, queue task ownership and imports together.

## Owner recovery instead of a hidden back door

Platform owners are provisioned in platform_owners through infrastructure administration, never customer role management. Customer administrators cannot assign platform ownership. startOwnerSupport requires a fresh verified MFA authentication within five minutes and a written support reason. It issues a business-specific 30-minute session. The customer audit records support_started and support_logout/expired; reason is retained in support_sessions. Owner support can view CRM/reports/tasks, inspect audit and recover customer administrator access. It cannot export records, approve finances or edit customer records by default. Other developers receive no permanent owner authority automatically.

Recovery remains attributable to a named identity, and the role assignment operation is logged. No universal password, secret URL, bypass header or unlogged entry exists. Host support UI must display the support reason and customer-visible session history, document support access in customer terms, and permit access review. The UI/customer notifications are not connected yet. A compromised owner identity is still a serious risk; protect provisioning and provider accounts, and test recovery. No account design guarantees access through a provider outage or destroyed database: independent protected backups and recovery credentials are separate operational requirements.

## Event logging and speed

Events cover login, logout, expiry, revocation, failed application login, role changes/assignment and owner support. No keystrokes, page clicks, contact form payloads, passwords or session tokens are collected. UTC epoch milliseconds are stored; display in each business's timezone. Expiry uses the actual expiry time, not a fabricated browser-close logout. Run expireSessions and expireSupportSessions from an authorized scheduler; each processes at most 100 per invocation. No scheduler is deployed by this library.

Login/session mutation and their security events are transactional. On an audit storage failure, the sensitive operation fails closed rather than becoming unlogged. Ordinary read checks do not append events, update last_seen or scan the event table. SECURITY_DB is separate from CRM queries. Indexed session tokens, composite role/resource keys and bounded cursor-based audit pagination avoid full-history reads. The module adds no per-key or per-click writes.

Append-only SQL triggers block normal updates/deletes; infrastructure administrators can still change storage. This is not immutable external evidence. Decide retention and storage budget, then build protected archival/rotation with verified exports; automatic purge is intentionally absent so no retention duration is silently imposed. Audit detail access requires audit.view. Protect backups and test restoration separately. No performance guarantee is claimed: sustained/burst load, database contention, recovery and provider/session behavior must be tested on staging. Do not remove authorization checks to improve speed.

## Completion gates

Implemented: schema, starter/custom policies, scope checks, opaque sessions, audit, revocation, guarded role mutation/assignment, owner recovery, CRM authorization callback adapter and synthetic tests.

Not yet live: real Google/Access verifier, membership/role management UI, provider callback/logout/support routes, CRM deployment wiring and ownership backfill, scoped list readers, schedulers, log retention/alerts, backup setup and staging performance/security testing. Existing production remains unchanged.

Validation: `node --test core/access-control/tests/*.test.mjs core/client-identity/tests/*.test.mjs modules/property-records/tests/*.test.mjs modules/mini-comps/tests/*.test.mjs` on Node 24. Tests are synthetic SQLite and do not send email or change production records.

Design references checked October 3, 2026:
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
