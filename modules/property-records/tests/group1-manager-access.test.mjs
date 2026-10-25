import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../../../workers/admin/worker.mjs',import.meta.url),'utf8');
const begin=code.indexOf('if (request.method === "GET" && url.pathname === "/intake-recovery")');
const end=code.indexOf('/* ============================================================\n   SECURITY / AUDIT',begin);
assert.ok(begin>=0&&end>begin);
const route=code.slice(begin,end);
const rank={employee:1,manager:2,cfo:3,ceo:4,administrator:5};
const roleCanReceiveWork=(role,required)=>(rank[String(role||'').toLowerCase()]||0)>=(rank[String(required).toLowerCase()]||0);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function check(staff,rows=[]){
  const actions=[];
  const env={DB:{prepare(sql){return {bind(){return this;},async all(){actions.push('read');return {results:rows}}}}}};
  const request=new Request('https://example.invalid/intake-recovery');
  const url=new URL(request.url);
  const logStaffAccess=async()=>{actions.push('denied-audit')};
  const page=html=>html;
  const floridaTime=x=>x;
  const broadRecords=user=>!!user?.active&&['Administrator','CEO'].includes(user.role);
  const run=new Function('request','url','staff','env','roleCanReceiveWork','logStaffAccess','page','esc','floridaTime','broadRecords',
    'return (async()=>{'+route+'})();');
  const response=await run(request,url,staff,env,roleCanReceiveWork,logStaffAccess,page,esc,floridaTime,broadRecords);
  return {response,actions,body:await response.text()};
}
test('anonymous cannot read recovery queue and is audited',async()=>{
  const x=await check({authenticated:false,user:null});assert.equal(x.response.status,403);assert.deepEqual(x.actions,['denied-audit']);
});
test('employee cannot read recovery queue and is audited',async()=>{
  const x=await check({authenticated:true,user:{active:1,role:'Employee'}});assert.equal(x.response.status,403);assert.deepEqual(x.actions,['denied-audit']);
});
test('inactive manager cannot read recovery queue',async()=>{
  const x=await check({authenticated:true,user:{active:0,role:'Manager'}});assert.equal(x.response.status,403);assert.deepEqual(x.actions,['denied-audit']);
});
test('active manager reads queue without cache',async()=>{
  const x=await check({authenticated:true,user:{active:1,role:'Manager'}});assert.equal(x.response.status,200);
  assert.equal(x.response.headers.get('cache-control'),'no-store');assert.deepEqual(x.actions,['read']);
  assert.match(x.body,/No intake recovery records/);
});
test('recovery error text is HTML escaped',async()=>{
  const x=await check({authenticated:true,user:{active:1,role:'CEO'}},[{inquiry_id:12,attempts:1,first_name:'<script>alert(1)</script>',last_name:'X',county:'County',property_location:'Lot',status:'Retry Pending',last_error:'<img src=x onerror=alert(1)>',updated_at:'2026-10-11',work_item_id:5}]);
  assert.equal(x.response.status,200);assert.ok(!x.body.includes('<script>'));assert.ok(!x.body.includes('<img'));
  assert.match(x.body,/Open task/);
});
