import { createRepository } from './repository.mjs';

// Persist payload before sending: queue outages are recoverable without another intake.
export async function enqueueComparison({ inquiryId, propertyKey, result, env, repository }) {
  const repo = repository || createRepository(env.MINI_COMP_DB);
  const job = await repo.job(inquiryId, propertyKey);
  const taskId = crypto.randomUUID();
  await env.MINI_COMP_DB.prepare(`INSERT INTO mini_comp_tasks
    (id,job_id,result_json,state,attempts,next_attempt_at,created_at) VALUES (?,?,?,'pending',0,0,?)`)
    .bind(taskId, job.id, JSON.stringify(result), Date.now()).run();
  try {
    await env.MINI_COMP_QUEUE.send({ taskId });
    return { status: 'queued' };
  } catch {
    return { status: 'queued', reason: 'dispatch_pending_recovery' };
  }
}
