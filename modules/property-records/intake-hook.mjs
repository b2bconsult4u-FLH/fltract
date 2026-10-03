import { text } from './record.mjs';
import { createRepository, runJob } from './repository.mjs';

export function propertyQuery(input) {
  const location = text(input.property_location, 500);
  return {
    county: text(input.county, 100),
    parcel_id: text(input.parcel_id, 100),
    situs_address: input.property_location_kind === 'address' ? location : '',
    client_location: location,
    location_kind: ['address', 'general'].includes(input.property_location_kind) ? input.property_location_kind : 'general'
  };
}

export async function afterInquirySaved({ inquiryId, input, env, ctx, repository, onPropertyResult }) {
  if (env.PROPERTY_RECORDS_ENABLED !== 'true') return { status: 'disabled' };
  if (!env.PROPERTY_DB && !repository) return { status: 'unavailable', reason: 'property_database_missing' };
  try {
    const repo = repository || createRepository(env.PROPERTY_DB);
    const query = propertyQuery(input);
    // One inquiry currently represents one property. Repeated clients get new inquiry IDs.
    const job = await repo.enqueue(inquiryId, 'primary', query);
    const work = runJob(repo, job).then(async result => {
      if (onPropertyResult) await onPropertyResult({ inquiryId, propertyKey: job.property_key, result });
    }).catch(() => {
      // Persisted job can be retried from private operations even if the event write failed.
      console.error('Property-record background processing failed; queued job retained.');
    });
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
    return { status: 'queued' };
  } catch {
    console.error('Optional property-record module could not queue research; inquiry retained.');
    return { status: 'unavailable', reason: 'queue_failed' };
  }
}
