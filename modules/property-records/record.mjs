import { approvedSource } from './counties.mjs';

export const VERSION = 'PROPERTY-RECORDS-2026-10-03-V1';
export function text(value, max = 500) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('Text fields must be strings; identifiers must preserve leading zeros.');
  if (value.length > max) throw new Error('Property-record field exceeds its limit.');
  return value.trim();
}
export const parcelKey = value => text(value, 100).toUpperCase().replace(/[\s.\-]/g, '');
export const addressKey = value => text(value, 500).toUpperCase().replace(/\s+/g, ' ');

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid numeric property field.');
  return parsed;
}
function timestamp(value) {
  const s = text(value, 50);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s))) throw new Error('A source timestamp is required.');
  return new Date(s).toISOString();
}
function list(value, max = 100) {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid property-record list.');
  return value;
}

// Trusted ingestion boundary. Never call this with the visitor's supplied owner/description.
export function normalizeRecord(input) {
  const county = text(input.county, 100);
  const parcelId = text(input.parcel_id, 100);
  if (!parcelKey(parcelId)) throw new Error('A published parcel/folio ID is required.');
  const sourceUrl = text(input.source?.url, 2000);
  if (!approvedSource(county, sourceUrl)) throw new Error('The source must be an approved county appraiser publication.');
  const retrievedAt = timestamp(input.source?.retrieved_at);
  const publishedAt = input.source?.published_at ? timestamp(input.source.published_at) : null;
  if (Date.parse(publishedAt || retrievedAt) > Date.parse(retrievedAt)) throw new Error('Source dates are inconsistent.');
  if (typeof input.restricted !== 'boolean') throw new Error('Explicit public-record restriction status is required.');
  const sourceKind = text(input.source?.kind, 30);
  if (!['record_card', 'published_export'].includes(sourceKind)) throw new Error('Unknown publication type.');
  const record = {
    version: VERSION, county, parcel_id: parcelId,
    property_id: text(input.property_id, 100),
    situs_address: text(input.situs_address, 500),
    property_description: text(input.property_description, 16000),
    description_status: 'appraiser_published_description',
    // Full deed text is a separate future source; an appraiser excerpt is never promoted to it.
    full_legal_description: null,
    owners: list(input.owners || [], 50).map(owner => ({
      name: text(owner.name, 500), mailing_address: text(owner.mailing_address, 1000)
    })),
    acreage: number(input.acreage), property_use_code: text(input.property_use_code, 100),
    assessment_year: number(input.assessment_year),
    values: { just: number(input.values?.just), assessed: number(input.values?.assessed), taxable: number(input.values?.taxable) },
    exemptions: list(input.exemptions || []).map(value => text(value, 500)),
    agricultural_classification: text(input.agricultural_classification, 500),
    improvements: list(input.improvements || []).map(value => text(value, 1000)),
    sales: list(input.sales || []).map(sale => ({ date: text(sale.date, 50), price: number(sale.price), deed_reference: text(sale.deed_reference, 500) })),
    deed_reference: text(input.deed_reference, 500),
    source: { kind: sourceKind, url: sourceUrl, retrieved_at: retrievedAt, published_at: publishedAt },
    restricted: input.restricted,
    card_copy: null
  };
  if (record.assessment_year != null && (!Number.isInteger(record.assessment_year) || record.assessment_year < 1900 || record.assessment_year > 2200)) throw new Error('Invalid assessment year.');
  if (input.card_copy) {
    const copy = input.card_copy;
    if (!['text/plain', 'text/html', 'application/pdf'].includes(copy.content_type)) throw new Error('Unknown record-card copy format.');
    const sha = text(copy.sha256, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('A record-card SHA-256 is required.');
    const copyUrl = text(copy.source_url, 2000);
    if (!approvedSource(county, copyUrl)) throw new Error('An approved source URL is required for the card copy.');
    record.card_copy = { key: text(copy.key, 500), content_type: copy.content_type, sha256: sha, source_url: copyUrl };
    if (!record.card_copy.key) throw new Error('A private record-card object key is required.');
  }
  // Do not retain inadvertently supplied confidential names, addresses, or descriptions.
  if (record.restricted) {
    return { version: VERSION, county, parcel_id: parcelId, property_id: '', situs_address: '', property_description: '',
      description_status: 'restricted', full_legal_description: null, owners: [], acreage: null,
      property_use_code: '', assessment_year: null, values: { just: null, assessed: null, taxable: null },
      exemptions: [], agricultural_classification: '', improvements: [], sales: [], deed_reference: '',
      source: record.source, restricted: true, card_copy: null };
  }
  return record;
}

export function evaluateMatch(query, records, { now = new Date(), maxAgeDays = 30, overflow = false } = {}) {
  const result = { status: 'needs_research', reason: 'no_match', record: null, candidates: [], warnings: [], ownership_authority: 'not_verified' };
  if (overflow) return { ...result, status: 'needs_review', reason: 'too_many_matches' };
  if (!records.length) return result;
  const candidates = records.map(normalizeRecord);
  result.candidates = candidates.map(r => ({ county: r.county, parcel_id: r.parcel_id, situs_address: r.situs_address }));
  if (candidates.length !== 1) return { ...result, status: 'needs_review', reason: 'multiple_matches' };
  const record = candidates[0];
  result.record = record;
  if (record.county !== query.county) return { ...result, status: 'needs_review', reason: 'county_conflict' };
  if (record.restricted) return { ...result, status: 'needs_review', reason: 'restricted_record' };
  if (query.parcel_id && parcelKey(query.parcel_id) !== parcelKey(record.parcel_id)) return { ...result, status: 'needs_review', reason: 'parcel_conflict' };
  if (query.situs_address && addressKey(query.situs_address) !== addressKey(record.situs_address)) return { ...result, status: 'needs_review', reason: 'address_conflict' };
  if (!query.parcel_id && !query.situs_address) return { ...result, reason: 'insufficient_property_identifiers' };
  if (record.source.kind === 'published_export' && !record.source.published_at) return { ...result, status: 'needs_review', reason: 'publication_date_unknown' };
  const age = (new Date(now).getTime() - Date.parse(record.source.published_at || record.source.retrieved_at)) / 86400000;
  if (!Number.isFinite(age) || age < -1 || age > maxAgeDays) return { ...result, status: 'needs_review', reason: 'stale_source' };
  if (!record.card_copy) result.warnings.push('record_card_copy_pending');
  if (!record.property_description) result.warnings.push('property_description_missing');
  if (!record.owners.length) result.warnings.push('published_owner_information_missing');
  result.warnings.push('full_legal_description_requires_recorded_deed');
  return { ...result, status: 'matched', reason: query.parcel_id ? 'exact_parcel_match' : 'exact_address_match' };
}
