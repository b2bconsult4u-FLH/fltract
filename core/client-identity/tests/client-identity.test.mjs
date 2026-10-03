import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { linkClient, afterInquirySaved, reference } from '../identity.mjs';
import { clientAccount } from '../admin.mjs';
import intake from '../../../workers/intake/worker.mjs';

const secret='synthetic-test-secret-only-not-a-production-key';
const contact={firstName:'Synthetic',lastName:'Client',email:'synthetic@example.invalid'};
function d1() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE inquiries (id INTEGER PRIMARY KEY,status TEXT,email TEXT);
    INSERT INTO inquiries VALUES (1,'New','synthetic@example.invalid'),(2,'New','synthetic@example.invalid'),(3,'New','other@example.invalid');
    CREATE TABLE consent_history (inquiry_id INTEGER,permission TEXT);INSERT INTO consent_history VALUES (1,'original-consent');`);
  sqlite.exec(readFileSync(new URL('../migration.sql',import.meta.url),'utf8'));
  const db={sqlite,prepare(sql){const statement=sqlite.prepare(sql);return {bind(...args){return {
    _run(){return statement.run(...args);},async run(){return statement.run(...args);},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};}
  };}};},async batch(statements){sqlite.exec('BEGIN');try {const r=statements.map(s=>s._run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return db;
}
const link=(db,inquiryId,extra={})=>linkClient({db,inquiryId,contact,secret,clientPrefix:'FLT-C',inquiryPrefix:'FLT-I',...extra});

test('new client and first inquiry receive separate stable human-readable references',async()=>{
  const db=d1(),result=await link(db,1);
  assert.equal(result.client_reference,'FLT-C-000001');assert.equal(result.inquiry_reference,'FLT-I-000001');
  assert.equal(result.status,'linked');assert.equal(result.review_required,false);assert.ok(result.continuation_token);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM clients').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT client_id FROM inquiry_client_links WHERE inquiry_id=1').get().client_id,1);
  db.sqlite.close();
});
test('signed returning client keeps its client ID while second property gets a new inquiry reference',async()=>{
  const db=d1(),first=await link(db,1),second=await link(db,2,{continuationToken:first.continuation_token});
  assert.equal(second.client_reference,first.client_reference);assert.equal(second.inquiry_reference,'FLT-I-000002');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM clients').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM inquiry_client_links').get().n,2);
  assert.equal(db.sqlite.prepare('SELECT link_basis FROM inquiry_client_links WHERE inquiry_id=2').get().link_basis,'signed_continuation');
  db.sqlite.close();
});
test('matching or shared email, even with identical names, never silently combines clients',async()=>{
  const db=d1(),first=await link(db,1),second=await link(db,2);
  assert.notEqual(second.client_reference,first.client_reference);assert.equal(second.review_required,true);
  const event=db.sqlite.prepare('SELECT * FROM client_identity_events WHERE inquiry_id=2').get();
  assert.equal(event.reason,'shared_email_requires_review');assert.deepEqual(JSON.parse(event.candidate_client_ids_json),[1]);db.sqlite.close();
});
test('tampered, expired or changed-contact tokens create separate reviewable records',async()=>{
  for(const scenario of ['tampered','expired','changed']) {
    const db=d1(),time=new Date('2026-10-03T12:00:00Z'),first=await link(db,1,{now:time});
    const token=scenario==='tampered'?first.continuation_token+'x':first.continuation_token;
    const second=await link(db,2,{continuationToken:token,now:scenario==='expired'?new Date('2026-10-05T12:00:00Z'):time,
      contact:scenario==='changed'?{...contact,firstName:'Other'}:contact});
    assert.notEqual(second.client_reference,first.client_reference);assert.equal(second.review_required,true);db.sqlite.close();
  }
});
test('repeat linking of the same saved inquiry is idempotent',async()=>{
  const db=d1(),first=await link(db,1),repeat=await link(db,1);
  assert.equal(first.client_reference,repeat.client_reference);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM clients').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM client_identity_events').get().n,1);
  await assert.rejects(link(db,1,{contact:{...contact,firstName:'Other'}}),/does not match/);db.sqlite.close();
});
test('failed transactional link leaves no orphan client or event',async()=>{
  const db=d1();db.sqlite.exec("CREATE TRIGGER reject_client_link BEFORE INSERT ON inquiry_client_links BEGIN SELECT RAISE(ABORT,'synthetic-failure'); END;");
  await assert.rejects(link(db,1),/synthetic-failure/);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM clients').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM client_identity_events').get().n,0);db.sqlite.close();
});
test('client linking does not edit inquiry details, consent, or contact permissions',async()=>{
  const db=d1(),before=db.sqlite.prepare('SELECT * FROM inquiries').all(),consent=db.sqlite.prepare('SELECT * FROM consent_history').all();
  await link(db,1);await link(db,2);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM inquiries').all(),before);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM consent_history').all(),consent);db.sqlite.close();
});
test('disabled or misconfigured linking preserves a saved inquiry reference',async()=>{
  assert.equal((await afterInquirySaved({inquiryId:1,env:{}})).status,'disabled');
  const db=d1(),r=await afterInquirySaved({inquiryId:1,contact,input:{},env:{DB:db,CLIENT_IDENTITIES_ENABLED:'true'}});
  assert.equal(r.status,'unavailable');assert.equal(r.inquiry_reference,'FLT-I-000001');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM clients').get().n,0);db.sqlite.close();
  assert.equal((await afterInquirySaved({inquiryId:1,env:{INQUIRY_REFERENCE_PREFIX:'bad config'}})).inquiry_reference,'FLT-I-000001');
});
test('private account reads require authorization and list only that client inquiries',async()=>{
  const db=d1();await link(db,1);await link(db,2);await link(db,3,{contact:{...contact,email:'other@example.invalid'}});
  await assert.rejects(clientAccount({clientId:1,env:{DB:db},authorize:async()=>false}),/access denied/);
  const account=await clientAccount({clientId:1,env:{DB:db},authorize:async()=>true});
  assert.deepEqual(account.inquiries.map(i=>i.id),[1]);db.sqlite.close();
});
test('reference configuration handles large IDs without truncating',()=>{
  assert.equal(reference('FLT-C',1234567),'FLT-C-1234567');assert.throws(()=>reference('bad prefix',1));
});
test('replacement intake returns references and receipt references, without emailing continuation tokens',async()=>{
  // Core intake writes are stubbed; real client persistence remains in SQLite.
  const db=d1();const prepare=db.prepare.bind(db);
  db.prepare=sql=>/\b(clients|inquiry_client_links|client_identity_events)\b/.test(sql)?prepare(sql):{
    async first(){return null;},bind(){return {async run(){return {meta:{last_row_id:1}};}};}};
  let mail;
  const request=new Request('https://example.invalid/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inquiry_type:'Selling Property I Own',county:'Indian River',property_type:'Vacant / Acreage',first_name:contact.firstName,last_name:contact.lastName,email:contact.email,preferred_contact:'Email',rights_acknowledged:true,relationship_acknowledged:true})});
  const response=await intake.fetch(request,{DB:db,CLIENT_IDENTITIES_ENABLED:'true',CLIENT_CONTINUATION_SECRET:secret,SEND_EMAIL:{async send(value){mail=value;return {};}}});
  const result=await response.json();assert.equal(response.status,201);assert.equal(result.client_reference,'FLT-C-000001');
  assert.match(mail.text,/FLT-I-000001/);assert.match(mail.text,/FLT-C-000001/);
  assert.ok(!mail.text.includes(result.client_continuation_token));assert.ok(!mail.html.includes(result.client_continuation_token));db.sqlite.close();
});
