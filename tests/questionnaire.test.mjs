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
