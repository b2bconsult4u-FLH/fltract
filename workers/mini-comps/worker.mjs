import { createRepository } from '../../modules/mini-comps/repository.mjs';
import { emptyReport } from '../../modules/mini-comps/engine.mjs';

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
export async function processTask(taskId, env, { now = Date.now(), repository } = {}) {
  if (typeof taskId !== 'string' || !/^[a-f0-9-]{36}$/.test(taskId)) throw new Error('invalid_task_id');
  const db = env.MINI_COMP_DB;
  const token = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE mini_comp_tasks SET state='processing',attempts=attempts+1,
    lease_token=?,lease_until=? WHERE id=? AND attempts<? AND
    ((state='pending' AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?)) RETURNING *`)
    .bind(token, now + LEASE_MS, taskId, MAX_ATTEMPTS, now, now).first();
  if (!claimed) {
    const row = await db.prepare('SELECT state,attempts,lease_until,next_attempt_at FROM mini_comp_tasks WHERE id=?').bind(taskId).first();
    if (!row) throw new Error('task_missing');
    if (['completed','failed'].includes(row.state)) return 'ack';
    if (row.attempts >= MAX_ATTEMPTS && row.lease_until <= now) {
      await db.prepare("UPDATE mini_comp_tasks SET state='failed',last_error='retry_limit' WHERE id=? AND state!='completed' AND lease_until<=?").bind(taskId, now).run();
      return 'retry'; // Queue's configured dead-letter policy retains the message.
    }
    return 'retry';
  }
  try {
    const result = JSON.parse(claimed.result_json);
    const ready = ['matched','confirmed_property'].includes(result?.status) && result.record && !result.record.restricted;
    const repo = repository || createRepository(db);
    const report = ready ? await repo.generate(result.record) : emptyReport('property_match_requires_review');
    if (!ready) report.property_research_reason = result?.reason || 'property_not_matched';
    // D1 batch is transactional. Lease fencing prevents duplicate/stale report writes.
    await db.batch([
      db.prepare(`INSERT INTO mini_comp_reports(job_id,status,reason,report_json,created_at)
        SELECT job_id,?,?,?,? FROM mini_comp_tasks WHERE id=? AND state='processing' AND lease_token=?`)
        .bind(report.status, report.reason, JSON.stringify(report), new Date(now).toISOString(), taskId, token),
      db.prepare("UPDATE mini_comp_tasks SET state='completed',completed_at=?,lease_until=0,last_error=NULL WHERE id=? AND state='processing' AND lease_token=?")
        .bind(now, taskId, token)
    ]);
    return 'ack';
  } catch {
    await db.prepare(`UPDATE mini_comp_tasks SET state=?,next_attempt_at=?,lease_until=0,last_error='generation_failed'
      WHERE id=? AND lease_token=? AND state='processing'`)
      .bind(claimed.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', now + 60000 * claimed.attempts, taskId, token).run();
    return 'retry';
  }
}

export async function recoverTasks(env, now = Date.now()) {
  // Bounded scan and dispatch; pending work stays durable if queue sending fails.
  await env.MINI_COMP_DB.prepare(`UPDATE mini_comp_tasks SET state='failed',last_error='retry_limit'
    WHERE state='processing' AND attempts>=? AND lease_until<=?`).bind(MAX_ATTEMPTS, now).run();
  const rows = await env.MINI_COMP_DB.prepare(`SELECT id FROM mini_comp_tasks WHERE attempts<? AND
    ((state='pending' AND next_attempt_at<=?) OR (state='processing' AND lease_until<=?)) ORDER BY created_at LIMIT 100`)
    .bind(MAX_ATTEMPTS, now, now).all();
  for (const row of rows.results || []) await env.MINI_COMP_QUEUE.send({ taskId: row.id });
}

export default {
  async queue(batch, env) {
    if (env.MINI_COMPS_ENABLED !== 'true') { batch.retryAll({ delaySeconds: 300 }); return; }
    // Each invocation is bounded; queue consumer invocations scale independently.
    for (const message of batch.messages) {
      try {
        const action = await processTask(message.body?.taskId, env);
        if (action === 'ack') message.ack(); else message.retry({ delaySeconds: 300 });
      } catch { message.retry({ delaySeconds: 300 }); }
    }
  },
  async scheduled(_event, env, ctx) {
    if (env.MINI_COMPS_ENABLED === 'true') ctx.waitUntil(recoverTasks(env));
  }
};
