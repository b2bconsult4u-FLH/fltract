import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { enqueueComparison } from '../dispatch.mjs';
import { afterPropertyResolved } from '../intake-hook.mjs';
import { processTask, recoverTasks } from '../../../workers/mini-comps/worker.mjs';
function fixture() {
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['migration.sql','queue-migration.sql'])sqlite.exec(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
 const db={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};},async batch(ss){sqlite.exec('BEGIN');try{for(const s of ss)await s.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const sent=[],env={MINI_COMP_DB:db,MINI_COMP_QUEUE:{async send(b){sent.push(b);}},MINI_COMPS_ENABLED:'true',MINI_COMP_QUEUE_ENABLED:'true'};
 return {sqlite,env,sent,result:{status:'matched',record:{county:'Indian River',parcel_id:'TEST',restricted:false}}};
}
const repository={async generate(){return {status:'insufficient_data',reason:'synthetic'};}};
const broken={async generate(){throw Error('transient');}};
async function task(f){await enqueueComparison({inquiryId:1,propertyKey:'primary',result:f.result,env:f.env});return f.sent[0].taskId;}
test('ID-only messages and idempotent duplicate delivery',async()=>{const f=fixture(),id=await task(f);assert.deepEqual(Object.keys(f.sent[0]),['taskId']);await processTask(id,f.env,{repository});await processTask(id,f.env,{repository});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mini_comp_reports').get().n,1);});
test('queue outage durable recovery',async()=>{const f=fixture();f.env.MINI_COMP_QUEUE.send=async()=>{throw Error('outage');};assert.equal((await enqueueComparison({inquiryId:1,result:f.result,env:f.env})).reason,'dispatch_pending_recovery');f.env.MINI_COMP_QUEUE.send=async b=>f.sent.push(b);await recoverTasks(f.env);assert.equal(f.sent.length,1);});
test('transient failure retries without overwriting report',async()=>{const f=fixture(),id=await task(f),now=Date.now();assert.equal(await processTask(id,f.env,{now,repository:broken}),'retry');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mini_comp_reports').get().n,0);assert.equal(await processTask(id,f.env,{now:now+60001,repository}),'ack');});
test('active lease blocks overlap; expired lease recovers',async()=>{const f=fixture(),id=await task(f),now=Date.now();f.sqlite.prepare("UPDATE mini_comp_tasks SET state='processing',lease_until=?,lease_token='other',attempts=1").run(now+1000);assert.equal(await processTask(id,f.env,{now}),'retry');assert.equal(await processTask(id,f.env,{now:now+1001,repository}),'ack');});
test('stale consumer fencing prevents duplicate report',async()=>{const f=fixture(),id=await task(f);await processTask(id,f.env,{repository:{async generate(){f.sqlite.prepare("UPDATE mini_comp_tasks SET lease_token='replacement'").run();return {status:'insufficient_data',reason:'test'};}}});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mini_comp_reports').get().n,0);});
test('exhausted task is retained for review',async()=>{const f=fixture(),id=await task(f);let now=Date.now();for(let i=0;i<5;i++){assert.equal(await processTask(id,f.env,{now,repository:broken}),'retry');now+=300001;}const r=f.sqlite.prepare('SELECT state,attempts FROM mini_comp_tasks').get();assert.equal(r.state,'failed');assert.equal(r.attempts,5);});
test('queued intake hook never generates inline; unmatched task yields review report',async()=>{const f=fixture();assert.equal((await afterPropertyResolved({inquiryId:1,result:{status:'ambiguous'},env:f.env})).status,'queued');await processTask(f.sent[0].taskId,f.env);assert.equal(f.sqlite.prepare('SELECT reason FROM mini_comp_reports').get().reason,'property_match_requires_review');});
test('transaction rollback prevents partial report completion',async()=>{const f=fixture(),id=await task(f);f.sqlite.exec("CREATE TRIGGER reject_completion BEFORE UPDATE OF state ON mini_comp_tasks WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'test'); END;");assert.equal(await processTask(id,f.env,{repository}),'retry');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mini_comp_reports').get().n,0);});
