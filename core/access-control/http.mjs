import { requirePermission, sessionToken, startSession } from './access.mjs';
// Host integration wrappers, not a deployed login endpoint.
export function requireSameOrigin(request,expectedOrigin){
 const origin=new URL(expectedOrigin).origin;
 if(new URL(request.url).origin!==origin||request.headers.get('Origin')!==origin)throw Error('origin_denied');
 if(!['POST','PUT','PATCH','DELETE'].includes(request.method))throw Error('mutation_method_required');
}
export async function loginFromProvider({request,db,businessId,verifyIdentity,expectedOrigin,now=Date.now()}){
 requireSameOrigin(request,expectedOrigin);
 if(typeof verifyIdentity!=='function')throw Error('identity_verifier_required');
 const verifiedIdentity=await verifyIdentity(request); // Must verify signature, issuer, audience, expiry and replay/CSRF protections.
 return startSession({db,verifiedIdentity,businessId,now});
}
export function crmAuthorizer({request,db,permission,kind,now=Date.now()}){
 const token=sessionToken(request);
 return async id=>{
  try{await requirePermission({db,token,permission,resource:{kind,id:String(id)},now});return true;}catch{return false;}
 };
}
