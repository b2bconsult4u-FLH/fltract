import { approvedSource } from '../../industry/florida/county-sources.mjs';

export const VERSION = 'MINI-COMPS-2026-10-03-V1';
export const DEFAULT_POLICY = Object.freeze({ lookback_days: 365, radius_miles: 10, min_size_ratio: 0.5, max_size_ratio: 2, minimum_sales: 3, maximum_sales: 5, source_max_age_days: 30 });
export const key = value => String(value ?? '').trim().toUpperCase().replace(/[\s.-]/g, '');
const str = (value, limit = 500) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid comparison text field.');
  return value.trim();
};
const positive = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('Comparison sizes and prices must be positive.');
  return number;
};
export function sourceInfo(county, source) {
  if (!approvedSource(county, source?.url)) throw new Error('An approved county publication source is required.');
  if (!source.published_at || !source.retrieved_at || !Number.isFinite(Date.parse(source.published_at)) || !Number.isFinite(Date.parse(source.retrieved_at))) throw new Error('Publication and retrieval dates are required.');
  if (Date.parse(source.published_at) > Date.parse(source.retrieved_at)) throw new Error('Invalid source dates.');
  return { url: source.url, published_at: new Date(source.published_at).toISOString(), retrieved_at: new Date(source.retrieved_at).toISOString() };
}
export function normalizeProfile(input) {
  const county = str(input.county, 100), parcelId = str(input.parcel_id, 100);
  if (!key(parcelId)) throw new Error('A published parcel ID is required.');
  const improvement = str(input.improvement_type, 50);
  if (!['none', 'residence', 'manufactured_home', 'commercial', 'industrial', 'agricultural', 'mixed', 'unknown'].includes(improvement)) throw new Error('Unknown improvement classification.');
  const lat = input.latitude, lon = input.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Verified property coordinates are required.');
  if (input.restricted !== false) throw new Error('Restricted or restriction-unreviewed parcels cannot enter comparable data.');
  return { county, parcel_id: parcelId, situs_address: str(input.situs_address), acreage: positive(input.acreage),
    building_sqft: positive(input.building_sqft), property_use_code: str(input.property_use_code, 100),
    improvement_type: improvement, latitude: lat, longitude: lon, restricted: false,
    source: sourceInfo(county, input.source) };
}
export function normalizeSale(input) {
  const profile = normalizeProfile(input.profile_at_sale);
  const id = str(input.id, 200), deed = str(input.deed_reference, 500), date = str(input.date, 10);
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!id || !deed || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('A sale ID, deed reference and valid sale date are required.');
  if (!['qualified', 'unqualified', 'unknown'].includes(input.qualification)) throw new Error('A source-supported sale qualification is required.');
  return { id, date, price: positive(input.price), deed_reference: deed,
    qualification: input.qualification, qualification_code: str(input.qualification_code, 50),
    single_parcel: input.single_parcel === true, full_interest: input.full_interest === true,
    characteristics_verified_at_sale: input.characteristics_verified_at_sale === true,
    profile_at_sale: profile, source: sourceInfo(profile.county, input.source) };
}
export function distanceMiles(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const dlat = radians(b.latitude - a.latitude), dlon = radians(b.longitude - a.longitude);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dlon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function policyFor(options) {
  const p = { ...DEFAULT_POLICY, ...options };
  if (Object.values(p).some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0) || p.minimum_sales > p.maximum_sales || p.maximum_sales > 20 || p.min_size_ratio > p.max_size_ratio || !Number.isInteger(p.maximum_sales) || !Number.isInteger(p.minimum_sales)) throw new Error('Invalid comparison policy.');
  return p;
}
const ageDays = (value, now) => (now.getTime() - Date.parse(value)) / 86400000;
const round = value => Math.round(value * 100) / 100;
const median = values => { const v = [...values].sort((a,b) => a-b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m-1] + v[m]) / 2; };

export function emptyReport(reason, { now = new Date(), propertyRecord = null } = {}) {
  return { version: VERSION, generated_at: now.toISOString(), status: 'insufficient_data', reason,
    subject: propertyRecord ? { county: propertyRecord.county, parcel_id: propertyRecord.parcel_id, situs_address: propertyRecord.situs_address,
      acreage: propertyRecord.acreage, assessment_year: propertyRecord.assessment_year, appraiser_values: propertyRecord.values,
      appraiser_source: propertyRecord.source, source: propertyRecord.source } : null,
    comparables: [], excluded: [], observed_sales_summary: null, estimated_property_value: null,
    limitations: ['Internal preliminary sales comparison; human review required.', 'Appraiser values are dated tax-roll figures.', 'No appraisal, adjusted market value or transaction outcome is asserted.'] };
}

export function buildReport({ propertyRecord, subjectProfile, sales, now = new Date(), policy: options = {}, truncated = false }) {
  const policy = policyFor(options), base = emptyReport('insufficient_comparable_sales', { now, propertyRecord });
  base.policy = policy;
  if (truncated) return { ...base, status: 'needs_review', reason: 'candidate_search_incomplete' };
  let subject;
  try { subject = normalizeProfile(subjectProfile); } catch { return { ...base, reason: 'subject_characteristics_missing' }; }
  base.subject = { ...base.subject, ...subject };
  if (!propertyRecord || propertyRecord.county !== subject.county || key(propertyRecord.parcel_id) !== key(subject.parcel_id) ||
    (propertyRecord.acreage != null && Math.abs(Number(propertyRecord.acreage) - subject.acreage) > 0.01) ||
    (propertyRecord.property_use_code && propertyRecord.property_use_code !== subject.property_use_code)) return { ...base, status: 'needs_review', reason: 'subject_record_conflict' };
  if (!subject.acreage || !subject.property_use_code || ['unknown', 'mixed'].includes(subject.improvement_type) ||
    (subject.improvement_type !== 'none' && !subject.building_sqft)) return { ...base, reason: 'subject_characteristics_missing' };
  if (ageDays(subject.source.published_at, now) < 0 || ageDays(subject.source.published_at, now) > policy.source_max_age_days) return { ...base, status: 'needs_review', reason: 'subject_source_stale' };
  const included = [], excluded = [], seen = new Set();
  for (const raw of sales) {
    let sale;
    try { sale = normalizeSale(raw); } catch { excluded.push({ id: typeof raw?.id === 'string' ? raw.id.slice(0,200) : '', reason: 'invalid_or_missing_sale_data' }); continue; }
    const p = sale.profile_at_sale, ratio = p.acreage / subject.acreage;
    const buildingRatio = p.building_sqft / subject.building_sqft;
    const age = ageDays(`${sale.date}T00:00:00Z`, now), distance = distanceMiles(subject,p);
    let reason;
    if (p.county !== subject.county) reason = 'different_county';
    else if (key(p.parcel_id) === key(subject.parcel_id)) reason = 'subject_property_sale';
    else if (sale.qualification !== 'qualified') reason = 'sale_not_verified_qualified';
    else if (!sale.single_parcel || !sale.full_interest) reason = 'package_or_partial_interest_sale';
    else if (!sale.characteristics_verified_at_sale) reason = 'sale_time_characteristics_unknown';
    else if (!sale.price || !p.acreage) reason = 'missing_price_or_size';
    else if (p.property_use_code !== subject.property_use_code || p.improvement_type !== subject.improvement_type) reason = 'different_property_or_improvement_type';
    else if (ratio < policy.min_size_ratio || ratio > policy.max_size_ratio) reason = 'acreage_outside_policy';
    else if (subject.improvement_type !== 'none' && (!p.building_sqft || buildingRatio < policy.min_size_ratio || buildingRatio > policy.max_size_ratio)) reason = 'building_size_outside_policy';
    else if (distance > policy.radius_miles) reason = 'outside_search_radius';
    else if (age < 0 || age > policy.lookback_days) reason = 'sale_outside_date_window';
    else if ([sale.source,p.source].some(source => ageDays(source.published_at,now) < 0 || ageDays(source.published_at,now) > policy.source_max_age_days)) reason = 'sale_source_stale';
    const duplicate = `${p.county}|${sale.deed_reference}|${key(p.parcel_id)}`;
    if (!reason && seen.has(duplicate)) reason = 'duplicate_sale';
    if (reason) { excluded.push({ id: sale.id, parcel_id: p.parcel_id, reason }); continue; }
    seen.add(duplicate);
    const unit = subject.improvement_type === 'none' ? 'acre' : 'building_sqft';
    included.push({ ...sale, distance_miles: round(distance), acreage_ratio: round(ratio),
      unit, unit_price: round(sale.price / (unit === 'acre' ? p.acreage : p.building_sqft)),
      selection_reasons: [`Same county and published property-use code (${p.property_use_code}).`, `Same improvement class (${p.improvement_type}).`,
        `${round(distance)} miles from subject; ${p.acreage} acres.`, `Sale within ${policy.lookback_days} days; source marks it qualified.`],
      rank_score: distance / policy.radius_miles + Math.abs(Math.log(ratio)) + (subject.improvement_type === 'none' ? 0 : Math.abs(Math.log(buildingRatio))) + age / policy.lookback_days });
  }
  included.sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const parcels = new Set(), unique = [];
  for (const sale of included) {
    const id = key(sale.profile_at_sale.parcel_id);
    if (parcels.has(id)) excluded.push({ id: sale.id, parcel_id: sale.profile_at_sale.parcel_id, reason: 'older_sale_same_parcel' });
    else { parcels.add(id); unique.push(sale); }
  }
  unique.sort((a,b) => a.rank_score - b.rank_score || a.id.localeCompare(b.id));
  const selected = unique.slice(0,policy.maximum_sales);
  for (const sale of unique.slice(policy.maximum_sales)) excluded.push({ id: sale.id, parcel_id: sale.profile_at_sale.parcel_id, reason: 'lower_similarity_rank' });
  const comparables = selected.map(({ rank_score, ...sale }) => sale);
  const enough = comparables.length >= policy.minimum_sales;
  return { ...base, status: enough ? 'preliminary_ready' : 'insufficient_data', reason: enough ? 'comparable_sales_selected' : 'insufficient_comparable_sales', comparables, excluded,
    observed_sales_summary: enough ? { count: comparables.length, unit: comparables[0].unit,
      sale_price_min: Math.min(...comparables.map(s=>s.price)), sale_price_max: Math.max(...comparables.map(s=>s.price)),
      unit_price_min: Math.min(...comparables.map(s=>s.unit_price)), unit_price_median: round(median(comparables.map(s=>s.unit_price))), unit_price_max: Math.max(...comparables.map(s=>s.unit_price)) } : null,
    limitations: [...base.limitations, 'Observed sale prices are unadjusted and are not a value range for the subject.',
      'Zoning, access, utilities, flood/wetland conditions, development rights and building condition require separate comparison.'] };
}
