import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { normalizeRecord, evaluateMatch } from '../record.mjs';
import { afterInquirySaved, propertyQuery } from '../intake-hook.mjs';
import { beginPublication, ingestRecords, finishPublication, ingestPublication } from '../ingest.mjs';
import { createRepository, recordReview, runJob } from '../repository.mjs';
import { indianRiverRecords } from '../adapters/indian-river.mjs';
import intake from '../../../workers/intake/worker.mjs';

// Deliberately fictional test parcel; never an actual client's county record.
function fixture(overrides = {}) {
  return { county: 'Indian River', parcel_id: '00-TEST-001', property_id: '00001',
    situs_address: '100 SYNTHETIC TEST ROAD', property_description: 'SYNTHETIC TEST DESCRIPTION',
    owners: [{ name: 'SYNTHETIC OWNER', mailing_address: 'PO BOX TEST' }], acreage: 10,
    assessment_year: 2026, values: { just: 0, assessed: 0, taxable: 0 }, restricted: false,
    source: { kind: 'published_export', url: 'https://www.ircpa.org/site-links/pro-tools-page/', published_at: new Date().toISOString(), retrieved_at: new Date().toISOString() }, ...overrides };
}
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migration.sql', import.meta.url), 'utf8'));
  return { sqlite, prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return { bind(...args) { return {
      async run() { const result = stmt.run(...args); return { success: true, meta: { last_row_id: Number(result.lastInsertRowid) } }; },
      async first() { return stmt.get(...args) || null; },
      async all() { return { results: stmt.all(...args) }; }
    }; } };
  } };
}
async function load(db, records = [fixture()], extra = {}) {
  return ingestPublication({ db, records, source: { county: 'Indian River', ...records[0].source }, ...extra });
}

test('disabled module needs no binding, storage, county fields or execution context', async () => {
  const bomb = { enqueue() { throw new Error('Must not be called'); } };
  for (const value of [undefined, 'false', 'TRUE', true]) {
    assert.deepEqual(await afterInquirySaved({ env: { PROPERTY_RECORDS_ENABLED: value }, repository: bomb }), { status: 'disabled' });
  }
});
test('official ID formatting and unknown versus zero values are retained', () => {
  const record = normalizeRecord(fixture());
  assert.equal(record.parcel_id, '00-TEST-001');
  assert.equal(record.property_id, '00001');
  assert.equal(record.values.just, 0);
  assert.equal(record.full_legal_description, null);
  assert.equal(normalizeRecord(fixture({ values: {} })).values.just, null);
  assert.throws(() => normalizeRecord(fixture({ parcel_id: 1 })), /strings/);
});
test('untrusted and wrong-county source URLs are rejected', () => {
  for (const url of ['https://evil.example/', 'http://www.ircpa.org/', 'https://www.ircpa.org.evil.example/', 'https://qpublic.schneidercorp.com/Application.aspx?App=OkeechobeeCountyFL']) {
    assert.throws(() => normalizeRecord(fixture({ source: { ...fixture().source, url } })), /approved/);
  }
});
test('general location is never guessed to be a parcel or address', () => {
  assert.equal(propertyQuery({ county: 'Indian River', property_location: 'north of the highway' }).situs_address, '');
  assert.equal(evaluateMatch({ county: 'Indian River' }, [fixture()]).status, 'needs_research');
});
test('an exact formatted ID matches while conflicting address stays for review', () => {
  const query = { county: 'Indian River', parcel_id: '00TEST001' };
  const matched = evaluateMatch(query, [fixture()]);
  assert.equal(matched.status, 'matched');
  assert.equal(matched.ownership_authority, 'not_verified');
  assert.ok(matched.warnings.includes('record_card_copy_pending'));
  assert.equal(evaluateMatch({ ...query, situs_address: 'OTHER ADDRESS' }, [fixture()]).reason, 'address_conflict');
});
test('multiple parcels sharing an address, stale data and wrong county require review', () => {
  const query = { county: 'Indian River', situs_address: fixture().situs_address };
  assert.equal(evaluateMatch(query, [fixture(), fixture({ parcel_id: '00-TEST-002' })]).reason, 'multiple_matches');
  assert.equal(evaluateMatch(query, [fixture()], { overflow: true }).reason, 'too_many_matches');
  assert.equal(evaluateMatch(query, [fixture({ source: { ...fixture().source, published_at: '2020-01-01T00:00:00Z' } })]).reason, 'stale_source');
  assert.equal(evaluateMatch({ ...query, county: 'Brevard' }, [fixture()]).reason, 'county_conflict');
});
test('an export without a publication date requires review rather than claiming freshness', () => {
  const record = fixture({ source: { ...fixture().source, published_at: null } });
  assert.equal(evaluateMatch({ county: 'Indian River', parcel_id: record.parcel_id }, [record]).reason, 'publication_date_unknown');
});
test('restricted records retain no owner, address, description, values or card', () => {
  const record = normalizeRecord(fixture({ restricted: true }));
  assert.deepEqual(record.owners, []);
  assert.equal(record.situs_address, '');
  assert.equal(record.property_description, '');
  assert.equal(record.values.just, null);
  assert.equal(evaluateMatch({ county: 'Indian River', parcel_id: record.parcel_id }, [record]).reason, 'restricted_record');
});
test('real SQLite storage finds parcel/address and separates research from client records', async () => {
  const db = d1(); await load(db);
  const repo = createRepository(db);
  assert.equal((await repo.lookup({ county: 'Indian River', parcel_id: '00TEST001' })).status, 'matched');
  assert.equal((await repo.lookup({ county: 'Indian River', situs_address: '100 synthetic test road' })).status, 'matched');
  assert.equal((await repo.lookup({ county: 'Indian River', parcel_id: 'NOT-FOUND' })).reason, 'no_match');
  assert.equal((await repo.lookup({ county: 'Brevard', parcel_id: '00TEST001' })).reason, 'county_data_not_loaded');
  assert.equal((await repo.lookup({ county: 'Other Florida County', parcel_id: '00TEST001' })).reason, 'county_not_configured');
  const input = { county: 'Indian River', parcel_id: '00TEST001', property_location: 'CLIENT LOCATION', owners: [{ name: 'UNTRUSTED NAME' }] };
  const tasks = [];
  assert.equal((await afterInquirySaved({ inquiryId: 1, input, env: { PROPERTY_RECORDS_ENABLED: 'true', PROPERTY_DB: db }, ctx: { waitUntil(task) { tasks.push(task); } } })).status, 'queued');
  await Promise.all(tasks);
  const history = (await repo.history(1)).results;
  const saved = JSON.parse(history[0].result_json);
  assert.equal(saved.record.owners[0].name, 'SYNTHETIC OWNER');
  assert.equal(JSON.parse(history[0].query_json).client_location, 'CLIENT LOCATION');
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='inquiries'").get().n, 0);
  db.sqlite.close();
});
test('incomplete publication is hidden and previous completed publication remains usable', async () => {
  const db = d1(); await load(db);
  const brokenDb = { prepare(sql) { if (sql.includes('INSERT INTO property_record_cache')) throw new Error('interrupted'); return db.prepare(sql); } };
  await assert.rejects(load(brokenDb, [fixture({ parcel_id: '00-TEST-NEW' })]), /interrupted/);
  assert.equal((await createRepository(db).lookup({ county: 'Indian River', parcel_id: '00TEST001' })).status, 'matched');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM property_record_sources WHERE complete=0').get().n, 1);
  db.sqlite.close();
});
test('staged county import cannot publish early and becomes searchable only after its last chunk', async () => {
  const db = d1(); const source = { county: 'Indian River', ...fixture().source };
  const sourceId = await beginPublication({ db, source, expectedRecords: 2 });
  await ingestRecords({ db, sourceId, records: [fixture()] });
  await assert.rejects(finishPublication({ db, sourceId }), /record count/);
  assert.equal((await createRepository(db).lookup({ county: 'Indian River', parcel_id: '00TEST001' })).reason, 'county_data_not_loaded');
  await ingestRecords({ db, sourceId, records: [fixture({ parcel_id: '00-TEST-002' })] });
  assert.equal((await finishPublication({ db, sourceId })).imported, 2);
  assert.equal((await createRepository(db).lookup({ county: 'Indian River', parcel_id: '00TEST001' })).status, 'matched');
  db.sqlite.close();
});
test('card copy is actually stored privately and has a valid hash and provenance', async () => {
  const db = d1(); const objects = new Map();
  await load(db, [fixture()], { bucket: { async put(key, bytes, metadata) { objects.set(key, { bytes, metadata }); } },
    cards: new Map([['00-TEST-001', { url: 'https://qpublic.schneidercorp.com/Application.aspx?App=IndianRiverCountyFL&PageType=Report', content_type: 'text/plain', bytes: 'SYNTHETIC RECORD CARD COPY' }]]) });
  const result = await createRepository(db).lookup({ county: 'Indian River', parcel_id: '00TEST001' });
  const copy = result.record.card_copy;
  assert.equal(objects.size, 1);
  assert.equal(copy.sha256.length, 64);
  assert.equal(new TextDecoder().decode(objects.get(copy.key).bytes), 'SYNTHETIC RECORD CARD COPY');
  assert.match(copy.source_url, /IndianRiverCountyFL/);
  assert.ok(!result.warnings.includes('record_card_copy_pending'));
  db.sqlite.close();
});
test('an asserted copy without bytes is not retained as an acquired record card', async () => {
  const db = d1();
  await load(db, [fixture({ card_copy: { key: 'not-real', sha256: 'a'.repeat(64), content_type: 'text/plain', source_url: fixture().source.url } })]);
  const result = await createRepository(db).lookup({ county: 'Indian River', parcel_id: '00TEST001' });
  assert.equal(result.record.card_copy, null);
  db.sqlite.close();
});
test('queue/lookup failure cannot throw away an already saved inquiry', async () => {
  const input = { county: 'Indian River', property_location: 'location' };
  assert.equal((await afterInquirySaved({ inquiryId: 1, input, env: { PROPERTY_RECORDS_ENABLED: 'true' } })).status, 'unavailable');
  const repository = { async enqueue() { throw new Error('offline'); } };
  assert.equal((await afterInquirySaved({ inquiryId: 1, input, env: { PROPERTY_RECORDS_ENABLED: 'true' }, repository })).reason, 'queue_failed');
  let captured;
  await runJob({ async lookup() { throw new Error('timeout'); }, async append(id, result) { captured = result; } }, { id: 'job', query_json: '{}' });
  assert.equal(captured.reason, 'lookup_failed');
});
test('repeat scheduling does not duplicate a property job; another inquiry is independent', async () => {
  const db = d1(); const repo = createRepository(db); const query = { county: 'Indian River', parcel_id: '00TEST001' };
  const first = await repo.enqueue(1, 'primary', query);
  assert.equal((await repo.enqueue(1, 'primary', query)).id, first.id);
  assert.notEqual((await repo.enqueue(2, 'primary', query)).id, first.id);
  db.sqlite.close();
});
test('human review appends history and never verifies client authority', async () => {
  const db = d1(); const repo = createRepository(db); const job = await repo.enqueue(1, 'primary', {});
  await repo.append(job.id, { status: 'needs_review', reason: 'multiple_matches' });
  await recordReview(repo, job.id, { actor: 'authenticated-test-reviewer', decision: 'confirmed_property', record: fixture(), note: 'Synthetic test review.' });
  assert.equal((await repo.history(1)).results.length, 2);
  assert.equal(JSON.parse((await repo.history(1)).results[1].result_json).ownership_authority, 'not_verified');
  await assert.rejects(recordReview(repo, job.id, { actor: '', decision: 'confirmed_property', record: fixture(), note: '' }), /reviewer/);
  db.sqlite.close();
});
test('Indian River adapter joins public owner and same-year values without NAL sensitive fields', () => {
  const input = { properties: [{ 'Property ID': '001', 'Geo ID': '00-TEST-001', 'Roll Year': '2026', 'Situs Address': 'SYNTHETIC ADDRESS', 'Legal Description': 'SYNTHETIC DESCRIPTION', 'Legal Acres': '10' }],
    owners: [{ 'Property ID': '001', 'File As Name': 'SYNTHETIC OWNER', 'Street Line 2': 'TEST BOX', City: 'TEST CITY' }],
    values: [{ 'Property ID': '001', Year: '2025', 'Total Market Value': '5' }, { 'Property ID': '001', Year: '2026', 'Total Market Value': '0' }], source: fixture().source };
  assert.throws(() => indianRiverRecords(input), /restriction/);
  const record = indianRiverRecords({ ...input, restrictionsReviewed: true })[0];
  assert.equal(record.property_id, '001');
  assert.equal(record.values.just, 0);
  assert.match(record.owners[0].mailing_address, /TEST CITY/);
});

// The core DB is stubbed separately from module SQLite, because production core schema isn't in this repo.
function coreDb() {
  const statements = [];
  return { statements, prepare(sql) { statements.push(sql); return {
    async first() { return null; },
    bind(...args) { return { async run() { return { meta: { last_row_id: 1 } }; }, async first() { return null; } }; }
  }; } };
}
function submission() {
  return new Request('https://intake.example/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://fltract.com' }, body: JSON.stringify({
    inquiry_type: 'Selling Property I Own', county: 'Indian River', property_type: 'Vacant / Acreage',
    property_location: 'SYNTHETIC TEST ADDRESS', first_name: 'Synthetic', last_name: 'Test', email: 'synthetic@example.invalid',
    preferred_contact: 'Email', rights_acknowledged: true, relationship_acknowledged: true
  }) });
}
test('replacement intake succeeds when optional module is absent or unavailable, keeping its receipt path', async () => {
  for (const enabled of [undefined, 'true']) {
    const db = coreDb(); let attemptedReceipts = 0;
    const response = await intake.fetch(submission(), { DB: db, PROPERTY_RECORDS_ENABLED: enabled, SEND_EMAIL: { async send() { attemptedReceipts++; return {}; } } });
    const result = await response.json();
    assert.equal(response.status, 201);
    assert.equal(result.ok, true);
    assert.equal(result.property_research.status, enabled ? 'unavailable' : 'disabled');
    assert.equal(attemptedReceipts, 1); // Stub only; no mail leaves this test.
    assert.equal(db.statements.filter(sql => sql.includes('INSERT INTO inquiries')).length, 1);
  }
});
test('removing the module hook/import leaves a working core Worker', async () => {
  const source = readFileSync(new URL('../../../workers/intake/worker.mjs', import.meta.url), 'utf8')
    .replace(/^import.*modules\/property-records\/intake-hook\.mjs.*\n/m, '')
    .replace(/^import.*queueMiniComp.*\n/m, '')
    .replace("'../../core/client-identity/identity.mjs'",JSON.stringify(new URL('../../../core/client-identity/identity.mjs',import.meta.url).href))
    .replace(/    const propertyResearch = await afterInquirySaved\([\s\S]*?\n    \}\);/, '')
    .replace('    const miniComp = await queueMiniComp({ inquiryId, env });', '')
    .replace('        mini_comp: miniComp,', '')
    .replace('        property_research: propertyResearch,', '');
  const stripped = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const response = await stripped.default.fetch(submission(), { DB: coreDb(), SEND_EMAIL: { async send() { return {}; } } });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).property_research, undefined);
});
