import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Execute current production functions against a fresh SQLite database per test.
// No HTTP, D1, parcel lookup, or email service is used.
const source = readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const functions = new Function(
  section('function roleCanReceiveWork(', 'async function adminFetch(') +
  section('async function staffHasCompetency(', 'function canActOnWork(') +
  ';return {routeQueuedWork,checkWorkDeadlines};'
)();
async function database() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = { sqlite, prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async run() { const r = sqlite.prepare(sql).run(...args); return { success:true, meta:{ changes:Number(r.changes), last_row_id:Number(r.lastInsertRowid) } }; }
    };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results=[]; for(const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results; }
    catch(error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const init = new Function('let clientSchemaReady=false;' +
    section('async function ensureClientSchema(env) {', 'async function ensureClientForInquiry(') + ';return ensureClientSchema;')();
  await init({DB});
  return DB;
}
function staff(DB, manager=true, qualified=true) {
  DB.sqlite.exec("INSERT INTO staff_users(id,email,role,active) VALUES(1,'worker@example.invalid','Employee',1)");
  if(manager) DB.sqlite.exec("INSERT INTO staff_users(id,email,role,active) VALUES(2,'manager@example.invalid','Manager',1)");
  if(qualified) DB.sqlite.exec("INSERT INTO flt_training_competencies(staff_user_id,staff_email,competency_key,scenario_id,scenario_version,result) VALUES(1,'worker@example.invalid','RE-001',1,1,'Manager Confirmed')");
}
function queued(DB) {
  DB.sqlite.exec("INSERT INTO mini_comp_queue(id,property_id,report_id,status) VALUES(1,1,1,'Queued')");
}
for(const [label,manager,qualified,status,email] of [
  ['qualified worker',true,true,'Assigned','worker@example.invalid'],
  ['no qualified worker',true,false,'Escalated','manager@example.invalid'],
  ['no qualified worker or manager',false,false,'Escalation Required','']
]) test(`Group 2 isolated routing: ${label}`, async()=>{
  const DB=await database();
  try {
    staff(DB,manager,qualified); queued(DB);
    const first=await functions.routeQueuedWork({DB},'Synthetic Group 2');
    assert.deepEqual(first,qualified?{assigned:1,held:0}:{assigned:0,held:1});
    const work=DB.sqlite.prepare('SELECT * FROM flt_work_items').get();
    assert.equal(work.status,status); assert.equal(work.assigned_staff_email,email);
    assert.equal(work.subject_type,'mini_comp_queue'); assert.equal(work.subject_id,1);
    const event=DB.sqlite.prepare('SELECT * FROM flt_work_routing_events').get();
    assert.equal(event.work_item_id,work.id); assert.equal(event.event_type,status);
    assert.equal(event.performed_by,'Synthetic Group 2');
    assert.deepEqual(await functions.routeQueuedWork({DB}),{assigned:0,held:0});
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM flt_work_items').get().n,1);
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM flt_work_routing_events').get().n,1);
  } finally { DB.sqlite.close(); }
});

test('Group 2 warning advances to overdue, redirects to manager, and audits each transition once',async()=>{
  const DB=await database();
  try {
    staff(DB);
    DB.sqlite.exec("INSERT INTO flt_work_items(id,work_type,status,assigned_staff_user_id,assigned_staff_email,due_at,warning_at) VALUES(1,'Synthetic Deadline','Assigned',1,'worker@example.invalid',datetime('now','+1 day'),datetime('now','-1 day'))");
    assert.deepEqual(await functions.checkWorkDeadlines({DB},'Synthetic Clock'),{checked:1,warned:1,overdue:0,escalated:1});
    let work=DB.sqlite.prepare('SELECT * FROM flt_work_items').get();
    assert.equal(work.status,'Deadline Warning'); assert.equal(work.escalation_level,1);
    assert.equal(work.assigned_staff_email,'manager@example.invalid');
    await functions.checkWorkDeadlines({DB});
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM flt_work_routing_events').get().n,1);
    DB.sqlite.exec("UPDATE flt_work_items SET due_at=datetime('now','-1 hour')");
    assert.deepEqual(await functions.checkWorkDeadlines({DB},'Synthetic Clock'),{checked:1,warned:0,overdue:1,escalated:1});
    work=DB.sqlite.prepare('SELECT * FROM flt_work_items').get();
    assert.equal(work.status,'Overdue'); assert.equal(work.escalation_level,2);
    await functions.checkWorkDeadlines({DB});
    assert.deepEqual(DB.sqlite.prepare('SELECT event_type,performed_by FROM flt_work_routing_events ORDER BY id').all().map(x=>({...x})),[
      {event_type:'Deadline Warning',performed_by:'Synthetic Clock'},
      {event_type:'Deadline Overdue',performed_by:'Synthetic Clock'}
    ]);
    DB.sqlite.exec("UPDATE flt_work_items SET status='Completed'");
    assert.deepEqual(await functions.checkWorkDeadlines({DB}),{checked:0,warned:0,overdue:0,escalated:0});
    assert.equal(DB.sqlite.prepare('SELECT status FROM flt_work_items').get().status,'Completed');
  } finally { DB.sqlite.close(); }
});

test('Group 2 deadline state and audit roll back together on storage failure',async()=>{
  const DB=await database();
  try {
    staff(DB);
    DB.sqlite.exec("INSERT INTO flt_work_items(id,work_type,status,due_at) VALUES(1,'Synthetic Failure','Assigned',datetime('now','-1 day')); CREATE TRIGGER reject_deadline BEFORE UPDATE ON flt_work_items BEGIN SELECT RAISE(ABORT,'Synthetic storage failure'); END");
    await assert.rejects(functions.checkWorkDeadlines({DB}),/Synthetic storage failure/);
    assert.equal(DB.sqlite.prepare('SELECT status FROM flt_work_items').get().status,'Assigned');
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM flt_work_routing_events').get().n,0);
  } finally { DB.sqlite.close(); }
});
