import {createRemoteJWKSet, jwtVerify} from 'jose';

// Cache key resolvers, never identities or request state. Bound cache cardinality.
const resolvers = new Map();
export async function verifiedAccessIdentity(request, env, testKeyResolver) {
  const issuer = String(env.ACCESS_ISSUER || '');
  const audience = String(env.ACCESS_AUDIENCE || '');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience) {
    throw new Error('Access verification is not configured.');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new Error('Access token required.');
  let resolver = testKeyResolver || resolvers.get(issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {timeoutDuration:5000});
    if (resolvers.size >= 4) resolvers.clear();
    resolvers.set(issuer, resolver);
  }
  const {payload} = await jwtVerify(token, resolver, {
    issuer, audience, algorithms:['RS256'], requiredClaims:['exp','iat','sub','email'],
  });
  if (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(payload.email)) {
    throw new Error('A user identity is required.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now()/1000)) {
    throw new Error('Invalid token issue time.');
  }
  return payload.email.trim().toLowerCase();
}

export function sameOriginWrite(request) {
  if (request.method !== 'POST') return false;
  const target = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin !== null) return origin === target;
  const referer = request.headers.get('Referer');
  if (referer !== null) {
    try { return new URL(referer).origin === target; } catch { return false; }
  }
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export const PRIVATE_ROUTES = [
  ['GET', /^\/$/, 'view_clients'],
  ['GET', /^\/clients$/, 'view_clients'],
  ['GET', /^\/followups$/, 'manage_followups'],
  ['GET', /^\/my-work$/, 'admin_access'],
  ['GET', /^\/export\.csv$/, 'export_data', 'global'],
  ['GET', /^\/security-audit$/, 'view_audit', 'global'],
  ['GET', /^\/intake-recovery$/, 'manage_assignments', 'recovery'],
  ['GET', /^\/client\/(\d+)$/, 'view_clients', 'client'],
  ['POST', /^\/client\/(\d+)\/(?:assign|assignment\/\d+\/end)$/, 'manage_assignments', 'client'],
  ['GET', /^\/inquiry\/(\d+)$/, 'view_clients', 'inquiry'],
  ['POST', /^\/inquiry\/(\d+)\/(?:status|note|archive|restore)$/, 'edit_clients', 'inquiry'],
  ['POST', /^\/inquiry\/(\d+)\/(?:followup|followup-complete)$/, 'manage_followups', 'inquiry'],
  ['POST', /^\/inquiry\/(\d+)\/permission$/, 'edit_clients', 'inquiry'],
  ['POST', /^\/inquiry\/(\d+)\/referral$/, 'prepare_referrals', 'inquiry'],
  ['POST', /^\/inquiry\/(\d+)\/referral-send$/, 'approve_referrals', 'inquiry'],
  ['GET', /^\/property\/(\d+)$/, 'view_clients', 'property'],
  ['POST', /^\/property\/(\d+)\/update$/, 'edit_clients', 'property'],
  ['POST', /^\/property\/(\d+)\/(?:assign|assignment\/\d+\/end)$/, 'manage_assignments', 'property'],
  ['POST', /^\/property\/(\d+)\/(?:official-research|mini-comp\/(?:save|comparable|comparable\/\d+\/(?:delete|review)))$/, 'research_property', 'property'],
  ['POST', /^\/property\/(\d+)\/mini-comp\/approve$/, 'approve_reports', 'property'],
  ['GET', /^\/property\/(\d+)\/(?:mini-comp(?:\/report)?|library)$/, 'review_reports', 'property'],
  ['GET', /^\/library\/item\/(\d+)$/, 'review_reports', 'library-item'],
  ['GET', /^\/library\/version\/(\d+)$/, 'review_reports', 'library-version'],
  ['GET', /^\/work-routing$/, 'admin_access'],
  ['GET', /^\/work-routing\/(\d+)(?:\/history)?$/, 'admin_access', 'work'],
  ['POST', /^\/work-routing\/(\d+)\/progress$/, 'admin_access', 'work'],
  ['POST', /^\/work-routing\/(\d+)\/(?:deadline|redirect)$/, 'manage_assignments', 'work'],
  // These handlers process work across all teams; a manager's record scope
  // must not grant permission to invoke business-wide routing or escalation.
  ['POST', /^\/work-routing\/(?:run|check-deadlines)$/, 'manage_assignments', 'global'],
  ['GET', /^\/training$/, 'admin_access'],
  ['POST', /^\/training\/start$/, 'admin_access'],
  ['GET', /^\/training\/manage$/, 'manage_assignments'],
  ['POST', /^\/training\/session\/(\d+)\/review$/, 'manage_assignments'],
  ['GET', /^\/sops$/, 'admin_access'],
  ['POST', /^\/sops\/requirement\/(\d+)\/acknowledge$/, 'admin_access'],
  ['GET', /^\/sops\/manage$/, 'manage_assignments'],
  ['POST', /^\/sops\/(\d+)\/(?:new-version|publish)$/, 'manage_assignments'],
  ['GET', /^\/dry-run$/, 'manage_assignments', 'global'],
  ['POST', /^\/dry-run$/, 'manage_assignments', 'global'],
  ['GET', /^\/integrity$/, 'manage_assignments', 'global'],
  ['POST', /^\/integrity\/scan$/, 'manage_assignments', 'global'],
  ['POST', /^\/integrity\/(\d+)\/review$/, 'manage_assignments', 'global'],
];

export function privateRoute(request) {
  const path = new URL(request.url).pathname;
  for (const [method, pattern, capability, scope] of PRIVATE_ROUTES) {
    const match = pattern.exec(path);
    if (method === request.method && match) return {capability,scope,id:Number(match[1])};
  }
  return null;
}

export function broadRecords(user) {
  return !!user?.active && ['Administrator','CEO'].includes(user.role);
}

// Mirrors the existing assignment policy; IDs come from the registered staff row.
export function clientScopeSQL(user, idExpression) {
  if (broadRecords(user)) return '1=1';
  const id = Number(user?.id);
  if (!user?.active || !Number.isSafeInteger(id) || id <= 0) return '0=1';
  const team = user.role === 'Manager' ? ` OR EXISTS (
    SELECT 1 FROM staff_teams st
    JOIN staff_team_members tm ON tm.team_id=st.id AND tm.active=1
    JOIN client_assignments tca ON tca.staff_user_id=tm.staff_user_id AND tca.active=1
    WHERE st.active=1 AND st.manager_staff_user_id=${id} AND tca.client_id=${idExpression}
  )` : '';
  return `(EXISTS (SELECT 1 FROM client_assignments sca WHERE sca.client_id=${idExpression} AND sca.staff_user_id=${id} AND sca.active=1)
    OR EXISTS (SELECT 1 FROM property_assignments spa JOIN properties sp ON sp.id=spa.property_id
      WHERE sp.client_id=${idExpression} AND spa.staff_user_id=${id} AND spa.active=1)${team})`;
}

export function inquiryScopeSQL(user, idExpression) {
  if (broadRecords(user)) return '1=1';
  return `EXISTS (SELECT 1 FROM client_inquiries sci WHERE sci.inquiry_id=${idExpression} AND ${clientScopeSQL(user,'sci.client_id')})`;
}

// IDs are registered staff IDs; aliases/expressions are fixed by callers.
export function workTargetScopeSQL(user, idExpression) {
  if (broadRecords(user)) return '1=1';
  const id = Number(user?.id);
  if (!user?.active || !Number.isSafeInteger(id) || id <= 0) return '0=1';
  const team = user.role === 'Manager' ? ` OR EXISTS (
    SELECT 1 FROM staff_teams wt
    JOIN staff_team_members wm ON wm.team_id=wt.id AND wm.active=1
    JOIN staff_users wu ON wu.id=wm.staff_user_id AND wu.active=1
    WHERE wt.active=1 AND wt.manager_staff_user_id=${id} AND wu.id=${idExpression}
  )` : '';
  return `(${idExpression}=${id}${team})`;
}

export function workScopeSQL(user, alias='w') {
  if (broadRecords(user)) return '1=1';
  const id = Number(user?.id);
  if (!user?.active || !Number.isSafeInteger(id) || id <= 0) return '0=1';
  // A populated assignee ID wins over a stale or conflicting legacy email.
  return `EXISTS (SELECT 1 FROM staff_users wa WHERE wa.active=1
    AND (${alias}.assigned_staff_user_id=wa.id
      OR (${alias}.assigned_staff_user_id IS NULL AND lower(${alias}.assigned_staff_email)=lower(wa.email)))
    AND ${workTargetScopeSQL(user,'wa.id')})`;
}

export async function workRecordAuthorized(env, user, id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id)<=0) return false;
  const row=await env.DB.prepare(`SELECT 1 AS ok FROM flt_work_items w
    WHERE w.id=? AND ${workScopeSQL(user)} LIMIT 1`).bind(Number(id)).first();
  return row?.ok===1;
}

export async function routeAuthorized(env, staff, request, checks) {
  const rule = privateRoute(request);
  if (!rule) return {allowed:false,status:404,reason:'Unknown private route or method.'};
  if (!checks.staffCan(staff.user, rule.capability)) return {allowed:false,status:403,reason:'Capability denied.'};
  if (request.method === 'POST' && !sameOriginWrite(request)) return {allowed:false,status:403,reason:'Request origin denied.'};
  const deny = {allowed:false,status:403,reason:'Record scope denied.'};
  if (rule.scope === 'global' && !broadRecords(staff.user)) return deny;
  if (rule.scope === 'recovery' && !['Administrator','CEO','Manager'].includes(staff.user.role)) return deny;
  if (['client','property'].includes(rule.scope)) {
    if (!Number.isSafeInteger(rule.id) || rule.id <= 0) return deny;
    const check = rule.scope === 'client' ? checks.staffHasClientScope : checks.staffHasPropertyScope;
    if (!await check(env,staff.user,rule.id)) return deny;
  }
  if (rule.scope === 'inquiry' && !broadRecords(staff.user)) {
    const row = await env.DB.prepare('SELECT client_id FROM client_inquiries WHERE inquiry_id=? LIMIT 1').bind(rule.id).first();
    if (!row || !await checks.staffHasClientScope(env,staff.user,row.client_id)) return deny;
  }
  if (rule.scope === 'library-item' || rule.scope === 'library-version') {
    const sql = rule.scope === 'library-item'
      ? 'SELECT property_id FROM report_library_items WHERE id=? LIMIT 1'
      : 'SELECT rli.property_id FROM report_library_versions rlv JOIN report_library_items rli ON rli.id=rlv.library_item_id WHERE rlv.id=? LIMIT 1';
    const row = await env.DB.prepare(sql).bind(rule.id).first();
    if (!row || !await checks.staffHasPropertyScope(env,staff.user,row.property_id)) return deny;
  }
  const assignment=/^\/(client|property)\/(\d+)\/(assign|assignment\/(\d+)\/end)$/.exec(new URL(request.url).pathname);
  if (request.method==='POST' && assignment) {
    let target;
    if (assignment[3]==='assign') {
      target=Number((await request.clone().formData()).get('staff_user_id'));
    } else {
      const table=assignment[1]==='client'?'client_assignments':'property_assignments';
      const key=assignment[1]==='client'?'client_id':'property_id';
      const row=await env.DB.prepare(`SELECT staff_user_id FROM ${table}
        WHERE id=? AND ${key}=? AND active=1 LIMIT 1`).bind(Number(assignment[4]),rule.id).first();
      target=Number(row?.staff_user_id);
    }
    if (!Number.isSafeInteger(target) || target<=0) return deny;
    const row=await env.DB.prepare(`SELECT 1 AS ok FROM staff_users target
      WHERE target.id=? AND target.active=1 AND ${workTargetScopeSQL(staff.user,'target.id')} LIMIT 1`).bind(target).first();
    if (row?.ok!==1) return deny;
  }
  if (rule.scope === 'work') {
    if (!await workRecordAuthorized(env,staff.user,rule.id)) return deny;
    if (/\/redirect$/.test(new URL(request.url).pathname)) {
      const form=await request.clone().formData();
      const target=Number(form.get('target_staff_id'));
      if (!Number.isSafeInteger(target) || target<=0) return deny;
      const row=await env.DB.prepare(`SELECT 1 AS ok FROM staff_users target
        WHERE target.id=? AND target.active=1 AND ${workTargetScopeSQL(staff.user,'target.id')} LIMIT 1`).bind(target).first();
      if (row?.ok!==1) return deny;
    }
  }
  return {allowed:true,rule};
}

export async function securityAudit(env, staff, request, result, note, correlationId) {
  const event = {event:'private_access',actor:staff?.email || '',role:staff?.user?.role || '',
    path:new URL(request.url).pathname,method:request.method,result,note,correlationId};
  console.log(JSON.stringify(event));
  const saved = await env.DB.prepare(`INSERT INTO staff_access_log
    (staff_user_id,email,event_type,route,method,result,note) VALUES (?,?,?,?,?,?,?)`)
    .bind(staff?.user?.id || null,event.actor,'Private Request',event.path,event.method,result,
      JSON.stringify({reason:note,correlationId}).slice(0,1000)).run();
  if (!saved.success) throw new Error('Security audit was not persisted.');
}

export function securityResponse(message, status) {
  return new Response(message,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}
