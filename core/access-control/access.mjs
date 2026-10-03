import { PERMISSIONS, STARTER_ROLES, validateGrants } from './policy.mjs';
const SUPPORT_PERMISSIONS=['users.manage','roles.manage','settings.manage','audit.view','business.view','clients.view','reports.view','tasks.view'];
const TOKEN_TTL=8*60*60*1000;
export const SESSION_COOKIE='__Host-fltract_session';
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=200;
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function event(db,{businessId=null,userId=null,sessionId=null,type,now,kind=null,id=null}){
 return db.prepare('INSERT INTO access_events(business_id,user_id,session_id,event,occurred_at,resource_kind,resource_id) VALUES(?,?,?,?,?,?,?)').bind(businessId,userId,sessionId,type,now,kind,id);
}
// Trusted bootstrap only; never expose directly as a public route.
export async function seedRoles(db,businessId){
 const statements=[];
 for(const role of STARTER_ROLES){
  if(await db.prepare('SELECT 1 AS present FROM roles WHERE business_id=? AND id=?').bind(businessId,role.id).first())continue;
  statements.push(db.prepare('INSERT INTO roles(business_id,id,name) VALUES(?,?,?)').bind(businessId,role.id,role.name));
  statements.push(...role.grants.map(g=>db.prepare('INSERT INTO role_grants(business_id,role_id,permission,scope) VALUES(?,?,?,?)').bind(businessId,role.id,g.permission,g.scope)));
 }
 if(statements.length)await db.batch(statements);
}
export async function startSession({db,verifiedIdentity,businessId,now=Date.now()}){
 // Identity must come from the host's verified OIDC/Access adapter, never parsed headers or request JSON.
 if(!verifiedIdentity||!identifier(verifiedIdentity.issuer)||!identifier(verifiedIdentity.subject)||!identifier(businessId))throw Error('verified_identity_required');
 const member=await db.prepare(`SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id
   WHERE u.issuer=? AND u.subject=? AND m.business_id=? AND m.active=1`).bind(verifiedIdentity.issuer,verifiedIdentity.subject,businessId).first();
 if(!member)throw Error('membership_required');
 const token=crypto.randomUUID()+crypto.randomUUID(),sessionId=crypto.randomUUID(),expiresAt=now+TOKEN_TTL;
 await db.batch([
  db.prepare('INSERT INTO sessions(id,token_hash,business_id,user_id,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(sessionId,await hash(token),businessId,member.id,now,expiresAt),
  event(db,{businessId,userId:member.id,sessionId,type:'login',now})
 ]);
 return {sessionId,expiresAt,cookie:`${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${TOKEN_TTL/1000}`};
}
export function sessionToken(request){
 const cookies=(request.headers.get('Cookie')||'').split(';').map(c=>c.trim());
 const matches=cookies.filter(c=>c.startsWith(SESSION_COOKIE+'='));
 return matches.length===1?matches[0].slice(SESSION_COOKIE.length+1):null;
}
export async function authenticate({db,token,now=Date.now()}){
 if(typeof token!=='string'||token.length!==72)throw Error('authentication_required');
 const row=await db.prepare(`SELECT s.*,m.active FROM sessions s JOIN memberships m
   ON m.business_id=s.business_id AND m.user_id=s.user_id WHERE s.token_hash=?`).bind(await hash(token)).first();
 if(!row){
  const support=await db.prepare(`SELECT s.*,o.active FROM support_sessions s JOIN platform_owners o ON o.user_id=s.user_id WHERE s.token_hash=?`).bind(await hash(token)).first();
  if(!support||support.ended_at!==null||!support.active||support.expires_at<=now)throw Error('authentication_required');
  return {businessId:support.business_id,userId:support.user_id,sessionId:support.id,support:true};
 }
 if(row.ended_at!==null)throw Error('authentication_required');
 if(row.expires_at<=now){await closeSession(db,row,'expired',row.expires_at);throw Error('session_expired');}
 if(!row.active){await closeSession(db,row,'revoked',now);throw Error('membership_inactive');}
 return {businessId:row.business_id,userId:row.user_id,sessionId:row.id};
}
async function closeSession(db,row,reason,now){
 await db.batch([
  db.prepare(`INSERT INTO access_events(business_id,user_id,session_id,event,occurred_at)
    SELECT business_id,user_id,id,?,? FROM sessions WHERE id=? AND ended_at IS NULL`).bind(reason,now,row.id),
  db.prepare('UPDATE sessions SET ended_at=?,end_reason=? WHERE id=? AND ended_at IS NULL').bind(now,reason,row.id)
 ]);
}
export async function logout({db,token,now=Date.now()}){
 if(typeof token==='string'&&token.length===72){const row=await db.prepare('SELECT * FROM sessions WHERE token_hash=?').bind(await hash(token)).first();if(row)await closeSession(db,row,row.expires_at<=now?'expired':'logout',Math.min(now,row.expires_at));else {
 const support=await db.prepare('SELECT * FROM support_sessions WHERE token_hash=?').bind(await hash(token)).first();
 if(support)await closeSupport(db,support,now);
 }}
 return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}
export async function requirePermission({db,token,permission,resource,now=Date.now()}){
 if(!PERMISSIONS.includes(permission))throw Error('unknown_permission');
 const principal=await authenticate({db,token,now});
 if(principal.support){if(!SUPPORT_PERMISSIONS.includes(permission))throw Error('access_denied');}
 const rows=await db.prepare(`SELECT g.scope FROM member_roles mr JOIN role_grants g ON
   g.business_id=mr.business_id AND g.role_id=mr.role_id WHERE mr.business_id=? AND mr.user_id=? AND g.permission=?`)
   .bind(principal.businessId,principal.userId,permission).all();
 const scopes=principal.support?['business']:(rows.results||[]).map(r=>r.scope);
 let owned=null;
 if(resource){
  if(!identifier(resource.kind)||!identifier(resource.id))throw Error('invalid_resource');
  owned=await db.prepare('SELECT * FROM resources WHERE business_id=? AND kind=? AND id=?').bind(principal.businessId,resource.kind,resource.id).first();
  if(!owned)throw Error('access_denied');
  const expected={clients:'client',reports:'inquiry',tasks:'task',finance:'finance'}[permission.split('.')[0]];
  if(expected&&resource.kind!==expected)throw Error('access_denied');
 }
 if(scopes.includes('business'))return principal;
 if(!owned)throw Error('access_denied');
 if(scopes.includes('assigned')&&owned.assigned_user_id===principal.userId)return principal;
 if(scopes.includes('team')&&owned.team_id){const team=await db.prepare('SELECT 1 AS present FROM team_members WHERE business_id=? AND team_id=? AND user_id=?').bind(principal.businessId,owned.team_id,principal.userId).first();if(team)return principal;}
 throw Error('access_denied');
}
export async function saveRole({db,token,roleId,name,grants,now=Date.now()}){
 const p=await requirePermission({db,token,permission:'roles.manage',now});
 if(!identifier(roleId)||!identifier(name))throw Error('invalid_role');
 const validated=validateGrants(grants);
 // Custom roles can only grant permissions already possessed by the actor.
 for(const g of validated){if(p.support){if(!SUPPORT_PERMISSIONS.includes(g.permission))throw Error('grant_escalation_denied');continue;}const existing=await db.prepare(`SELECT g.scope FROM member_roles mr JOIN role_grants g ON g.business_id=mr.business_id AND g.role_id=mr.role_id WHERE mr.business_id=? AND mr.user_id=? AND g.permission=?`).bind(p.businessId,p.userId,g.permission).all();if(!(existing.results||[]).some(r=>r.scope==='business'||r.scope===g.scope))throw Error('grant_escalation_denied');}
 // Protect actor's current roles from being edited through this interface.
 if(await db.prepare('SELECT 1 AS present FROM member_roles WHERE business_id=? AND user_id=? AND role_id=?').bind(p.businessId,p.userId,roleId).first())throw Error('self_role_change_denied');
 await db.batch([
  db.prepare('INSERT INTO roles(business_id,id,name) VALUES(?,?,?) ON CONFLICT(business_id,id) DO UPDATE SET name=excluded.name').bind(p.businessId,roleId,name),
  db.prepare('DELETE FROM role_grants WHERE business_id=? AND role_id=?').bind(p.businessId,roleId),
  ...validated.map(g=>db.prepare('INSERT INTO role_grants(business_id,role_id,permission,scope) VALUES(?,?,?,?)').bind(p.businessId,roleId,g.permission,g.scope)),
  event(db,{...p,type:'role_changed',now,kind:'role',id:roleId})
 ]);
}
export async function revokeMember({db,token,userId,now=Date.now()}){
 const p=await requirePermission({db,token,permission:'users.manage',now});
 if(userId===p.userId||!identifier(userId))throw Error('invalid_revocation');
 await db.batch([
  db.prepare('UPDATE memberships SET active=0 WHERE business_id=? AND user_id=?').bind(p.businessId,userId),
  db.prepare(`INSERT INTO access_events(business_id,user_id,session_id,event,occurred_at) SELECT business_id,user_id,id,'revoked',? FROM sessions WHERE business_id=? AND user_id=? AND ended_at IS NULL`).bind(now,p.businessId,userId),
  db.prepare("UPDATE sessions SET ended_at=?,end_reason='revoked' WHERE business_id=? AND user_id=? AND ended_at IS NULL").bind(now,p.businessId,userId),
  event(db,{...p,type:'member_revoked',now,kind:'user',id:userId})
 ]);
}
export async function expireSessions(db,now=Date.now()){
 const rows=await db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL AND expires_at<=? ORDER BY expires_at LIMIT 100').bind(now).all();
 for(const row of rows.results||[])await closeSession(db,row,'expired',row.expires_at);
 return (rows.results||[]).length;
}
export async function accessLog({db,token,beforeId=Number.MAX_SAFE_INTEGER,limit=50,now=Date.now()}){
 const p=await requirePermission({db,token,permission:'audit.view',now});
 if(!Number.isSafeInteger(beforeId)||beforeId<1||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('invalid_page');
 return (await db.prepare('SELECT * FROM access_events WHERE business_id=? AND id<? ORDER BY id DESC LIMIT ?').bind(p.businessId,beforeId,limit).all()).results||[];
}
async function closeSupport(db,row,now){
 const reason=row.expires_at<=now?'expired':'logout';
 await db.batch([
  db.prepare(`INSERT INTO access_events(business_id,user_id,session_id,event,occurred_at) SELECT business_id,user_id,id,?,? FROM support_sessions WHERE id=? AND ended_at IS NULL`).bind('support_'+reason,Math.min(now,row.expires_at),row.id),
  db.prepare('UPDATE support_sessions SET ended_at=?,end_reason=? WHERE id=? AND ended_at IS NULL').bind(Math.min(now,row.expires_at),reason,row.id)
 ]);
}
export async function startOwnerSupport({db,verifiedIdentity,businessId,reason,now=Date.now()}){
 // Host adapter must verify a fresh MFA/step-up authentication, not trust request claims.
 if(!verifiedIdentity||verifiedIdentity.mfaVerified!==true||!Number.isFinite(verifiedIdentity.authenticatedAt)||verifiedIdentity.authenticatedAt>now||now-verifiedIdentity.authenticatedAt>5*60*1000)throw Error('fresh_owner_mfa_required');
 if(!identifier(businessId)||typeof reason!=='string'||reason.trim().length<10||reason.length>500)throw Error('support_reason_required');
 const owner=await db.prepare(`SELECT u.id FROM users u JOIN platform_owners o ON o.user_id=u.id WHERE u.issuer=? AND u.subject=? AND o.active=1`).bind(verifiedIdentity.issuer,verifiedIdentity.subject).first();
 if(!owner)throw Error('platform_owner_required');
 const token=crypto.randomUUID()+crypto.randomUUID(),sessionId=crypto.randomUUID(),expiresAt=now+30*60*1000;
 await db.batch([
  db.prepare('INSERT INTO support_sessions(id,token_hash,business_id,user_id,reason,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(sessionId,await hash(token),businessId,owner.id,reason.trim(),now,expiresAt),
  event(db,{businessId,userId:owner.id,sessionId,type:'support_started',now})
 ]);
 return {sessionId,expiresAt,cookie:`${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`};
}
export async function assignRole({db,token,userId,roleId,now=Date.now()}){
 const p=await requirePermission({db,token,permission:'users.manage',now});
 await requirePermission({db,token,permission:'roles.manage',now});
 if(!identifier(userId)||!identifier(roleId)||p.userId===userId)throw Error('invalid_assignment');
 const member=await db.prepare('SELECT active FROM memberships WHERE business_id=? AND user_id=?').bind(p.businessId,userId).first();
 if(!member?.active)throw Error('active_member_required');
 const grants=(await db.prepare('SELECT permission,scope FROM role_grants WHERE business_id=? AND role_id=?').bind(p.businessId,roleId).all()).results||[];
 for(const g of grants)await requirePermission({db,token,permission:g.permission,now}); // Actor must possess business-wide grant to delegate it.
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO member_roles(business_id,user_id,role_id) VALUES(?,?,?)').bind(p.businessId,userId,roleId),
  event(db,{...p,type:'role_assigned',now,kind:'user',id:userId})
 ]);
}
export async function expireSupportSessions(db,now=Date.now()){
 const rows=await db.prepare('SELECT * FROM support_sessions WHERE ended_at IS NULL AND expires_at<=? ORDER BY expires_at LIMIT 100').bind(now).all();
 for(const row of rows.results||[])await closeSupport(db,row,now);
 return (rows.results||[]).length;
}
// Call only from a trusted, rate-limited authentication adapter. No attempted password/token is accepted.
export async function recordLoginFailure({db,businessId=null,userId=null,now=Date.now()}){
 if((businessId!==null&&!identifier(businessId))||(userId!==null&&!identifier(userId)))throw Error('invalid_identity_reference');
 await event(db,{businessId,userId,type:'login_failed',now}).run();
}
