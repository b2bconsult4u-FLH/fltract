import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../../../workers/intake/worker.mjs';

const payload = { inquiry_type:'Selling Property', county:'Indian River', property_type:'Industrial Property', first_name:'Synthetic', last_name:'Test', email:'synthetic@example.invalid', preferred_contact:'Email', rights_acknowledged:true, relationship_acknowledged:true, property_location:'SYNTHETIC LOCATION' };
function fixture({sendFails=false,saveFails=false}={}) {
  const writes=[]; const sends=[];
  const env={DB:{prepare(sql) { return { async first(){return null;}, async run(){writes.push({sql});return {meta:{last_row_id:1}};}, bind(...args){return { async first(){return null;},async run(){if(saveFails&&sql.includes('INSERT INTO inquiries')) throw Error('Synthetic save failure');writes.push({sql,args});return {meta:{last_row_id:1}};}};}};}, async batch(){throw Error('Synthetic account linkage unavailable');}},SEND_EMAIL:{async send(message){sends.push(message);if(sendFails)throw Error('Synthetic email failure');return {messageId:'synthetic'};}}};
  return {env,writes,sends};
}
function request(body,headers={}) {return new Request('https://intake.example/submit',{method:'POST',headers:{Origin:'https://fltract.com','Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});}
async function submit(body,options){const f=fixture(options);const response=await worker.fetch(request(body),f.env);return {...f,response,body:await response.json()};}

test('non-object and malformed JSON are rejected before database or email activity',async()=>{
  for(const body of ['null','[]','42','"text"','{','']) {const f=await submit(body);assert.equal(f.response.status,400,body);assert.equal(f.writes.length,0);assert.equal(f.sends.length,0);}
});
test('actual UTF-8 size limits JSON and URL encoded bodies without trusting Content-Length',async()=>{
  for(const [body,type] of [[JSON.stringify({...payload,details:'é'.repeat(9000)}),'application/json'],['details='+'x'.repeat(17000),'application/x-www-form-urlencoded']]) {
    const f=fixture();const r=await worker.fetch(request(body,{'Content-Type':type}),f.env);assert.equal(r.status,413);assert.equal(f.writes.length,0);assert.equal(f.sends.length,0);
  }
});
test('chunked body is cancelled as soon as it exceeds the byte limit',async()=>{
  let cancelled=false;const f=fixture();const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(9000));},cancel(){cancelled=true;}});
  const r=await worker.fetch(new Request('https://intake.example/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'}),f.env);
  assert.equal(r.status,413);assert.equal(cancelled,true);assert.equal(f.writes.length,0);
});
test('both honeypot names prevent writes and emails',async()=>{
  for(const name of ['website','company_website']) {const f=await submit({...payload,[name]:'bot'});assert.equal(f.response.status,200);assert.equal(f.writes.length,0);assert.equal(f.sends.length,0);}
});
test('phone preference requires explicit permission and a ten digit number',async()=>{
  for(const extra of [{preferred_contact:'Phone',phone:'7725550100'},{preferred_contact:'Either Email or Phone',phone:'7725550100'},{phone:'abc'},{preferred_contact:'Phone',phone:'123',live_call_opt_in:true},{live_call_opt_in:true}]) {
    const f=await submit({...payload,...extra});assert.equal(f.response.status,400,JSON.stringify(extra));assert.equal(f.writes.length,0);assert.equal(f.sends.length,0);
  }
});
test('current form inquiry options remain accepted and dedicated metadata is retained',async()=>{
  const form=readFileSync(new URL('../../../contact/index.html',import.meta.url),'utf8');
  const select=form.match(/<select name="inquiry_type"[^>]*>(.*?)<\/select>/s)[1];
  for(const [,inquiry_type] of select.matchAll(/<option>(.*?)<\/option>/g)) {
    const f=await submit({...payload,inquiry_type,timeframe:'Now',owner_status:'No',best_contact_time:'Morning',referral_source:'Other',source_page:'https://fltract.com/contact/',details:'Original details'});
    assert.equal(f.response.status,202); // Deliberately failed account link must enter recovery.
    assert.equal(f.body.account_processing_status,'pending_recovery');
    assert.equal(f.body.recovery_recorded,true);
    const insert=f.writes.find(w=>w.sql.includes('INSERT INTO inquiries'));
    assert.deepEqual(insert.args.slice(9,14),['Now','No','Morning','Other','https://fltract.com/contact/']);
    assert.equal(insert.args[16],'Original details');assert.equal(f.sends.length,2);
  }
});
test('email-only and authorized phone submissions survive email failure after saving',async()=>{
  for(const extra of [{},{preferred_contact:'Phone',phone:'7725550100',live_call_opt_in:true}]) {
    const f=await submit({...payload,...extra},{sendFails:true});assert.equal(f.response.status,202);assert.equal(f.body.acknowledgment_email,'failed');assert.equal(f.body.internal_notification_email,'failed');assert.equal(f.writes.filter(w=>w.sql.includes('INSERT INTO inquiries')).length,1);
  }
});
test('failed core save sends no email',async()=>{const f=await submit(payload,{saveFails:true});assert.equal(f.response.status,500);assert.equal(f.sends.length,0);});
test('preflight and denied origins perform no database writes',async()=>{
  for(const [origin,status] of [['https://fltract.com',204],['https://www.fltract.com',204],['https://evil.example',403]]) {const f=fixture();const r=await worker.fetch(new Request('https://intake.example/submit',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}),f.env);assert.equal(r.status,status);assert.equal(f.writes.length,0);}
});
test('owner-approved live form is enabled and inline script parses',()=>{const html=readFileSync(new URL('../../../contact/index.html',import.meta.url),'utf8');assert.match(html,/const PUBLIC_SUBMISSIONS_ENABLED=true;/);new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);});

function browserFixture({phone='',preferred='Email',liveCall=false,responseErrors=[]}={}) {
  const handlers={};
  function element(value='') {return {value,checked:false,required:false,hidden:true,disabled:false,customValidity:'',classList:{add(){},remove(){}},addEventListener(){},removeAttribute(){},setAttribute(){},closest(){return null;},scrollIntoView(){},focus(){},setCustomValidity(value){this.customValidity=value;},checkValidity(){return !this.customValidity&&(!this.required||Boolean(this.value))&&(!this.isPhone||!this.value||/^\d{10}$/.test(this.value));}};}
  const elements=Object.fromEntries(Object.entries({...payload,required_acknowledgments:'yes',company_website:'',source_page:''}).map(([k,v])=>[k,element(v)]));
  elements.phone=element(phone);elements.phone.isPhone=true;elements.preferred_contact=element(preferred);elements.live_call_opt_in=element();elements.live_call_opt_in.checked=liveCall;
  const status=element();const button=element();let fetches=0;let resets=0;
  const form={elements,querySelector(){return button;},querySelectorAll(){return [];},addEventListener(name,fn){handlers[name]=fn;},reset(){resets++;},scrollIntoView(){}};
  const ids={'fltract-intake':form,'form-status':status,'source_page':elements.source_page};
  const document={getElementById(id){return ids[id]||(ids[id]=element());},addEventListener(){}};
  const html=readFileSync(new URL('../../../contact/index.html',import.meta.url),'utf8');
  // Exercise the real enabled form in an isolated VM with no live HTTP or mail.
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script,{document,window:{location:{href:'https://fltract.com/contact/'}},setTimeout(){},FormData:class {entries(){return Object.entries(payload);}get(name){return name==='required_acknowledgments'?'yes':'';}},async fetch(){fetches++;return {ok:false,async json(){return {ok:false,errors:responseErrors};}};}});
  return {status,button,elements,submit:()=>handlers.submit({preventDefault(){}}),get fetches(){return fetches;},get resets(){return resets;}};
}
test('browser stops malformed optional phone and unauthorized call before fetch',async()=>{
  for(const options of [{phone:'123'},{phone:'7725550100',preferred:'Phone'}]) {const f=browserFixture(options);await f.submit();assert.equal(f.fetches,0);assert.match(f.status.innerHTML,/marked in red/);}
});
test('browser preserves entries and shows server validation errors as plain text',async()=>{
  const f=browserFixture({responseErrors:['Select a valid county.','<b>untrusted</b>']});await f.submit();assert.equal(f.fetches,1);assert.equal(f.resets,0);assert.equal(f.button.disabled,false);assert.match(f.status.textContent,/Select a valid county\. <b>untrusted<\/b>/);assert.match(f.status.textContent,/entries have not been cleared/);
});
