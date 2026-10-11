import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import intake from '../../../workers/intake/worker.mjs';

function isolatedDb() {
  const sqlite = new DatabaseSync(':memory:');
  const worker = readFileSync(new URL('../../../workers/intake/worker.mjs', import.meta.url), 'utf8');
  const match = worker.match(/INSERT INTO inquiries \(\s*([\s\S]*?)\)\s*VALUES \(/);
  assert.ok(match, 'Core inquiry INSERT must exist');
  const columns = match[1].split(',').map(v => v.trim());
  assert.ok(columns.every(v => /^[a-z_]+$/.test(v)));
  sqlite.exec('CREATE TABLE inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, ' + columns.map(v => v + ' TEXT').join(', ') + ')');
  const db = {
    sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async run() { const result = stmt.run(...values); return { meta: { last_row_id: Number(result.lastInsertRowid) } }; },
            async first() { return stmt.get(...values) || null; }
          };
        },
        async run() { const result = stmt.run(); return { meta: { last_row_id: Number(result.lastInsertRowid) } }; },
        async first() { return stmt.get() || null; }
      };
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); }
  };
  return db;
}
function submit(location, email = 'synthetic@example.invalid') {
  return new Request('https://intake.example/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://fltract.com' },
    body: JSON.stringify({
      inquiry_type: 'Selling Property', county: 'Indian River', property_type: 'Vacant / Acreage',
      property_location: location, first_name: 'Synthetic', last_name: 'Customer', email,
      preferred_contact: 'Email', rights_acknowledged: true, relationship_acknowledged: true
    })
  });
}
test('isolated SQLite retains returning customer, distinct properties and mini-comp records', async () => {
  const db = isolatedDb();
  const emails = [];
  const env = { DB: db, SEND_EMAIL: { async send(message) { emails.push(message); return {}; } } };
  try {
    for (const location of ['SYNTHETIC PARCEL ONE', 'SYNTHETIC PARCEL TWO']) {
      const response = await intake.fetch(submit(location), env);
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(body.ok, true);
    }
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 1);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM client_inquiries').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM properties').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM property_inquiries').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM mini_comp_reports').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM mini_comp_queue').get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT COUNT(DISTINCT client_id) AS n FROM properties').get().n, 1);
    assert.deepEqual(db.sqlite.prepare('SELECT property_location FROM properties ORDER BY id').all().map(r => r.property_location), ['SYNTHETIC PARCEL ONE', 'SYNTHETIC PARCEL TWO']);
    assert.equal(emails.length, 4, 'Each inquiry sends customer receipt and internal notification');
  } finally { db.sqlite.close(); }
});
