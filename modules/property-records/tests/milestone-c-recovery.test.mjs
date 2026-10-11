import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Execute the production retry function, but replace external dependencies
// with isolated in-memory doubles. Never contact live D1 or send email.
const source = readFileSync(new URL('../../../workers/intake/worker.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function retryPendingIntakes(env) {');
const end = source.indexOf('\nexport default {', start);
assert.ok(start >= 0 && end > start, 'production retry handler must exist');
const implementation = source.slice(start, end);
function harness({rows, failClient=false, failProperty=false}) {
  const operations=[];
  const db={
    prepare(sql) {
      const statement={sql, params:[], bind(...values){this.params=values;return this;},
        async all(){operations.push({sql,params:this.params});return {results:rows};},
        async run(){operations.push({sql,params:this.params});return {success:true};}
      };
      return statement;
    }
  };
  const retry = new Function('linkInquiryToClient','linkInquiryToProperty',
    implementation+'; return retryPendingIntakes;')(
      async (_env, data)=>{operations.push({kind:'client',data});if(failClient)throw Error('INJECTED_CLIENT_FAILURE');return 77;},
      async (_env,data)=>{operations.push({kind:'property',data});if(failProperty)throw Error('INJECTED_PROPERTY_FAILURE');return 88;}
    );
  return {retry:()=>retry({DB:db}),operations};
}
const row={inquiry_id:101,attempts:0,first_name:'Test',last_name:'Only',
  email:'test@example.invalid',phone:'',property_location:'Synthetic Parcel',
  county:'Test County',property_type:'Land',acreage:'2',improvements:'No'};
test('unattended retry repairs links, marks resolved, and completes manager task', async()=>{
  const h=harness({rows:[row]});await h.retry();
  assert.deepEqual(h.operations.filter(x=>x.kind).map(x=>x.kind),['client','property']);
  assert.ok(h.operations.some(x=>/UPDATE intake_recovery_queue SET status = 'Resolved'/.test(x.sql)));
  assert.ok(h.operations.some(x=>/UPDATE flt_work_items SET status = 'Completed'/.test(x.sql)));
});
test('injected downstream failure records retry and does not complete task',async()=>{
  const h=harness({rows:[row],failProperty:true});
  const original=console.error;console.error=()=>{};
  try{await h.retry();}finally{console.error=original;}
  assert.ok(h.operations.some(x=>/status = CASE WHEN attempts \+ 1 >= 5/.test(x.sql)));
  assert.ok(!h.operations.some(x=>/UPDATE flt_work_items SET status = 'Completed'/.test(x.sql)));
  assert.ok(h.operations.some(x=>x.params?.includes('INJECTED_PROPERTY_FAILURE')));
});
test('empty recovery queue performs no writes',async()=>{
  const h=harness({rows:[]});await h.retry();
  assert.equal(h.operations.filter(x=>/UPDATE|INSERT|DELETE/.test(x.sql)).length,0);
});
test('scheduled entrypoint delegates recovery through waitUntil',async()=>{
  assert.match(source,/async scheduled\(event, env, ctx\)\s*\{\s*ctx\.waitUntil\(retryPendingIntakes\(env\)\)/);
});
