import assert from 'node:assert/strict';

// Frozen PR24 candidate: only fltract-preview D1, deliberately no email binding.
// Never replace this with the production endpoint or accept arbitrary URLs.
const base='https://2c07ff7d-fltract-intake-5a25.b2bconsult4u.workers.dev';
const marker='SYNTHETIC-PR24-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
assert.ok(process.env.GITHUB_RUN_ID,'Run only in the designated acceptance workflow');
const origin='https://fltract.com';
async function probe(path,options={},status=200){
 const response=await fetch(base+path,{...options,redirect:'manual',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,status,`${options.method||'GET'} ${path}: unexpected status ${response.status}`);
 return response;
}
const post=(body,contentType='application/json')=>({method:'POST',headers:{Origin:origin,'Content-Type':contentType},body});
const health=await (await probe('/')).json();assert.equal(health.ok,true);
const preflight=await probe('/submit',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}},204);
assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
await probe('/submit',{method:'OPTIONS',headers:{Origin:'https://evil.example','Access-Control-Request-Method':'POST'}},403);
await probe('/submit',{},405);
for(const body of ['{','null','[]'])await probe('/submit',post(body),400);
await probe('/submit',post(JSON.stringify({details:'x'.repeat(17000)})),413);
await probe('/submit',post('upload','multipart/form-data; boundary=synthetic'),415);
await probe('/submit',post('{}'),400);
console.log('Health, CORS, route and rejected-payload checks passed.');
const payload={inquiry_type:'Selling Property',county:'Indian River',property_type:'Vacant / Acreage',property_location:marker,first_name:'Synthetic',last_name:'Acceptance',email:'pr24-acceptance@example.invalid',preferred_contact:'Email',rights_acknowledged:true,relationship_acknowledged:true,marketing_email_opt_in:false,live_call_opt_in:false,timeframe:'Just Exploring',owner_status:'No',best_contact_time:'Morning',referral_source:'Other',source_page:'https://fltract.com/contact/',details:'TEST ONLY. Isolated preview D1 runtime acceptance; no actual property or client.'};
const saved=await (await probe('/submit',post(JSON.stringify(payload)),201)).json();
assert.equal(saved.ok,true);assert.ok(Number.isInteger(saved.inquiry_id));
assert.equal(saved.account_processing_status,'complete');
assert.equal(saved.acknowledgment_email,'failed','No real email binding exists in this test version');
assert.equal(saved.internal_notification_email,'failed');
console.log(JSON.stringify({marker,inquiry_id:saved.inquiry_id,account_processing_status:saved.account_processing_status,email_delivery:'intentionally disabled'}));
if(process.env.GITHUB_STEP_SUMMARY){const {appendFileSync}=await import('node:fs');appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Isolated intake runtime acceptance\n\nCandidate: 2c07ff7d-9979-4394-9601-3a2a705f5a0d\n\nMarker: ${marker}\n\nPreview inquiry: ${saved.inquiry_id}\n\nHealth/CORS/negative-input checks and save/link response passed. Email intentionally disabled. D1 record evidence must be checked separately.\n`);}
