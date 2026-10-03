import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildReport, normalizeSale } from '../engine.mjs';
import { createRepository } from '../repository.mjs';
import { beginDataset, importChunk, finishDataset } from '../ingest.mjs';
import { queueMiniComp, afterPropertyResolved } from '../intake-hook.mjs';
import { renderReport } from '../render.mjs';
import { miniCompCard } from '../admin-card.mjs';
import { ingestPublication as ingestProperty } from '../../property-records/ingest.mjs';
import { afterInquirySaved } from '../../property-records/intake-hook.mjs';

const now = new Date('2026-10-03T12:00:00Z');
const source = { url:'https://www.ircpa.org/site-links/pro-tools-page/',published_at:'2026-10-02T12:00:00Z',retrieved_at:'2026-10-03T10:00:00Z' };
// All subject/sale data below are fictional test cases, not real public records.
const profile = (overrides = {}) => ({ county:'Indian River',parcel_id:'00-SYNTHETIC-SUBJECT',situs_address:'SYNTHETIC SUBJECT LOCATION',acreage:10,
  building_sqft:null,property_use_code:'SYNTHETIC-USE',improvement_type:'none',latitude:27.7,longitude:-80.5,source,restricted:false,...overrides });
const record = (overrides = {}) => ({ ...profile(),assessment_year:2026,values:{just:100,assessed:80,taxable:0},...overrides });
const sale = (n, overrides = {}) => ({ id:`SYNTHETIC-${n}`,date:'2026-09-01',price:100000*n,deed_reference:`SYNTHETIC DEED ${n}`,
  qualification:'qualified',qualification_code:'SYNTHETIC',single_parcel:true,full_interest:true,characteristics_verified_at_sale:true,
  profile_at_sale:profile({parcel_id:`00-SYNTHETIC-COMP-${n}`,situs_address:`SYNTHETIC SALE ${n}`,latitude:27.7+n*0.001}),source,...overrides });
const report = (sales = [sale(1),sale(2),sale(3)], extra = {}) => buildReport({propertyRecord:record(),subjectProfile:profile(),sales,now,...extra});
function d1(schema = new URL('../migration.sql',import.meta.url)) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(schema,'utf8'));
  return {sqlite,prepare(sql){const stmt=sqlite.prepare(sql);return {bind(...args){return {
    async run(){const r=stmt.run(...args);return {meta:{last_row_id:Number(r.lastInsertRowid)}};},
    async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};}
  };}};}};
}
test('three defensible sales yield sourced observations, with no subject value estimate',()=>{
  const r=report();assert.equal(r.status,'preliminary_ready');assert.equal(r.comparables.length,3);
  assert.equal(r.observed_sales_summary.unit_price_median,20000);assert.equal(r.estimated_property_value,null);
  assert.equal(r.subject.appraiser_values.taxable,0);assert.equal(r.subject.assessment_year,2026);
  assert.ok(r.comparables.every(s=>s.selection_reasons.length===4&&s.source.url));
});
test('insufficient sales do not yield any numeric range or invented comps',()=>{
  const r=report([sale(1)]);assert.equal(r.status,'insufficient_data');assert.equal(r.comparables.length,1);
  assert.equal(r.observed_sales_summary,null);assert.equal(r.estimated_property_value,null);
});
test('vacant land is not compared with residence or industrial improvements',()=>{
  const r=report([sale(1,{profile_at_sale:profile({parcel_id:'00-SALE',improvement_type:'residence',building_sqft:2500})}),sale(2,{profile_at_sale:profile({parcel_id:'00-INDUSTRIAL',improvement_type:'industrial',building_sqft:5000})})]);
  assert.equal(r.comparables.length,0);assert.ok(r.excluded.every(s=>s.reason==='different_property_or_improvement_type'));
});
test('improved properties compare same class and size, using unadjusted price per building sq ft',()=>{
  const subject=profile({improvement_type:'residence',building_sqft:2000});
  const sales=[1,2,3].map(n=>sale(n,{profile_at_sale:{...profile({parcel_id:`00-IMPROVED-${n}`}),improvement_type:'residence',building_sqft:2000}}));
  const r=report(sales,{propertyRecord:record({improvement_type:'residence'}),subjectProfile:subject});
  assert.equal(r.status,'preliminary_ready');assert.equal(r.comparables[0].unit,'building_sqft');
  assert.equal(r.observed_sales_summary.unit_price_median,100);
});
test('unknown qualification, partial/package transfers and unknown sale-time features are excluded',()=>{
  const r=report([sale(1,{qualification:'unknown'}),sale(2,{single_parcel:false}),sale(3,{full_interest:false}),sale(4,{characteristics_verified_at_sale:false})]);
  assert.equal(r.comparables.length,0);assert.deepEqual(r.excluded.map(s=>s.reason),['sale_not_verified_qualified','package_or_partial_interest_sale','package_or_partial_interest_sale','sale_time_characteristics_unknown']);
});
test('future, old, distant, oversized, and subject-property sales are excluded',()=>{
  const r=report([sale(1,{date:'2027-01-01'}),sale(2,{date:'2024-01-01'}),sale(3,{profile_at_sale:profile({parcel_id:'00-FAR',latitude:28.7})}),
    sale(4,{profile_at_sale:profile({parcel_id:'00-BIG',acreage:100})}),sale(5,{profile_at_sale:profile()})]);
  assert.equal(r.comparables.length,0);assert.deepEqual(r.excluded.map(s=>s.reason),['sale_outside_date_window','sale_outside_date_window','outside_search_radius','acreage_outside_policy','subject_property_sale']);
});
test('same-size land with a different published use code is not treated as comparable',()=>{
  const r=report([sale(1,{profile_at_sale:profile({parcel_id:'00-DIFFERENT',property_use_code:'OTHER'})})]);
  assert.equal(r.excluded[0].reason,'different_property_or_improvement_type');
});
test('duplicates and repeat flips do not inflate comparable parcel count',()=>{
  const first=sale(1),repeat=sale(9,{profile_at_sale:first.profile_at_sale,date:'2026-09-20'});
  const r=report([first,first,repeat,sale(2)]);assert.equal(r.comparables.length,2);
  assert.equal(r.observed_sales_summary,null);assert.ok(r.comparables.some(s=>s.id===repeat.id));
});
test('missing characteristics, stale sources and subject-record conflicts require research/review',()=>{
  assert.equal(report([],{subjectProfile:profile({latitude:null})}).reason,'subject_characteristics_missing');
  assert.equal(report([],{subjectProfile:profile({source:{...source,published_at:'2025-01-01T00:00:00Z'}})}).reason,'subject_source_stale');
  assert.equal(report([],{propertyRecord:record({acreage:50})}).reason,'subject_record_conflict');
  assert.equal(report([],{truncated:true}).reason,'candidate_search_incomplete');
});
test('invalid calendar dates and untrusted sources cannot enter comparable data',()=>{
  assert.throws(()=>normalizeSale(sale(1,{date:'2026-02-30'})),/valid sale date/);
  assert.throws(()=>normalizeSale(sale(1,{source:{...source,url:'https://evil.example/'}})),/approved/);
});
test('disabled comparison module makes no database calls',async()=>{
  const repository={job(){throw new Error('Must not execute');}};
  assert.equal((await queueMiniComp({env:{},repository})).status,'disabled');
  assert.equal((await afterPropertyResolved({env:{},repository})).status,'disabled');
});
test('staged import verifies counts and database lookup generates the private report',async()=>{
  const db=d1();const sourceId=await beginDataset({db,county:'Indian River',source,expectedProfiles:1,expectedSales:3});
  await importChunk({db,sourceId,profiles:[profile()],sales:[sale(1)]});
  await assert.rejects(finishDataset({db,sourceId}),/counts/);
  assert.equal((await createRepository(db,undefined,()=>now).generate(record())).reason,'county_sales_data_not_loaded');
  await importChunk({db,sourceId,sales:[sale(2),sale(3)]});await finishDataset({db,sourceId});
  const r=await createRepository(db,undefined,()=>now).generate(record());assert.equal(r.status,'preliminary_ready');
  assert.equal(r.comparables.length,3);db.sqlite.close();
});
test('each intake gets a placeholder; resolution adds report history without changing core records',async()=>{
  const db=d1();const env={MINI_COMPS_ENABLED:'true',MINI_COMP_DB:db,PROPERTY_RECORDS_ENABLED:'true'};
  assert.equal((await queueMiniComp({inquiryId:1,env})).status,'waiting_property');
  await afterPropertyResolved({inquiryId:1,env,result:{status:'needs_review',reason:'multiple_matches'}});
  const repo=createRepository(db);const h=(await repo.history(1)).results;
  assert.equal(h.length,2);assert.equal(JSON.parse(h[1].report_json).reason,'property_match_requires_review');
  assert.equal((await repo.history(2)).results.length,0);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='inquiries'").get().n,0);db.sqlite.close();
});
test('comparison errors do not erase the waiting report or reject the intake',async()=>{
  assert.equal((await queueMiniComp({inquiryId:1,env:{MINI_COMPS_ENABLED:'true'}})).reason,'mini_comp_database_missing');
  const reports=[];const repository={async job(){return {id:'synthetic-job'};},async generate(){throw new Error('offline');},async append(id,r){reports.push(r);}};
  assert.equal((await afterPropertyResolved({inquiryId:1,env:{MINI_COMPS_ENABLED:'true'},repository,result:{status:'matched',record:record()}})).status,'unavailable');
  assert.equal(reports[0].reason,'comparison_generation_failed');
});
test('property resolution callback is optional and runs after the saved research event',async()=>{
  const events=[];let callback;
  const repository={async enqueue(){return {id:'j',property_key:'primary',query_json:'{}'};},async lookup(){return {status:'matched',record:record()};},async append(){events.push('research_saved');}};
  await afterInquirySaved({inquiryId:1,input:{},env:{PROPERTY_RECORDS_ENABLED:'true'},repository,onPropertyResult:async payload=>{assert.equal(events[0],'research_saved');callback=payload;}});
  assert.equal(callback.inquiryId,1);assert.equal(callback.result.status,'matched');
});
test('private HTML escapes malicious text and labels tax values and insufficient results',()=>{
  const r=report([sale(1)]);r.subject.situs_address='<script>alert(1)</script>';r.limitations.push('<img src=x onerror=alert(1)>');
  const html=renderReport(r);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src='));
  assert.match(html,/assessment year 2026/);assert.match(html,/Insufficient data—review needed/);assert.match(html,/\$0/);
});
test('private CRM card denies access before reading inquiry reports',async()=>{
  const repository={async latest(){throw new Error('Must not read without authorization');}};
  await assert.rejects(miniCompCard({inquiryId:1,env:{MINI_COMPS_ENABLED:'true'},authorize:async()=>false,repository}),/access denied/);
  assert.equal(await miniCompCard({inquiryId:1,env:{},repository}),'');
  const html=await miniCompCard({inquiryId:1,env:{MINI_COMPS_ENABLED:'true'},authorize:async()=>true,repository:{async latest(){return {report_json:JSON.stringify(report())};}}});
  assert.match(html,/Property Mini Comp Report/);
});
test('matched intake research automatically stores a report in a separate database and renders its private card',async()=>{
  const propertyDb=d1(new URL('../../property-records/migration.sql',import.meta.url)),compDb=d1();
  const timestamp=new Date().toISOString();
  const currentSource={...source,published_at:timestamp,retrieved_at:timestamp};
  const subject=profile({source:currentSource});
  const currentRecord=record({source:{...currentSource,kind:'published_export'}});
  await ingestProperty({db:propertyDb,records:[currentRecord],source:{county:'Indian River',...currentRecord.source}});
  const sales=[1,2,3].map(n=>sale(n,{date:new Date(Date.now()-7*86400000).toISOString().slice(0,10),source:currentSource,
    profile_at_sale:profile({parcel_id:`00-SYNTHETIC-COMP-${n}`,latitude:27.7+n*0.001,source:currentSource})}));
  const sourceId=await beginDataset({db:compDb,county:'Indian River',source:currentSource,expectedProfiles:1,expectedSales:3});
  await importChunk({db:compDb,sourceId,profiles:[subject],sales});await finishDataset({db:compDb,sourceId});
  const env={PROPERTY_RECORDS_ENABLED:'true',PROPERTY_DB:propertyDb,MINI_COMPS_ENABLED:'true',MINI_COMP_DB:compDb};
  await queueMiniComp({inquiryId:77,env});
  const tasks=[];
  await afterInquirySaved({inquiryId:77,input:{county:'Indian River',parcel_id:subject.parcel_id},env,ctx:{waitUntil(p){tasks.push(p);}},
    onPropertyResult:payload=>afterPropertyResolved({...payload,env})});
  await Promise.all(tasks);
  const latest=await createRepository(compDb).latest(77);
  assert.equal(JSON.parse(latest.report_json).status,'preliminary_ready');
  assert.equal((await createRepository(compDb).history(77)).results.length,2);
  const html=await miniCompCard({inquiryId:77,env,authorize:async id=>id===77});
  assert.match(html,/Selected sales/);assert.match(html,/assessment year 2026/);
  propertyDb.sqlite.close();compDb.sqlite.close();
});
test('independently removing Mini Comps leaves core and the property-record integration usable',async()=>{
  const sourceCode=readFileSync(new URL('../../../workers/intake/worker.mjs',import.meta.url),'utf8')
    .replace(/^import.*queueMiniComp.*\n/m,'')
    .replace("'../../core/client-identity/identity.mjs'",JSON.stringify(new URL('../../../core/client-identity/identity.mjs',import.meta.url).href))
    .replace('    const miniComp = await queueMiniComp({ inquiryId, env });','')
    .replace('      onPropertyResult: payload => afterPropertyResolved({ ...payload, env })','')
    .replace('        mini_comp: miniComp,','')
    .replace("'../../modules/property-records/intake-hook.mjs'",JSON.stringify(new URL('../../property-records/intake-hook.mjs',import.meta.url).href));
  const stripped=await import(`data:text/javascript;base64,${Buffer.from(sourceCode).toString('base64')}`);
  const DB={prepare(){return {async first(){return null;},bind(){return {async run(){return {meta:{last_row_id:1}};}};}};}};
  const request=new Request('https://example.invalid/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inquiry_type:'Selling Property I Own',county:'Indian River',property_type:'Vacant / Acreage',first_name:'Synthetic',last_name:'Test',email:'synthetic@example.invalid',preferred_contact:'Email',rights_acknowledged:true,relationship_acknowledged:true})});
  const response=await stripped.default.fetch(request,{DB,SEND_EMAIL:{async send(){return {};}}});
  assert.equal(response.status,201);assert.equal((await response.json()).mini_comp,undefined);
});
