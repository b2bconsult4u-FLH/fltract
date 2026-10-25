import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import worker from '../worker.mjs';
import {verifiedAccessIdentity,sameOriginWrite,PRIVATE_ROUTES,privateRoute,routeAuthorized,clientScopeSQL,inquiryScopeSQL} from '../security.mjs';
const source=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
function productionFunctions(start,end,names){
 return new Function(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))+';return {'+names+'};')();
}
const {staffCan}=productionFunctions('function staffCan(', 'async function activeStaffUsers(', 'staffCan');
const {securityManagerAuthorized}=productionFunctions('function securityManagerAuthorized(', 'async function auditPage(', 'securityManagerAuthorized');
const envConfig={ACCESS_ISSUER:'https://security-test.cloudflareaccess.com',ACCESS_AUDIENCE:'test-audience'};
const keys=await generateKeyPair('RS256',{extractable:true});
const jwk=await exportJWK(keys.publicKey);jwk.kid='test-key';jwk.alg='RS256';
const jwks={keys:[jwk]};const local=createLocalJWKSet(jwks);
const now=Math.floor(Date.now()/1000);
async function token(claims={},key=keys.privateKey){
 const payload={iss:envConfig.ACCESS_ISSUER,aud:envConfig.ACCESS_AUDIENCE,sub:'synthetic-user',email:'owner@example.invalid',iat:now,exp:now+3600,...claims};
 for(const k of Object.keys(payload))if(payload[k]===undefined)delete payload[k];
 return new SignJWT(payload).setProtectedHeader({alg:'RS256',kid:'test-key'}).sign(key);
}
const validToken=await token();
function request(path='/',{jwt=validToken,method='GET',origin,spoof,body}={}){
 const headers={};if(jwt!==null)headers['Cf-Access-Jwt-Assertion']=jwt;
 if(spoof)headers['Cf-Access-Authenticated-User-Email']=spoof;
 if(origin!==undefined)headers.Origin=origin;
 if(body)headers['Content-Type']='application/x-www-form-urlencoded';
 return new Request('https://example.invalid'+path,{method,headers,body});
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
 assert.equal(String(url),'https://security-test.cloudflareaccess.com/cdn-cgi/access/certs');
 return new Response(JSON.stringify(jwks),{headers:{'content-type':'application/json'}});
};
test.after(()=>{globalThis.fetch=originalFetch;});
function fakeDB({role='Administrator',active=1,unknown=false,scope=false,auditFailure=false}={}){
 const calls=[];const user={id:9,email:'owner@example.invalid',active,role};
 return {calls,async batch(stmts){calls.push({kind:'schema-batch'});return stmts.map(()=>({success:true}));},prepare(sql){let args=[];return {
  bind(...a){args=a;return this;},async all(){calls.push({kind:'read',sql,args});return {results:[]};},
  async first(){calls.push({kind:'read',sql,args});
   if(sql.includes('FROM staff_users WHERE LOWER(email)'))return unknown?null:user;
   if(sql.includes('SELECT status'))return {status:'New'};
   if(sql.includes('SELECT client_id FROM client_inquiries'))return {client_id:10};
   if(sql.includes('SELECT 1 AS ok'))return scope?{ok:1}:null;
   if(sql.includes('SELECT client_id FROM properties'))return {client_id:10};
   return {};},
  async run(){calls.push({kind:'write',sql,args});if(auditFailure&&sql.includes('INSERT INTO staff_access_log'))throw Error('synthetic audit outage');return {success:true,meta:{changes:1}};}
 };}}
}
function businessWrites(DB){return DB.calls.filter(c=>c.kind==='write'&&!c.sql.includes('staff_access_log'));}
const paths=['/','/clients','/followups','/my-work','/export.csv','/security-audit','/intake-recovery','/inquiry/1','/inquiry/1/status','/client/1','/property/1','/property/1/update','/library/item/1','/library/version/1','/work-routing','/training','/sops','/integrity','/dry-run'];
for(const path of paths)test(`anonymous/spoofed identity rejected before DB: ${path}`,async()=>{
 const DB=fakeDB();for(const jwt of [null,'invalid']){
  const r=await worker.fetch(request(path,{jwt,spoof:'owner@example.invalid',method:path.endsWith('/status')||path.endsWith('/update')?'POST':'GET',origin:'https://example.invalid'}),{...envConfig,DB});
  assert.equal(r.status,401);
 }assert.equal(DB.calls.length,0);
});
test('verified JWT identity ignores conflicting email header',async()=>{
 assert.equal(await verifiedAccessIdentity(request('/',{spoof:'attacker@example.invalid'}),envConfig,local),'owner@example.invalid');
});
for(const [name,claims] of [
 ['wrong issuer',{iss:'https://other.cloudflareaccess.com'}],['wrong audience',{aud:'other'}],
 ['expired',{exp:now-60}],['future nbf',{nbf:now+3600}],['future iat',{iat:now+3600}],
 ['missing email',{email:undefined}],['missing exp',{exp:undefined}],['missing sub',{sub:undefined}],['malformed email',{email:'not-an-email'}],
])test(`JWT rejected: ${name}`,async()=>{
 await assert.rejects(verifiedAccessIdentity(request('/',{jwt:await token(claims)}),envConfig,local));
});
test('invalid signature rejected',async()=>{
 const other=await generateKeyPair('RS256');await assert.rejects(verifiedAccessIdentity(request('/',{jwt:await token({},other.privateKey)}),envConfig,local));
});
test('missing verification config fails closed',async()=>{
 await assert.rejects(verifiedAccessIdentity(request(),{},local));
});
for(const settings of [{unknown:true},{active:0}])test(`unknown/inactive verified staff denied without bootstrap: ${JSON.stringify(settings)}`,async()=>{
 const DB=fakeDB(settings);const r=await worker.fetch(request(),{...envConfig,DB});assert.equal(r.status,403);
 assert.equal(businessWrites(DB).length,0);assert.ok(!DB.calls.some(c=>c.kind==='schema-batch'));
 assert.ok(DB.calls.some(c=>c.sql?.includes('INSERT INTO staff_access_log')&&c.args.includes('Denied')));
});
test('existing Administrator retains root and recovery access with verified JWT',async()=>{
 const DB=fakeDB();for(const path of ['/','/intake-recovery']){
  const r=await worker.fetch(request(path),{...envConfig,DB});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 }assert.equal(securityManagerAuthorized({authenticated:true,user:{active:1,role:'Administrator'}}),true);
 assert.equal(securityManagerAuthorized({authenticated:true,user:{active:0,role:'Administrator'}}),false);
});
for(const role of ['Employee','CFO'])test(`${role} status write denied before business writes`,async()=>{
 const DB=fakeDB({role});const r=await worker.fetch(request('/inquiry/1/status',{method:'POST',origin:'https://example.invalid',body:'status=Reviewing'}),{...envConfig,DB});
 assert.equal(r.status,403);assert.equal(businessWrites(DB).length,0);
});
test('Administrator status write succeeds with verified actor audit',async()=>{
 const DB=fakeDB();const r=await worker.fetch(request('/inquiry/1/status',{method:'POST',origin:'https://example.invalid',body:'status=Reviewing'}),{...envConfig,DB});
 assert.equal(r.status,303);assert.ok(businessWrites(DB).some(c=>c.sql.includes('UPDATE inquiries')));
 const audits=DB.calls.filter(c=>c.sql?.includes('INSERT INTO staff_access_log'));
 assert.ok(audits.some(c=>c.args.includes('Attempt')&&c.args.includes('owner@example.invalid')));
 assert.ok(audits.some(c=>c.args.includes('Completed')));
});
test('audit outage blocks operation before business changes',async()=>{
 const DB=fakeDB({auditFailure:true});const r=await worker.fetch(request('/inquiry/1/status',{method:'POST',origin:'https://example.invalid',body:'status=Reviewing'}),{...envConfig,DB});
 assert.equal(r.status,503);assert.equal(businessWrites(DB).length,0);
});
test('mismatching Origin cannot be rescued by Referer or Fetch-Site',()=>{
 const r=new Request('https://example.invalid/inquiry/1/status',{method:'POST',headers:{Origin:'https://attacker.invalid',Referer:'https://example.invalid/','Sec-Fetch-Site':'same-origin'}});
 assert.equal(sameOriginWrite(r),false);
});
test('unknown routes/methods fail closed without business queries',async()=>{
 for(const [path,method] of [['/unmapped','GET'],['/','DELETE'],['/inquiry/1/status','GET']]){
  const DB=fakeDB();const r=await worker.fetch(request(path,{method}),{...envConfig,DB});assert.equal(r.status,404);assert.equal(businessWrites(DB).length,0);
 }
});
for(const role of ['Employee','Manager'])for(const path of ['/inquiry/1','/client/10','/property/10'])test(`${role} cannot read unassigned record ${path}`,async()=>{
 const DB=fakeDB({role,scope:false});const r=await worker.fetch(request(path),{...envConfig,DB});assert.equal(r.status,403);assert.equal(businessWrites(DB).length,0);
});
test('record scope checked before route handlers; assigned Manager may edit',async()=>{
 const DB=fakeDB({role:'Manager',scope:true});const r=await worker.fetch(request('/inquiry/1/status',{method:'POST',origin:'https://example.invalid',body:'status=Reviewing'}),{...envConfig,DB});assert.equal(r.status,303);
});
test('route capability map denies lower roles for referral send and report approval',async()=>{
 const staff={user:{id:9,active:1,role:'Employee'}};
 for(const path of ['/inquiry/1/referral-send','/property/1/mini-comp/approve','/export.csv']){
  const decision=await routeAuthorized({},staff,request(path,{method:path==='/export.csv'?'GET':'POST',origin:'https://example.invalid'}),{staffCan});assert.equal(decision.allowed,false);
 }
});
test('private route map declares every implemented route family',()=>{
 assert.ok(PRIVATE_ROUTES.length>=38);
 for(const path of ['/inquiry/1/followup-complete','/client/1/assignment/2/end','/property/1/mini-comp/comparable/2/delete','/work-routing/run','/work-routing/1/redirect','/training/session/1/review','/sops/requirement/1/acknowledge'])assert.ok(privateRoute(request(path,{method:'POST',origin:'https://example.invalid'})),path);
});
test('SQL filters exclude unassigned client/inquiry rows and preserve Administrator global scope',()=>{
 const DB=new DatabaseSync(':memory:');DB.exec(`
 CREATE TABLE clients(id INTEGER PRIMARY KEY);INSERT INTO clients VALUES(10),(20),(30);
 CREATE TABLE client_assignments(client_id INTEGER,staff_user_id INTEGER,active INTEGER);INSERT INTO client_assignments VALUES(10,9,1),(20,8,1);
 CREATE TABLE properties(id INTEGER PRIMARY KEY,client_id INTEGER);INSERT INTO properties VALUES(101,10),(201,20),(301,30);
 CREATE TABLE property_assignments(property_id INTEGER,staff_user_id INTEGER,active INTEGER);INSERT INTO property_assignments VALUES(301,9,1);
 CREATE TABLE staff_teams(id INTEGER,manager_staff_user_id INTEGER,active INTEGER);INSERT INTO staff_teams VALUES(1,7,1);
 CREATE TABLE staff_team_members(team_id INTEGER,staff_user_id INTEGER,active INTEGER);INSERT INTO staff_team_members VALUES(1,8,1);
 CREATE TABLE client_inquiries(client_id INTEGER,inquiry_id INTEGER);INSERT INTO client_inquiries VALUES(10,1),(20,2),(30,3);
 CREATE TABLE inquiries(id INTEGER PRIMARY KEY);INSERT INTO inquiries VALUES(1),(2),(3),(4);
 `);
 const user={id:9,role:'Employee',active:1};
 assert.deepEqual(DB.prepare(`SELECT c.id FROM clients c WHERE ${clientScopeSQL(user,'c.id')}`).all().map(r=>r.id),[10,30]);
 assert.deepEqual(DB.prepare(`SELECT i.id FROM inquiries i WHERE ${inquiryScopeSQL(user,'i.id')}`).all().map(r=>r.id),[1,3]);
 assert.deepEqual(DB.prepare(`SELECT c.id FROM clients c WHERE ${clientScopeSQL({id:7,role:'Manager',active:1},'c.id')}`).all().map(r=>r.id),[20]);
 assert.equal(DB.prepare(`SELECT COUNT(*) n FROM clients c WHERE ${clientScopeSQL({id:1,role:'Administrator',active:1},'c.id')}`).get().n,3);
 DB.close();
});

test('private lists render only scoped synthetic data using real SQLite',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return {sql,bind(...a){args=a;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(stmts){sqlite.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const start=source.indexOf('async function ensureClientSchema(env) {');const end=source.indexOf('async function ensureClientForInquiry(',start);
 const ensure=new Function('let clientSchemaReady=false;'+source.slice(start,end)+';return ensureClientSchema;')();
 await ensure({DB});
 sqlite.exec(`CREATE TABLE inquiries(id INTEGER PRIMARY KEY,first_name TEXT,last_name TEXT,email TEXT,phone TEXT,inquiry_type TEXT,county TEXT,property_type TEXT,property_location TEXT,acreage TEXT,improvements TEXT,status TEXT,archived INTEGER,created_at TEXT,follow_up_status TEXT,next_follow_up_date TEXT);
 CREATE TABLE compliance_rules(rule_key TEXT,rule_value TEXT);
 CREATE TABLE follow_ups(id INTEGER PRIMARY KEY,inquiry_id INTEGER,due_date TEXT,reason TEXT,status TEXT);
 INSERT INTO staff_users(id,email,role,active) VALUES(9,'owner@example.invalid','Employee',1);
 INSERT INTO clients(id,normalized_email,first_name) VALUES(10,'one@example.invalid','VisibleClient'),(20,'two@example.invalid','HiddenClient');
 INSERT INTO inquiries VALUES(1,'VisibleInquiry','Test','one@example.invalid','','Selling Property','Indian River','Land','Synthetic Visible Parcel','1','No','New',0,'2026-10-01','Open','2026-10-01'),(2,'HiddenInquiry','Test','two@example.invalid','','Selling Property','Indian River','Land','Synthetic Hidden Parcel','1','No','New',0,'2026-10-01','Open','2026-10-01');
 INSERT INTO client_inquiries(client_id,inquiry_id) VALUES(10,1),(20,2);
 INSERT INTO client_assignments(client_id,staff_user_id,active) VALUES(10,9,1);
 INSERT INTO follow_ups VALUES(1,1,'2026-10-01','VisibleFollowup','Open'),(2,2,'2026-10-01','HiddenFollowup','Open');
 INSERT INTO flt_work_items(id,work_type,title,assigned_staff_user_id,assigned_staff_email,status) VALUES(1,'Test','VisibleTask',9,'owner@example.invalid','Assigned'),(2,'Test','HiddenTask',8,'other@example.invalid','Assigned');
 `);
 try{
  for(const [path,visible,hidden] of [['/','VisibleInquiry','HiddenInquiry'],['/clients','VisibleClient','HiddenClient'],['/followups','VisibleFollowup','HiddenFollowup'],['/work-routing','VisibleTask','HiddenTask']]){
   const r=await worker.fetch(request(path),{...envConfig,DB});assert.equal(r.status,200,path);
   assert.equal(r.headers.get('referrer-policy'),'same-origin',path+' must support same-origin forms without disclosing external referrers');
   const html=await r.text();assert.ok(html.includes(visible),path+' visible row');assert.ok(!html.includes(hidden),path+' hidden row');
  }
 }finally{sqlite.close();}
});

test('audit chain handles concurrent append and long reason canonicalization with real SQLite',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(`CREATE TABLE flt_audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_uuid TEXT UNIQUE,occurred_at TEXT,actor_staff_user_id INTEGER,actor_email TEXT,actor_role TEXT,action TEXT,subject_type TEXT,subject_id TEXT,outcome TEXT,reason TEXT,metadata_json TEXT,request_method TEXT,request_path TEXT,previous_hash TEXT,event_hash TEXT);`);
 const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args);},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}};
 const {appendAuditEvent,verifyAuditChain}=productionFunctions('function auditUuid()', 'function integrityAuthorized(', 'appendAuditEvent,verifyAuditChain');
 try{
  await Promise.all(Array.from({length:4},(_,i)=>appendAuditEvent({DB},{staff:{email:'owner@example.invalid',user:{id:9,role:'Administrator'}},action:'Synthetic Test',subjectType:'Test',subjectId:i+1,reason:'x'.repeat(1200)})));
  assert.deepEqual(await verifyAuditChain({DB}),{valid:true,count:4});
 }finally{sqlite.close();}
});

test('all private read/write route variants reject anonymous and forged JWTs before DB',async()=>{
 const get=['/','/clients','/followups','/my-work','/export.csv','/security-audit','/intake-recovery','/client/1','/inquiry/1','/property/1','/property/1/mini-comp','/property/1/mini-comp/report','/property/1/library','/library/item/1','/library/version/1','/work-routing','/work-routing/1','/work-routing/1/history','/training','/training/manage','/sops','/sops/manage','/dry-run','/integrity'];
 const post=['/client/1/assign','/client/1/assignment/2/end','/property/1/assign','/property/1/assignment/2/end',...['status','note','archive','restore','followup','followup-complete','permission','referral','referral-send'].map(a=>'/inquiry/1/'+a),...['update','official-research','mini-comp/save','mini-comp/comparable','mini-comp/comparable/2/delete','mini-comp/comparable/2/review','mini-comp/approve'].map(a=>'/property/1/'+a),'/work-routing/1/progress','/work-routing/1/deadline','/work-routing/1/redirect','/work-routing/run','/work-routing/check-deadlines','/training/start','/training/session/1/review','/sops/requirement/1/acknowledge','/sops/1/new-version','/sops/1/publish','/dry-run','/integrity/scan','/integrity/1/review'];
 for(const [method,paths] of [['GET',get],['POST',post]])for(const path of paths){
  assert.ok(privateRoute(request(path,{method,origin:'https://example.invalid'})),method+' '+path);
  for(const jwt of [null,'forged.jwt.assertion']){
   const DB=fakeDB();const r=await worker.fetch(request(path,{method,jwt,spoof:'owner@example.invalid',origin:'https://example.invalid'}),{...envConfig,DB});assert.equal(r.status,401,method+' '+path);assert.equal(DB.calls.length,0);
  }
 }
});

test('library parent and task assignment checks deny guessed IDs',async()=>{
 for(const path of ['/library/item/1','/library/version/1','/work-routing/1','/work-routing/1/history']){
  const DB=fakeDB({role:'Employee'});const r=await worker.fetch(request(path),{...envConfig,DB});assert.equal(r.status,403,path);assert.equal(businessWrites(DB).length,0);
 }
});

test('global integrity/export operations are denied to assigned Manager',async()=>{
 for(const path of ['/export.csv','/integrity','/dry-run']){
  const DB=fakeDB({role:'Manager',scope:true});const r=await worker.fetch(request(path),{...envConfig,DB});assert.equal(r.status,403,path);assert.equal(businessWrites(DB).length,0);
 }
});

test('candidate review denies authenticated staff outside their property scope',async()=>{
 for(const role of ['Employee','Manager']) {
  const DB=fakeDB({role,scope:false});
  const r=await worker.fetch(request('/property/1/mini-comp/comparable/2/review',{method:'POST',origin:'https://example.invalid',body:'qualified_sale=Yes&selection_reason=Synthetic+evidence'}),{...envConfig,DB});
  assert.equal(r.status,403,role);
  assert.equal(businessWrites(DB).length,0);
 }
});

test('recovery HTTP route isolates managers with real team SQL and signed identities',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(stmts){sqlite.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const start=source.indexOf('async function ensureClientSchema(env) {');
 const end=source.indexOf('async function ensureClientForInquiry(',start);
 const ensure=new Function('let clientSchemaReady=false;'+source.slice(start,end)+';return ensureClientSchema;')();
 await ensure({DB});
 sqlite.exec(`
 CREATE TABLE inquiries(id INTEGER PRIMARY KEY,first_name TEXT,last_name TEXT,county TEXT,property_location TEXT);
 CREATE TABLE compliance_rules(rule_key TEXT,rule_value TEXT);
 CREATE TABLE intake_recovery_queue(inquiry_id INTEGER PRIMARY KEY,status TEXT,attempts INTEGER,last_error TEXT,updated_at TEXT);
 INSERT INTO staff_users(id,email,role,active) VALUES
 (9,'owner@example.invalid','Manager',1),(19,'second@example.invalid','Manager',1),
 (11,'a@example.invalid','Employee',1),(21,'b@example.invalid','Employee',1),
 (12,'ended@example.invalid','Employee',1),(13,'inactive-team@example.invalid','Employee',1);
 INSERT INTO staff_teams(id,name,manager_staff_user_id,active) VALUES(1,'A',9,1),(2,'B',19,1),(3,'Inactive',9,0);
 INSERT INTO staff_team_members(team_id,staff_user_id,active) VALUES(1,11,1),(2,21,1),(1,12,0),(3,13,1);
 `);
 const fixtures=[
  [1,'TeamA',11,'a@example.invalid'],[2,'TeamB',21,'b@example.invalid'],
  [3,'OwnManager',9,'owner@example.invalid'],[4,'Unassigned',null,''],
  [5,'EndedMember',12,'ended@example.invalid'],[6,'InactiveTeam',13,'inactive-team@example.invalid'],
  [7,'LegacyEmail',null,'A@EXAMPLE.INVALID'],[8,'ConflictingEmail',21,'a@example.invalid'],
  [9,'LatestOtherTeam',21,'b@example.invalid'],[10,'NoWorkItem',null,'']
 ];
 for(const [id,label,assignee,email] of fixtures){
  sqlite.prepare('INSERT INTO inquiries VALUES(?,?,?,?,?)').run(id,label+'Client','Synthetic',label+'County',label+'Parcel');
  sqlite.prepare('INSERT INTO intake_recovery_queue VALUES(?,?,?,?,?)').run(id,'Retry Pending',1,label+'Error','2026-10-01');
  if(id!==10)sqlite.prepare("INSERT INTO flt_work_items(id,work_type,title,subject_type,subject_id,assigned_staff_user_id,assigned_staff_email,status) VALUES(?,'Intake Recovery',?,'inquiry',?,?,?,'Assigned')").run(id,label,id,assignee,email);
 }
 // An earlier assignment must not expose a recovery item now owned by another team.
 sqlite.prepare("INSERT INTO flt_work_items(id,work_type,title,subject_type,subject_id,assigned_staff_user_id,status) VALUES(0,'Intake Recovery','Old assignment','inquiry',9,11,'Completed')").run();
 const snapshot=()=>JSON.stringify(['inquiries','intake_recovery_queue','flt_work_items','staff_teams','staff_team_members'].map(table=>sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
 const before=snapshot();
 try{
  for(const [email,visible] of [['owner@example.invalid',[1,3,7]],['second@example.invalid',[2,8,9]]]){
   const r=await worker.fetch(request('/intake-recovery',{jwt:await token({email})}),{...envConfig,DB});
   assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   const html=await r.text();
   for(const [id,label] of fixtures){
    for(const suffix of ['Client','County','Parcel','Error'])assert.equal(html.includes(label+suffix),visible.includes(id),email+' '+label+suffix);
    assert.equal(html.includes(`/work-routing/${id}\"`),visible.includes(id),email+' task '+id);
   }
  }
  for(const role of ['Administrator','CEO']){
   sqlite.prepare('UPDATE staff_users SET role=? WHERE id=9').run(role);
   const r=await worker.fetch(request('/intake-recovery'),{...envConfig,DB});assert.equal(r.status,200);
   const html=await r.text();for(const [,label] of fixtures)assert.ok(html.includes(label+'Client'),role+' '+label);
  }
  assert.equal(snapshot(),before,'recovery reads must not change business records');
 }finally{sqlite.close();}
});
