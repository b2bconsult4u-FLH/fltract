import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import intake from '../../../workers/intake/worker.mjs';

function isolatedDb() {
  const sqlite = new DatabaseSync(':memory:');
  // Use verified production DDL, not columns inferred from the code being tested.
  sqlite.exec(readFileSync(new URL('./fixtures/intake-production-core-2026-10-17.sql', import.meta.url), 'utf8'));
  const db = {
    sqlite,
    prepare(sql) {
      const statement = () => sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async run() { const result = statement().run(...values); return { meta: { last_row_id: Number(result.lastInsertRowid) } }; },
            async first() { return statement().get(...values) || null; }
          };
        },
        async run() { const result = statement().run(); return { meta: { last_row_id: Number(result.lastInsertRowid) } }; },
        async first() { return statement().get() || null; }
      };
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); }
  };
  return db;
}
function submit(location, email = 'synthetic@example.invalid', extra = {}) {
  return new Request('https://intake.example/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://fltract.com' },
    body: JSON.stringify({
      inquiry_type: 'Selling Property', county: 'Indian River', property_type: 'Vacant / Acreage',
      property_location: location, first_name: 'Synthetic', last_name: 'Customer', email,
      preferred_contact: 'Email', rights_acknowledged: true, relationship_acknowledged: true, ...extra
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
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM consent_history').get().n, 8);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM activity_log').get().n, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM email_log WHERE status = 'Sent'").get().n, 4);

    // Exercise all currently displayed inquiry choices against actual core DDL.
    const form = readFileSync(new URL('../../../contact/index.html', import.meta.url), 'utf8');
    const select = form.match(/<select name="inquiry_type"[^>]*>(.*?)<\/select>/s)[1];
    for (const [, inquiry_type] of select.matchAll(/<option>(.*?)<\/option>/g)) {
      const response = await intake.fetch(submit('SYNTHETIC METADATA PROPERTY', 'synthetic@example.invalid', {
        inquiry_type, timeframe:'Now', owner_status:'No', best_contact_time:'Morning',
        referral_source:'Other', source_page:'https://fltract.com/contact/', details:'Original details',
        preferred_contact:'Phone', phone:'7725550100', live_call_opt_in:true, marketing_email_opt_in:false
      }), env);
      const result = await response.json();
      assert.equal(response.status, 201, JSON.stringify(result));
      const saved = db.sqlite.prepare('SELECT * FROM inquiries WHERE id = ?').get(result.inquiry_id);
      assert.equal(saved.inquiry_type, inquiry_type);
      assert.equal(saved.timeframe, 'Now');
      assert.equal(saved.owner_status, 'No');
      assert.equal(saved.best_contact_time, 'Morning');
      assert.equal(saved.referral_source, 'Other');
      assert.equal(saved.source_page, 'https://fltract.com/contact/');
      assert.equal(saved.details, 'Original details');
      assert.equal(saved.live_call_opt_in, 1);
      assert.equal(saved.marketing_email_opt_in, 0);
      assert.equal(saved.text_opt_in, 0);
      assert.equal(saved.archived, 0, 'production default applies');
      const permissions = db.sqlite.prepare('SELECT channel, purpose, permission_granted FROM consent_history WHERE inquiry_id = ?').all(result.inquiry_id);
      assert.equal(permissions.length, 4);
      assert.equal(permissions.find(p=>p.purpose==='Live Telephone Follow-Up').permission_granted, 1);
      assert.equal(permissions.find(p=>p.purpose==='Optional Future Email Communications').permission_granted, 0);
    }

    // Failure injection with real SQL: mail failure cannot undo the saved inquiry.
    const failingEmailEnv = {DB:db,SEND_EMAIL:{async send(){throw Error('Synthetic provider outage');}}};
    const failedMail = await intake.fetch(submit('SYNTHETIC EMAIL OUTAGE PROPERTY'), failingEmailEnv);
    const mailResult = await failedMail.json();
    assert.equal(failedMail.status, 201);
    assert.equal(mailResult.acknowledgment_email, 'failed');
    assert.equal(mailResult.internal_notification_email, 'failed');
    assert.ok(db.sqlite.prepare('SELECT id FROM inquiries WHERE id=?').get(mailResult.inquiry_id));
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM email_log WHERE inquiry_id=? AND status='Failed'").get(mailResult.inquiry_id).n, 2);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM consent_history WHERE inquiry_id=?').get(mailResult.inquiry_id).n, 4);
    assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);

    // A genuine INSERT failure must not send either notification.
    db.sqlite.exec("CREATE TRIGGER synthetic_reject_insert BEFORE INSERT ON inquiries BEGIN SELECT RAISE(ABORT, 'Synthetic save failure'); END");
    const sentBefore = emails.length;
    const failedSave = await intake.fetch(submit('SYNTHETIC SAVE FAILURE'), env);
    assert.equal(failedSave.status, 500);
    assert.equal(emails.length, sentBefore);

  } finally { db.sqlite.close(); }
});
