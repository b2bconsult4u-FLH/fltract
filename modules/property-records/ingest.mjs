import { approvedSource } from './counties.mjs';
import { addressKey, normalizeRecord, parcelKey } from './record.mjs';

// Trusted scheduled-import/admin code only. No HTTP upload endpoint is exposed.
export async function beginPublication({ db, source, expectedRecords }) {
  if (!Number.isInteger(expectedRecords) || expectedRecords < 1) throw new Error('A nonempty expected record count is required.');
  if (!approvedSource(source.county, source.url)) throw new Error('Unapproved publication source.');
  const sourceId = crypto.randomUUID();
  // Validate source dates/format before writing an import manifest.
  const checked = normalizeRecord({ county: source.county, parcel_id: 'IMPORT-METADATA-CHECK', source, restricted: false });
  await db.prepare(`INSERT INTO property_record_sources
    (id,county,source_url,source_kind,retrieved_at,published_at,expected_records,complete) VALUES (?,?,?,?,?,?,?,0)`)
    .bind(sourceId, source.county, source.url, source.kind, checked.source.retrieved_at, checked.source.published_at, expectedRecords).run();
  return sourceId;
}

export async function ingestRecords({ db, bucket, sourceId, records, cards = new Map() }) {
  if (!records.length || records.length > 200) throw new Error('Import 1–200 records per chunk.');
  const manifest = await db.prepare('SELECT * FROM property_record_sources WHERE id=? AND complete=0').bind(sourceId).first();
  if (!manifest) throw new Error('An unfinished import manifest is required.');
  const source = { county: manifest.county, url: manifest.source_url, kind: manifest.source_kind,
    retrieved_at: manifest.retrieved_at, published_at: manifest.published_at };
  const normalized = records.map(input => normalizeRecord({ ...input, source: {
    kind: source.kind, url: source.url, retrieved_at: source.retrieved_at, published_at: source.published_at || null
  } }));
  if (normalized.some(record => record.county !== source.county)) throw new Error('Mixed-county publication import.');
  const duplicateKeys = new Set();
  for (const record of normalized) {
    if (duplicateKeys.has(record.parcel_id)) throw new Error('Duplicate parcel ID in publication.');
    duplicateKeys.add(record.parcel_id);
    // Copies must actually be stored by this import; incoming metadata cannot assert that.
    record.card_copy = null;
  }
  for (const record of normalized) {
    const card = cards.get(record.parcel_id);
    if (card && !record.restricted) {
      if (!bucket) throw new Error('Private record-card storage is required for supplied copies.');
      if (!approvedSource(record.county, card.url)) throw new Error('Unapproved record-card source.');
      if (!['text/plain', 'text/html', 'application/pdf'].includes(card.content_type)) throw new Error('Unsupported card copy.');
      const bytes = typeof card.bytes === 'string' ? new TextEncoder().encode(card.bytes) : card.bytes;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) throw new Error('Invalid record-card bytes.');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      const key = `property-records/${sourceId}/${crypto.randomUUID()}`;
      await bucket.put(key, bytes, { httpMetadata: { contentType: card.content_type }, customMetadata: { source_url: card.url, retrieved_at: record.source.retrieved_at, sha256: hash } });
      record.card_copy = { key, content_type: card.content_type, sha256: hash, source_url: card.url };
    }
    await db.prepare(`INSERT INTO property_record_cache
      (source_id,county,parcel_key,parcel_id,address_key,record_json) VALUES (?,?,?,?,?,?)`)
      .bind(sourceId, record.county, parcelKey(record.parcel_id), record.parcel_id, addressKey(record.situs_address), JSON.stringify(record)).run();
  }
  return { source_id: sourceId, imported: normalized.length };
}

export async function finishPublication({ db, sourceId }) {
  const manifest = await db.prepare('SELECT * FROM property_record_sources WHERE id=? AND complete=0').bind(sourceId).first();
  if (!manifest) throw new Error('An unfinished import manifest is required.');
  const count = await db.prepare('SELECT COUNT(*) AS n FROM property_record_cache WHERE source_id=?').bind(sourceId).first();
  if (count.n !== manifest.expected_records) throw new Error('Publication record count does not match its manifest.');
  // Publish only after every row and supplied copy succeeds; retain previous source/history.
  await db.prepare('UPDATE property_record_sources SET complete=1 WHERE id=?').bind(sourceId).run();
  return { source_id: sourceId, imported: count.n };
}

// Small trusted imports; countywide imports use staged chunks across invocations.
export async function ingestPublication({ db, bucket, source, records, cards }) {
  if (!records.length || records.length > 200) throw new Error('Use staged import for county publications over 200 records.');
  const sourceId = await beginPublication({ db, source, expectedRecords: records.length });
  await ingestRecords({ db, bucket, sourceId, records, cards });
  return finishPublication({ db, sourceId });
}
