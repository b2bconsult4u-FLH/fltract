import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryForInquiry,createInvitation,handleQuestionnaire} from '../workers/intake/questionnaire.mjs';
test('routes common intake types into tailored qualification categories',()=>{
 assert.equal(categoryForInquiry('Finding Property to Buy'),'buyer');
 assert.equal(categoryForInquiry('Selling Property'),'seller');
 assert.equal(categoryForInquiry('Licensed Broker Referral'),'broker');
});
test('rejects missing, malformed or forged questionnaire credentials',async()=>{
 const env={DB:{prepare:()=>({run:async()=>({})})}};
 for(const token of ['', '12345']){
   const res=await handleQuestionnaire(new Request('https://example.com/questionnaire?token='+token),env);
   assert.equal(res.status,403);
 }
});
test('invitation binds to inquiry with hashed secret, not a public numeric id',async()=>{
 let inserted;
 const db={prepare(sql){return {bind(...args){inserted={sql,args};return this;},run:async()=>({})};}};
 const url=await createInvitation(db,42,'Selling Property','https://intake.example.com');
 const token=new URL(url).searchParams.get('token');
 assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal(inserted.args[0],42);
 assert.notEqual(inserted.args[1],token);
 assert.equal(inserted.args[1].length,64);
 assert.equal(inserted.args[3],'seller');
});

function fixture(category='buyer', emailEnabled=true){
 const records=new Map(), sent=[];
 const db={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async run(){
   if(sql.startsWith('INSERT INTO intake_questionnaires')){records.set(args[1],{inquiry_id:args[0],token_hash:args[1],expires_at:args[2],category:args[3],status:'Invited',answers_json:'{}'});return {meta:{changes:1}};}
   if(sql.startsWith('UPDATE intake_questionnaires')){const r=records.get(args[5]);if(!r||r.status==='Completed')return {meta:{changes:0}};Object.assign(r,{answers_json:args[0],status:args[1],consent_version:args[2],completed_at:args[1]==='Completed'?'2026-10-22':null});return {meta:{changes:1}};}
   return {meta:{changes:0}};
 },async first(){return records.get(args[0])||null;}};}};
 const env={DB:db};if(emailEnabled)env.SEND_EMAIL={async send(message){sent.push(message);}};
 return {db,env,records,sent};
}
const submit=(token,answers)=>new Request('https://intake.example.com/questionnaire',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Origin':'https://intake.example.com'},body:new URLSearchParams({token,...answers})});
test('completed buyer questionnaire stays on the same inquiry and sends one office-only notice',async()=>{
 const f=fixture(),url=await createInvitation(f.db,42,'Finding Property to Buy','https://intake.example.com');
 const token=new URL(url).searchParams.get('token');
 const saved=await handleQuestionnaire(submit(token,{intent:'save',area:'Vero Beach'}),f.env);
 assert.equal(saved.status,200);
 assert.equal([...f.records.values()][0].status,'Partially Completed');
 assert.equal(f.sent.length,0);
 const incomplete=await handleQuestionnaire(submit(token,{intent:'complete',area:'Vero Beach',use:'Business',sharing:'yes'}),f.env);
 assert.equal(incomplete.status,400);
 const completed=await handleQuestionnaire(submit(token,{intent:'complete',area:'Vero Beach',use:'Business',budget:'Not sure',sharing:'yes'}),f.env);
 assert.equal(completed.status,200);
 const record=[...f.records.values()][0];
 assert.equal(f.records.size,1);
 assert.equal(record.inquiry_id,42);
 assert.equal(record.status,'Completed');
 assert.equal(JSON.parse(record.answers_json).area,'Vero Beach');
 assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].to,'fltractoffice@gmail.com');
 assert.match(f.sent[0].subject,/Questionnaire Completed/);
 assert.doesNotMatch(f.sent[0].text,/Vero Beach|Business|Not sure/);
 await handleQuestionnaire(submit(token,{intent:'complete',area:'Vero Beach',use:'Business',budget:'Not sure',sharing:'yes'}),f.env);
 assert.equal(f.sent.length,1);
});
test('questionnaire completion is stored even when office mail is not configured',async()=>{
 const f=fixture('seller',false),url=await createInvitation(f.db,19,'Selling Property','https://intake.example.com');
 const token=new URL(url).searchParams.get('token');
 const res=await handleQuestionnaire(submit(token,{intent:'complete',authority:'Owner',sharing:'yes'}),f.env);
 assert.equal(res.status,200);
 assert.equal([...f.records.values()][0].status,'Completed');
});
test('questionnaire rejects cross-origin submission and completion without authorization',async()=>{
 const f=fixture(),url=await createInvitation(f.db,77,'Finding Property to Buy','https://intake.example.com');
 const token=new URL(url).searchParams.get('token');
 const cross=submit(token,{intent:'complete',area:'Vero Beach',use:'Business',budget:'Not sure',sharing:'yes'});
 cross.headers.set('Origin','https://attacker.example');
 assert.equal((await handleQuestionnaire(cross,f.env)).status,403);
 assert.equal((await handleQuestionnaire(submit(token,{intent:'complete',area:'Vero Beach',use:'Business',budget:'Not sure'}),f.env)).status,400);
 assert.equal([...f.records.values()][0].status,'Invited');
});

test('stale concurrent completion does not send a second office email',async()=>{
 const f=fixture(),url=await createInvitation(f.db,88,'Selling Property','https://intake.example.com');
 const token=new URL(url).searchParams.get('token');
 const originalPrepare=f.db.prepare.bind(f.db);
 let forceLostRace=true;
 f.db.prepare=(sql)=>{
   const stmt=originalPrepare(sql);
   if(sql.startsWith('UPDATE intake_questionnaires')&&forceLostRace){
     const originalRun=stmt.run.bind(stmt);
     stmt.run=async()=>{forceLostRace=false;await originalRun();return {meta:{changes:0}};};
   }
   return stmt;
 };
 const res=await handleQuestionnaire(submit(token,{intent:'complete',authority:'Owner',sharing:'yes'}),f.env);
 assert.equal(res.status,200);
 assert.equal([...f.records.values()][0].status,'Completed');
 assert.equal(f.sent.length,0);
});
