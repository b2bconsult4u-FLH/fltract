const TTL_SECONDS = 86400;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const utf8 = value => new TextEncoder().encode(value);
async function signingKey(secret) {
  if (typeof secret !== 'string' || utf8(secret).length < 32) throw new Error('A continuation signing secret of at least 32 bytes is required.');
  return crypto.subtle.importKey('raw',utf8(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function clean(value,max) {
  if (typeof value !== 'string' || value.length > max || !value.trim()) throw new Error('Invalid client identity field.');
  return value.trim();
}
export async function clientContact({ firstName, lastName, email }) {
  const first = clean(firstName,100),last = clean(lastName,100),address = clean(email,254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Invalid client email.');
  const canonical = JSON.stringify([first.normalize('NFKC').toLowerCase(),last.normalize('NFKC').toLowerCase(),address]);
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8(canonical)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  return {first_name:first,last_name:last,email:address,email_normalized:address,identity_fingerprint:fingerprint};
}
export function reference(prefix,id) {
  if (!Number.isSafeInteger(id) || id < 1 || !/^[A-Z][A-Z0-9-]{0,20}$/.test(prefix)) throw new Error('Invalid reference configuration.');
  return `${prefix}-${String(id).padStart(6,'0')}`;
}
async function issueToken(client,secret,now) {
  const payload=encode(utf8(JSON.stringify({v:1,c:client.public_uuid,h:client.identity_fingerprint,exp:Math.floor(now.getTime()/1000)+TTL_SECONDS})));
  const signature=await crypto.subtle.sign('HMAC',await signingKey(secret),utf8(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
async function verifyToken(token,secret,now) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  try {
    const parts=token.split('.');
    if(parts.length!==2 || !parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part))) return null;
    if(!await crypto.subtle.verify('HMAC',await signingKey(secret),decode(parts[1]),utf8(parts[0]))) return null;
    const value=JSON.parse(new TextDecoder().decode(decode(parts[0]))),epoch=Math.floor(now.getTime()/1000);
    if(value.v!==1 || typeof value.c!=='string' || typeof value.h!=='string' || !Number.isInteger(value.exp) || value.exp<=epoch || value.exp>epoch+TTL_SECONDS+60) return null;
    return value;
  } catch { return null; }
}

// Use only AFTER the inquiry is saved. Client references never authorize CRM access.
export async function linkClient({ db, inquiryId, contact, continuationToken, secret, clientPrefix='C', inquiryPrefix='I', now=new Date() }) {
  if (!Number.isSafeInteger(inquiryId) || inquiryId < 1) throw new Error('Invalid saved inquiry ID.');
  reference(clientPrefix,1);reference(inquiryPrefix,inquiryId);
  await signingKey(secret); // Fail before writes if token configuration is absent.
  const identity=await clientContact(contact);
  const existing=await db.prepare(`SELECT c.*,l.review_required,l.link_basis FROM inquiry_client_links l
    JOIN clients c ON c.id=l.client_id WHERE l.inquiry_id=?`).bind(inquiryId).first();
  if(existing) {
    // A retry must not return another client's continuation token for changed contact data.
    if(existing.identity_fingerprint!==identity.identity_fingerprint) throw new Error('Existing inquiry identity does not match.');
    return {status:'linked',client_reference:reference(clientPrefix,existing.id),inquiry_reference:reference(inquiryPrefix,inquiryId),
      review_required:!!existing.review_required,continuation_token:await issueToken(existing,secret,now)};
  }
  let client,reason='new_client',basis='new_submission',review=0;
  if(continuationToken) {
    const token=await verifyToken(continuationToken,secret,now);
    if(token && token.h===identity.identity_fingerprint) {
      client=await db.prepare('SELECT * FROM clients WHERE public_uuid=? AND identity_fingerprint=?').bind(token.c,token.h).first();
    }
    if(client) {reason='signed_submission_continuity';basis='signed_continuation';}
    else {reason='invalid_expired_or_changed_contact_continuation';review=1;}
  }
  // Shared emails (even with similar names) are review candidates, never automatic merges.
  const candidates=client ? [] : (await db.prepare('SELECT id FROM clients WHERE email_normalized=? ORDER BY id LIMIT 20').bind(identity.email_normalized).all()).results || [];
  if(candidates.length && !client) {review=1;if(reason==='new_client') reason='shared_email_requires_review';}
  const uuid=client?.public_uuid || crypto.randomUUID(), timestamp=now.toISOString();
  const statements=[];
  if(!client) statements.push(db.prepare(`INSERT INTO clients
    (public_uuid,first_name,last_name,email,email_normalized,identity_fingerprint,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(uuid,identity.first_name,identity.last_name,identity.email,identity.email_normalized,identity.identity_fingerprint,timestamp));
  statements.push(db.prepare(`INSERT INTO inquiry_client_links (inquiry_id,client_id,link_basis,review_required,linked_at)
    SELECT ?,id,?,?,? FROM clients WHERE public_uuid=?`).bind(inquiryId,basis,review,timestamp,uuid));
  statements.push(db.prepare(`INSERT INTO client_identity_events (inquiry_id,client_id,action,reason,candidate_client_ids_json,created_at)
    SELECT ?,id,?,?,?,? FROM clients WHERE public_uuid=?`)
    .bind(inquiryId,client?'ReturningClientLinked':'NewClientCreated',reason,JSON.stringify(candidates.map(c=>c.id)),timestamp,uuid));
  // D1 batch is transactional: no orphan client if the link/event write fails.
  await db.batch(statements);
  client=await db.prepare('SELECT * FROM clients WHERE public_uuid=?').bind(uuid).first();
  return {status:'linked',client_reference:reference(clientPrefix,client.id),inquiry_reference:reference(inquiryPrefix,inquiryId),
    review_required:!!review,continuation_token:await issueToken(client,secret,now)};
}

export async function afterInquirySaved({ inquiryId, contact, input, env }) {
  let inquiryReference;
  try { inquiryReference=reference(env.INQUIRY_REFERENCE_PREFIX || 'FLT-I',inquiryId); }
  catch { inquiryReference=reference('FLT-I',inquiryId); }
  if(env.CLIENT_IDENTITIES_ENABLED!=='true') return {status:'disabled',inquiry_reference:inquiryReference};
  try {
    return await linkClient({db:env.DB,inquiryId,contact,continuationToken:input.client_continuation_token,
      secret:env.CLIENT_CONTINUATION_SECRET,clientPrefix:env.CLIENT_REFERENCE_PREFIX || 'FLT-C',
      inquiryPrefix:env.INQUIRY_REFERENCE_PREFIX || 'FLT-I'});
  } catch {
    console.error('Client identity linking unavailable; saved inquiry retained for repair.');
    return {status:'unavailable',inquiry_reference:inquiryReference};
  }
}
