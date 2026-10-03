import { emptyReport } from './engine.mjs';
import { createRepository } from './repository.mjs';

// Durable initial placeholder attaches a report status to every enabled intake.
export async function queueMiniComp({ inquiryId, propertyKey = 'primary', env, repository }) {
  if (env.MINI_COMPS_ENABLED !== 'true') return { status: 'disabled' };
  if (!env.MINI_COMP_DB && !repository) return { status: 'unavailable', reason: 'mini_comp_database_missing' };
  try {
    const repo = repository || createRepository(env.MINI_COMP_DB);
    const job = await repo.job(inquiryId,propertyKey);
    const report = emptyReport(env.PROPERTY_RECORDS_ENABLED === 'true' ? 'waiting_for_property_match' : 'property_module_disabled');
    report.status = env.PROPERTY_RECORDS_ENABLED === 'true' ? 'waiting_property' : 'needs_review';
    await repo.append(job.id,report);
    return { status: report.status };
  } catch {
    console.error('Optional mini-comp initialization failed; inquiry retained.');
    return { status: 'unavailable', reason: 'mini_comp_queue_failed' };
  }
}

export async function afterPropertyResolved({ inquiryId, propertyKey = 'primary', result, env, repository }) {
  if (env.MINI_COMPS_ENABLED !== 'true') return { status: 'disabled' };
  if (!env.MINI_COMP_DB && !repository) return { status: 'unavailable', reason: 'mini_comp_database_missing' };
  let repo, job;
  try {
    repo = repository || createRepository(env.MINI_COMP_DB);
    job = await repo.job(inquiryId,propertyKey);
    const ready = ['matched','confirmed_property'].includes(result?.status) && result.record && !result.record.restricted;
    const report = ready ? await repo.generate(result.record) : emptyReport('property_match_requires_review');
    if (!ready) report.property_research_reason = result?.reason || 'property_not_matched';
    await repo.append(job.id,report);
    return { status: report.status };
  } catch {
    // Best effort: failure is reviewable, while the already-saved inquiry/receipt remains intact.
    try { if (repo && job) await repo.append(job.id,emptyReport('comparison_generation_failed')); } catch { /* Durable placeholder remains. */ }
    console.error('Optional mini-comp generation failed; inquiry retained.');
    return { status: 'unavailable', reason: 'mini_comp_generation_failed' };
  }
}
