# Dedicated private Mini Comps processor

Default off, not deployed. This optional Worker processes queued comparison tasks independently of intake. It adds no public HTTP handler and sends no client emails. Reports retain their existing inquiry/account relationships.

## Capacity and reliability

Initial configuration: five concurrent consumer invocations, five messages per batch, sequential generation within a batch. This is an initial database-protection setting, not a demonstrated throughput guarantee or five human staff. Increase concurrency only after measuring D1 contention, end-to-end report latency, incoming task rate and queue age. Cloudflare scales consumer invocations up to the configured limit.

Intake first persists the matched-property result in a D1 outbox, then sends only its task ID to Queues. Queue publication failure leaves the task pending. A five-minute cron recovers up to 100 due tasks per run; duplicate delivery is safe. Each task gets at most five generation attempts with increasing delays. A five-minute lease and transactional fenced report/completion writes prevent overlapping consumers from appending duplicate reports. Completed results stay in report history. Failed tasks stay in the database for review; queue deliveries also use a configured dead-letter queue. Generation failures do not replace successful intake or existing report cards.

Generation is retried against the latest complete dataset, rather than pinning one dataset version. A new authorized property review creates a new task/report version. Source ingestion and property matching remain separate from this processor; this change does not guarantee either upstream stage's capacity.

## Activation order

1. Provision the actual MINI_COMP_DB, apply `modules/mini-comps/migration.sql`, then `modules/mini-comps/queue-migration.sql`. Bind this same database to intake, processor and private admin.
2. Create queues `fltract-mini-comps` and `fltract-mini-comps-failed`. Replace the database ID placeholder in `wrangler.jsonc` with the provisioned ID. Provision enriched, verified county data as described in the module README.
3. Add a producer binding named `MINI_COMP_QUEUE` to the replacement intake Worker pointing at `fltract-mini-comps`. This binding belongs in that Worker's actual deployment configuration; it is not present in the legacy live deployment automatically.
4. Deploy processor from this directory using Wrangler, set its MINI_COMPS_ENABLED to true, and verify queue consumption/cron. Leave intake queue mode off until the consumer is verified.
5. Set intake MINI_COMPS_ENABLED=true, PROPERTY_RECORDS_ENABLED=true and MINI_COMP_QUEUE_ENABLED=true. Queue mode has no inline generation fallback: missing queue binding produces a reviewable failure rather than silently loading the intake Worker. Default queue flag off preserves the earlier implementation.
6. Verify an intake's queued task, generated report and private account presentation, including a forced send outage, retry, duplicate delivery and exhausted failure. Test sustained and burst traffic against a staging database before increasing concurrency. No production performance/load test has been run.

## Operations

Track queue oldest-message age/backlog, success/error rate, D1 latency/contention, task states and dead letters. The automatic recovery limit is 100 per five minutes; raise it only after observing sustained recovery backlog. No automatic alert destination is connected yet. These read-only queries support an authenticated operations screen or dashboard:

```sql
SELECT state, COUNT(*) AS tasks, MIN(created_at) AS oldest_created_at
FROM mini_comp_tasks GROUP BY state;
SELECT id, job_id, attempts, last_error, created_at
FROM mini_comp_tasks WHERE state='failed' ORDER BY created_at;
```

For a reviewed, repaired failure, an authorized operator may reset that task to pending with attempts=0, next_attempt_at=0, lease_until=0 and lease_token=NULL. The cron dispatches it. Never reset completed tasks to retry; use a new task when intentionally generating a new report. No public retry or manual review endpoint is added.

Disable intake queue production first, drain/review pending work, then disable the consumer. Disabling a consumer while still producing tasks will build a backlog and can move repeated deliveries to dead letters. The D1 tasks remain durable. To remove this optional deployment, remove the queue-mode block and dispatch import from intake-hook.mjs, then remove dispatch, queue migration and this Worker after preserving operational history.

Run all three test suites on Node 24; queue tests use synthetic SQLite data and stubs, not live Cloudflare resources.
