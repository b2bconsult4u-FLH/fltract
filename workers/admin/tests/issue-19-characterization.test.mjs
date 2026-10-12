import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker.mjs';
const source=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
// Characterization only: passing tests reproduce gaps, not security acceptance.
function functions(start,end,names){
  return new Function(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))+';return {'+names+'};')();
}
const {accessIdentity,staffContext,staffCan}=functions('function accessIdentity(', 'async function activeStaffUsers(', 'accessIdentity,staffContext,staffCan');
const {securityManagerAuthorized}=functions('function securityManagerAuthorized(', 'async function auditPage(', 'securityManagerAuthorized');
const {logStaffAccess}=functions('async function logStaffAccess(', '/* ============================================================\n   FLORIDA DATE', 'logStaffAccess');
function db(user=null){
 const writes=[];let current=user;
 return {writes,async batch(){return [];},prepare(sql){let args=[];return {
  bind(...v){args=v;return this;},async all(){return {results:[]};},
  async first(){if(sql.includes('FROM staff_users WHERE email'))return current;
   if(sql.includes('COUNT(*) AS n FROM staff_users'))return {n:0};
   if(sql.includes('SELECT status'))return {status:'New'};
   return {};},
  async run(){writes.push({sql,args});if(sql.includes('INSERT INTO staff_users'))current={id:1,email:args[0],active:1,role:'Administrator'};return {success:true};}
 };}}
}
test('GAP: unverified email header becomes identity without a JWT',()=>{
 const req=new Request('https://example.invalid/',{headers:{'Cf-Access-Authenticated-User-Email':'Spoof@example.invalid'}});
 assert.equal(accessIdentity(req),'spoof@example.invalid');
});
test('GAP: first header identity bootstraps Administrator on empty staff table',async()=>{
 const DB=db();const staff=await staffContext({DB},new Request('https://example.invalid/',{headers:{'Cf-Access-Authenticated-User-Email':'spoof@example.invalid'}}));
 assert.equal(staff.user.role,'Administrator');assert.ok(DB.writes.some(x=>x.sql.includes('INSERT INTO staff_users')));
});
test('GAP: anonymous root renders private dashboard inside Worker',async()=>{
 const response=await worker.fetch(new Request('https://example.invalid/'),{DB:db()});
 assert.equal(response.status,200);assert.match(await response.text(),/Property Inquiries/);
});
for(const role of [null,'Employee','CFO'])test(`GAP: ${role||'anonymous'} performs same-origin status write without capability check`,async()=>{
 const user=role?{id:9,email:'staff@example.invalid',active:1,role}:null;
 if(user)assert.equal(staffCan(user,'edit_clients'),false);
 const DB=db(user);const headers={Origin:'https://example.invalid','Content-Type':'application/x-www-form-urlencoded'};
 if(user)headers['Cf-Access-Authenticated-User-Email']=user.email;
 const response=await worker.fetch(new Request('https://example.invalid/inquiry/1/status',{method:'POST',headers,body:'status=Reviewing'}),{DB});
 assert.equal(response.status,303);assert.ok(DB.writes.some(x=>/UPDATE inquiries/.test(x.sql)));
});
test('registered Administrator retains audit-page access; inactive administrator is denied',()=>{
 assert.equal(securityManagerAuthorized({authenticated:true,user:{active:1,role:'Administrator'}}),true);
 assert.equal(securityManagerAuthorized({authenticated:true,user:{active:0,role:'Administrator'}}),false);
});
test('GAP: access audit storage failure is silently swallowed',async()=>{
 await assert.doesNotReject(logStaffAccess({DB:{prepare(){throw Error('isolated audit failure');}}},{},new Request('https://example.invalid/'),'Test','Denied'));
});
