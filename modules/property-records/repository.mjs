import { addressKey, evaluateMatch, normalizeRecord, parcelKey } from './record.mjs';
import { counties } from './counties.mjs';

export function createRepository(db) {
  return {
    async enqueue(inquiryId, propertyKey, query) {
      const id = crypto.randomUUID();
      await db.prepare(`INSERT OR IGNORE INTO property_record_jobs
        (id,inquiry_id,property_key,query_json,created_at) VALUES (?,?,?,?,?)`)
        .bind(id, inquiryId, propertyKey, JSON.stringify(query), new Date().toISOString()).run();
      return db.prepare('SELECT * FROM property_record_jobs WHERE inquiry_id=? AND property_key=?').bind(inquiryId, propertyKey).first();
    },
    async append(jobId, result, actor = 'property-record-module') {
      await db.prepare(`INSERT INTO property_record_events
        (job_id,status,reason,result_json,actor,created_at) VALUES (?,?,?,?,?,?)`)
        .bind(jobId, result.status, result.reason, JSON.stringify(result), actor, new Date().toISOString()).run();
    },
    async lookup(query) {
      if (!counties[query.county]) return { status: 'needs_research', reason: 'county_not_configured', record: null, candidates: [], warnings: [], ownership_authority: 'not_verified' };
      if (!query.parcel_id && !query.situs_address) return { status: 'needs_research', reason: 'insufficient_property_identifiers', record: null, candidates: [], warnings: [], ownership_authority: 'not_verified' };
      // Only a fully imported source is searchable. Failed partial imports stay invisible.
      const source = await db.prepare(`SELECT * FROM property_record_sources
        WHERE county=? AND complete=1 ORDER BY COALESCE(published_at,retrieved_at) DESC, retrieved_at DESC LIMIT 1`)
        .bind(query.county).first();
      if (!source) return { status: 'needs_research', reason: 'county_data_not_loaded', record: null, candidates: [], warnings: [], ownership_authority: 'not_verified' };
      const field = query.parcel_id ? 'parcel_key' : 'address_key';
      const key = query.parcel_id ? parcelKey(query.parcel_id) : addressKey(query.situs_address);
      const response = await db.prepare(`SELECT record_json FROM property_record_cache WHERE source_id=? AND county=? AND ${field}=? LIMIT 21`)
        .bind(source.id, query.county, key).all();
      const rows = response.results || [];
      return evaluateMatch(query, rows.slice(0, 20).map(row => JSON.parse(row.record_json)), { overflow: rows.length > 20 });
    },
    async history(inquiryId) {
      return db.prepare(`SELECT j.property_key,j.query_json,e.* FROM property_record_jobs j
        JOIN property_record_events e ON e.job_id=j.id WHERE j.inquiry_id=? ORDER BY e.id`)
        .bind(inquiryId).all();
    }
  };
}

export async function runJob(repository, job) {
  let result;
  try { result = await repository.lookup(JSON.parse(job.query_json)); }
  catch { result = { status: 'needs_research', reason: 'lookup_failed', record: null, candidates: [], warnings: [], ownership_authority: 'not_verified' }; }
  await repository.append(job.id, result);
  return result;
}

// Private admin integration only: caller must authenticate and authorize the reviewer.
// A review adds history; it does not change client input, consent or ownership authority.
export async function recordReview(repository, jobId, { actor, decision, record, note }) {
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 200) throw new Error('An authenticated reviewer is required.');
  if (!['confirmed_property', 'rejected_match', 'needs_research'].includes(decision)) throw new Error('Invalid review decision.');
  if (typeof note !== 'string' || note.length > 2000) throw new Error('A review note is required.');
  const normalized = record ? normalizeRecord(record) : null;
  if (decision === 'confirmed_property' && (!normalized || normalized.restricted)) throw new Error('A public record is required to confirm the property.');
  await repository.append(jobId, { status: decision, reason: 'human_review', record: normalized, note, ownership_authority: 'not_verified' }, actor);
}
