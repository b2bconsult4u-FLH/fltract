import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {processMiniCompQueue,researchProperty,addressKey,geometryPoint,ensureResearchQueueSchema,MINI_COMP_ADAPTERS} from '../mini-comp-research.mjs';
const source=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
const now=new Date('2026-10-13T12:00:00Z');
const config={id:1,client_id:1,primary_inquiry_id:1,county:'Indian River',property_location:'100 Test Court, Vero Beach, FL 32962',parcel_id:''};
const point=(x=-80.4,y=27.6)=>({x,y,spatialReference:{wkid:4326}});
const subject={attributes:{PP_PIN:'000123.0',SITE_ADDR:'100 TEST CT',AD_CITY:'VERO BEACH',AD_ZIP:'32962',PROPUSE_CD:'0100',DOR_DESC:'Single Family-Improved',LAND_ACRES:.25,UPD_DATE:now.getTime()-86400000,SUBDIV_NME:'Synthetic Area'},geometry:point()};
const candidate=(id=1,attrs={})=>({attributes:{...subject.attributes,PP_PIN:'000456.'+id,SITE_ADDR:`${id+200} TEST CT`,SALE_PRICE:200000+id*1000,SALE_YEAR:2026,SALE_MONTH:9,SALE_VI_CD:'0',...attrs},geometry:point(-80.401-id*.001,27.6)});
function fetcher({subjects=[subject],sales=Array.from({length:10},(_,i)=>candidate(i)),error,overflow=false,onSales}={}){
 const calls=[];
 const run=async url=>{const u=new URL(url);calls.push(u);assert.equal(u.origin,'https://gisportal.ircgov.com');assert.ok(!u.searchParams.get('outFields').includes('OWNER'));
  if(error)return new Response(JSON.stringify({error:{message:error}}),{status:500});
  const sale=u.searchParams.has('geometry');if(sale)await onSales?.();
  return new Response(JSON.stringify({features:sale?sales:subjects,exceededTransferLimit:sale?overflow:false}),{headers:{'content-type':'application/json'}});
 };return {run,calls};
}
async function database({status='Needs Research',county='Indian River',oldQueue=true}={}){
 const sqlite=new DatabaseSync(':memory:');let failInsert=false;
 const DB={sqlite,prepare(sql){let args=[];return {sql,bind(...a){args=a;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){if(failInsert&&sql.includes('INSERT INTO mini_comp_comparables'))throw Error('INJECTED_STORAGE_FAILURE');const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}},setFailure(value){failInsert=value;}};
 const start=source.indexOf('async function ensureClientSchema(env) {'),end=source.indexOf('async function ensureClientForInquiry(',start);
 await new Function('let clientSchemaReady=false;'+source.slice(start,end)+';return ensureClientSchema;')()({DB});
 sqlite.exec("CREATE TABLE activity_log(id INTEGER PRIMARY KEY,inquiry_id INTEGER,activity_type TEXT,activity_note TEXT);");
 sqlite.prepare("INSERT INTO clients(id,normalized_email) VALUES(1,'synthetic@example.invalid')").run();
 sqlite.prepare('INSERT INTO properties(id,client_id,primary_inquiry_id,county,property_location) VALUES(1,1,1,?,?)').run(county,config.property_location);
 sqlite.prepare('INSERT INTO mini_comp_reports(id,property_id,status) VALUES(1,1,?)').run(status);
 if(oldQueue){sqlite.exec('DROP TABLE mini_comp_queue');sqlite.exec("CREATE TABLE mini_comp_queue(id INTEGER PRIMARY KEY,property_id INTEGER,report_id INTEGER,task_type TEXT DEFAULT 'Research Mini-Comp',status TEXT,attempts INTEGER DEFAULT 0,last_error TEXT DEFAULT '',available_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);");}
 sqlite.exec("INSERT INTO mini_comp_queue(id,property_id,report_id,status) VALUES(1,1,1,'Queued');INSERT INTO flt_work_items(id,work_type,module_key,subject_type,subject_id,title,status,assigned_staff_email) VALUES(1,'Research Mini-Comp','real-estate','mini_comp_queue',1,'Synthetic research','Overdue','synthetic@example.invalid');INSERT INTO staff_users(id,email,role,active) VALUES(1,'synthetic@example.invalid','Administrator',1);");
 return DB;
}

test('exact address normalization does not confuse Court and Avenue or guess general locations',async()=>{
 assert.equal(addressKey('100 Test Court, Vero Beach, FL 32962'),'100 TEST CT');assert.notEqual(addressKey('100 Test Avenue'),'100 TEST CT');
 const f=fetcher();await assert.rejects(researchProperty({...config,property_location:'Somewhere near the highway'},{fetcher:f.run,now}));assert.equal(f.calls.length,0);
});
test('unique parcel and ten sourced month-precision sale candidates are returned without invented qualification',async()=>{
 const f=fetcher({overflow:true});const result=await researchProperty(config,{fetcher:f.run,now});assert.equal(result.subject.parcel,'000123.0');assert.equal(result.candidates.length,10);assert.equal(result.candidates[0].date,'2026-09');assert.equal(result.candidates[0].qualification,'0');assert.equal(result.truncated,true);assert.equal(f.calls.length,2);
});
test('ambiguous exact matches stop without fetching sales',async()=>{
 const f=fetcher({subjects:[subject,{...subject,attributes:{...subject.attributes,PP_PIN:'999999.0'}}]});await assert.rejects(researchProperty(config,{fetcher:f.run,now}),/Multiple exact/);assert.equal(f.calls.length,1);
});
test('parcel/address conflict stops instead of silently changing the submitted identity',async()=>{
 const f=fetcher();await assert.rejects(researchProperty({...config,parcel_id:'000123.0',property_location:'101 Different Court'},{fetcher:f.run,now}),/conflicts/);
});
test('stale subject source requires review',async()=>{
 const f=fetcher({subjects:[{...subject,attributes:{...subject.attributes,UPD_DATE:now.getTime()-40*86400000}}]});await assert.rejects(researchProperty(config,{fetcher:f.run,now}),/older than 30/);
});
test('candidate screening rejects subject, other use, future dates, invalid month, wrong size, far geometry, duplicates and stale rows',async()=>{
 const sales=[candidate(1),candidate(1),candidate(2,{PP_PIN:subject.attributes.PP_PIN}),candidate(3,{PROPUSE_CD:'0000'}),candidate(4,{SALE_YEAR:2027}),candidate(5,{SALE_MONTH:13}),candidate(6,{LAND_ACRES:5}),{...candidate(7),geometry:point(-82,29)},candidate(8,{UPD_DATE:now.getTime()-40*86400000})];
 const result=await researchProperty(config,{fetcher:fetcher({sales}).run,now});assert.equal(result.candidates.length,1);
});
test('legacy queue migration, atomic persistence, library and staff-review handoff work on real SQLite',async()=>{
 const DB=await database();try{
  const f=fetcher();const result=await processMiniCompQueue({DB},{fetcher:f.run,now});assert.deepEqual(result.results,[{id:1,status:'Ready for Review',candidates:10}]);
  assert.equal(DB.sqlite.prepare('SELECT attempts FROM mini_comp_queue').get().attempts,1);assert.equal(DB.sqlite.prepare('SELECT status FROM mini_comp_queue').get().status,'Completed');
  assert.equal(DB.sqlite.prepare('SELECT parcel_id FROM properties').get().parcel_id,'000123.0');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM mini_comp_comparables').get().n,10);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM mini_comp_comparables WHERE qualified_sale='Unknown' AND sale_date='2026-09' AND acreage IS NOT NULL AND source_reference LIKE 'https://gisportal.ircgov.com/%'").get().n,10);
  assert.equal(DB.sqlite.prepare("SELECT status FROM flt_work_items WHERE id=1").get().status,'Completed');
  assert.equal(DB.sqlite.prepare("SELECT status FROM flt_work_items WHERE work_type='Review Mini-Comp'").get().status,'Assigned');
  assert.equal(DB.sqlite.prepare('SELECT current_status FROM report_library_items').get().current_status,'Ready for Review');
  assert.equal(DB.sqlite.prepare('SELECT status FROM official_research_runs').get().status,'Completed');
  await processMiniCompQueue({DB},{fetcher:f.run,now});assert.equal(f.calls.length,2);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM mini_comp_comparables').get().n,10);
 }finally{DB.sqlite.close();}
});
test('transient source failure retries durably then stops at five attempts',async()=>{
 const DB=await database();try{
  const f=fetcher({error:'synthetic source outage'});const r=await processMiniCompQueue({DB},{fetcher:f.run,now});assert.equal(r.results[0].status,'Retry');assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM mini_comp_comparables').get().n,0);
  DB.sqlite.exec("UPDATE mini_comp_queue SET attempts=4,available_at=datetime('now','-1 minute')");const last=await processMiniCompQueue({DB},{fetcher:f.run,now});assert.equal(last.results[0].status,'Failed');assert.equal(DB.sqlite.prepare('SELECT status FROM flt_work_items').get().status,'Escalation Required');
 }finally{DB.sqlite.close();}
});
test('storage failure rolls back parcel/comps/report/task changes and retains retry',async()=>{
 const DB=await database();try{DB.setFailure(true);const r=await processMiniCompQueue({DB},{fetcher:fetcher().run,now});assert.equal(r.results[0].status,'Retry');assert.equal(DB.sqlite.prepare('SELECT parcel_id FROM properties').get().parcel_id,'');assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM mini_comp_comparables').get().n,0);assert.equal(DB.sqlite.prepare('SELECT status FROM mini_comp_reports').get().status,'Needs Research');assert.equal(DB.sqlite.prepare('SELECT status FROM flt_work_items').get().status,'Overdue');}finally{DB.sqlite.close();}
});
test('unknown county is a visible blocked job, not a forever queued empty report',async()=>{
 const DB=await database({county:'Unknown County'});try{const f=fetcher();const r=await processMiniCompQueue({DB},{fetcher:f.run,now});assert.equal(r.results[0].status,'Source Not Configured');assert.equal(f.calls.length,0);assert.equal(DB.sqlite.prepare('SELECT status FROM flt_work_items').get().status,'Escalation Required');}finally{DB.sqlite.close();}
});
test('no eligible sales produces explicit insufficient-data report and review work',async()=>{
 const DB=await database();try{const r=await processMiniCompQueue({DB},{fetcher:fetcher({sales:[]}).run,now});assert.equal(r.results[0].status,'Insufficient Data');assert.match(DB.sqlite.prepare('SELECT insufficient_data_reason FROM mini_comp_reports').get().insufficient_data_reason,/No eligible/);}finally{DB.sqlite.close();}
});
test('already approved report is preserved without source calls or automatic refresh',async()=>{
 const DB=await database({status:'Approved'});try{const f=fetcher();await processMiniCompQueue({DB},{fetcher:f.run,now});assert.equal(f.calls.length,0);assert.equal(DB.sqlite.prepare('SELECT status FROM mini_comp_reports').get().status,'Approved');assert.equal(DB.sqlite.prepare('SELECT status FROM mini_comp_queue').get().status,'Completed');}finally{DB.sqlite.close();}
});
test('expired processing lease is recovered; active lease is not stolen',async()=>{
 const DB=await database();try{await ensureResearchQueueSchema({DB});DB.sqlite.exec("UPDATE mini_comp_queue SET status='Processing',lease_token='old',lease_expires_at=datetime('now','+3 minutes')");const f=fetcher();assert.equal((await processMiniCompQueue({DB},{fetcher:f.run,now})).attempted,0);DB.sqlite.exec("UPDATE mini_comp_queue SET lease_expires_at=datetime('now','-1 minute')");assert.equal((await processMiniCompQueue({DB},{fetcher:f.run,now})).results[0].candidates,10);}finally{DB.sqlite.close();}
});
test('lost lease cannot overwrite another runner or its report',async()=>{
 const DB=await database();try{const f=fetcher({onSales(){DB.sqlite.exec("UPDATE mini_comp_queue SET lease_token='new-runner'");}});const r=await processMiniCompQueue({DB},{fetcher:f.run,now});assert.equal(r.results[0].status,'Lease Lost');assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM mini_comp_comparables').get().n,0);assert.equal(DB.sqlite.prepare('SELECT insufficient_data_reason FROM mini_comp_reports').get().insufficient_data_reason,'');}finally{DB.sqlite.close();}
});
test('page visits do not enqueue new research after completion',async()=>{
 const DB=await database();try{await processMiniCompQueue({DB},{fetcher:fetcher().run,now});
  const begin=source.indexOf('async function ensureMiniCompForProperty('),end=source.indexOf('async function ensureLibraryItemForMiniComp(',begin);
  const ensure=new Function('ensureClientSchema','ensureLibraryItemForMiniComp',source.slice(begin,end)+';return ensureMiniCompForProperty;')(async()=>{},async()=>{});
  await ensure({DB},1);await ensure({DB},1);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM mini_comp_queue').get().n,1);
 }finally{DB.sqlite.close();}
});
test('scheduled entrypoint invokes research separately from hourly deadlines and preserves security gate',()=>{
 assert.match(source,/controller\.cron===\"\*\/5 \* \* \* \*\"/);assert.match(source,/await processMiniCompQueue\(env\)/);assert.match(source,/await verifiedAccessIdentity\(request, env\)/);assert.match(source,/await routeAuthorized\(env,staff,request/);
});
test('St. Lucie confidential parcel is rejected and unknown TotalArea units are not converted to acres',async()=>{
 const fetcher=async()=>new Response(JSON.stringify({features:[{attributes:{ParcelID:'synthetic',SiteAddress:'100 TEST CT',SiteZIP:'32962',Isconfidential:1,LandUseCode:'0100',TotalArea:10000},geometry:point()}]}));
 await assert.rejects(researchProperty({...config,county:'St. Lucie'},{fetcher,now}),/confidential/);
 assert.ok(MINI_COMP_ADAPTERS['St. Lucie'].fields.includes('Isconfidential'));
});

test('city attached to street before first comma is parsed without changing the entered address',async()=>{
 const input='100 Test Ct. Vero Beach, FL.  32962';const f=fetcher();
 const result=await researchProperty({...config,property_location:input},{fetcher:f.run,now});assert.equal(result.subject.parcel,'000123.0');
 assert.match(f.calls[0].searchParams.get('where'),/'100 TEST CT'/);assert.ok(!f.calls[0].searchParams.get('where').includes('VERO BEACH'));
});
test('explicit postal or city conflict is not treated as an exact subject match',async()=>{
 for(const input of ['100 Test Ct. Vero Beach, FL 32960','100 Test Ct. Sebastian, FL 32962']){
  await assert.rejects(researchProperty({...config,property_location:input},{fetcher:fetcher().run,now}),/No exact/);
 }
});

test('candidate review updates only its report, requires evidence and preserves approved reports',async()=>{
 const start=source.indexOf('if(request.method === "POST" && /^\\/property\\/\\d+\\/mini-comp\\/comparable\\/\\d+\\/review$');
 const end=source.indexOf('\n\nif (\nrequest.method === "POST"',start);
 assert.ok(start>0&&end>start);
 const handler=new Function('return async function(request,env,staff,ensureMiniCompForProperty,sameOriginPost,redirect){const url=new URL(request.url);'+source.slice(start,end)+'}')();
 const DB=await database();try{
  await processMiniCompQueue({DB},{fetcher:fetcher().run,now});
  const make=(path,qualification='Yes',reason='Verified deed qualification and comparable characteristics.')=>new Request('https://example.invalid'+path,{method:'POST',headers:{Origin:'https://example.invalid'},body:new URLSearchParams({qualified_sale:qualification,selection_reason:reason})});
  const call=req=>handler(req,{DB},{email:'synthetic@example.invalid'},async()=>DB.sqlite.prepare('SELECT * FROM mini_comp_reports WHERE id=1').get(),()=>true,path=>new Response(null,{status:303,headers:{Location:path}}));
  const before=DB.sqlite.prepare('SELECT * FROM mini_comp_comparables WHERE id=1').get();
  const badOrigin=await handler(make('/property/1/mini-comp/comparable/1/review'),{DB},{email:'synthetic@example.invalid'},async()=>{throw Error('Must reject origin before DB');},()=>false,()=>{});
  assert.equal(badOrigin.status,403);
  assert.equal((await call(make('/property/1/mini-comp/comparable/1/review','Invented'))).status,400);
  DB.sqlite.exec("INSERT INTO mini_comp_reports(id,property_id,status) VALUES(2,2,'Draft'); INSERT INTO mini_comp_comparables(id,report_id) VALUES(999,2);");
  assert.equal((await call(make('/property/1/mini-comp/comparable/999/review'))).status,404);
  assert.equal(DB.sqlite.prepare('SELECT qualified_sale FROM mini_comp_comparables WHERE id=999').get().qualified_sale,'Unknown');
  assert.equal((await call(make('/property/1/mini-comp/comparable/1/review'))).status,303);
  const after=DB.sqlite.prepare('SELECT * FROM mini_comp_comparables WHERE id=1').get();
  for(const field of ['sale_date','sale_price','parcel_id','source_name','source_reference','source_retrieved_at','property_location']) assert.equal(after[field],before[field],field+' must be preserved');
  const event=DB.sqlite.prepare("SELECT activity_note FROM activity_log WHERE activity_type='Mini-Comp Candidate Reviewed'").get();
  assert.match(event.activity_note,/synthetic@example.invalid/);
  const eventCount=DB.sqlite.prepare('SELECT COUNT(*) AS n FROM activity_log').get().n;
  const race=make('/property/1/mini-comp/comparable/1/review','No');
  const formData=race.formData.bind(race);
  race.formData=async()=>{DB.sqlite.exec("UPDATE mini_comp_reports SET status='Approved' WHERE id=1");return formData();};
  assert.equal((await call(race)).status,409,'approval during parsing must prevent review mutation');
  assert.equal(DB.sqlite.prepare('SELECT qualified_sale FROM mini_comp_comparables WHERE id=1').get().qualified_sale,'Yes');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM activity_log').get().n,eventCount,'rejected review must not log a completed change');
  DB.sqlite.exec("UPDATE mini_comp_reports SET status='Draft' WHERE id=1");

  assert.equal(DB.sqlite.prepare('SELECT qualified_sale FROM mini_comp_comparables WHERE id=1').get().qualified_sale,'Yes');
  assert.equal((await call(make('/property/1/mini-comp/comparable/2/review','Yes',''))).status,400);
  assert.equal((await call(make('/property/1/mini-comp/comparable/999/review'))).status,404);
  DB.sqlite.exec("UPDATE mini_comp_reports SET status='Approved'");
  assert.equal((await call(make('/property/1/mini-comp/comparable/1/review','No'))).status,409);
  assert.equal(DB.sqlite.prepare('SELECT qualified_sale FROM mini_comp_comparables WHERE id=1').get().qualified_sale,'Yes');
 }finally{DB.sqlite.close();}
});
