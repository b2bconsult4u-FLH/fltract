export const PERMISSIONS = Object.freeze([
 'clients.view','clients.create','clients.edit','clients.archive','clients.export',
 'reports.view','reports.generate','reports.export',
 'tasks.view','tasks.create','tasks.edit',
 'finance.view','finance.prepare','finance.approve','finance.export',
 'business.view','users.manage','roles.manage','settings.manage','audit.view'
]);
const grants=(permissions,scope='business')=>permissions.map(permission=>({permission,scope}));
export const STARTER_ROLES = Object.freeze([
 {id:'administrator',name:'System administrator',grants:grants(['business.view','users.manage','roles.manage','settings.manage','audit.view'])},
 {id:'ceo',name:'CEO',grants:grants(['business.view','clients.view','clients.create','clients.edit','clients.archive','reports.view','reports.generate','tasks.view','tasks.create','tasks.edit','finance.view','finance.approve','audit.view'])},
 {id:'cfo',name:'CFO',grants:grants(['business.view','finance.view','finance.prepare','finance.approve'])},
 {id:'cfo_assistant',name:'CFO administrative assistant',grants:grants(['finance.view','finance.prepare'],'assigned')},
 {id:'manager',name:'Mid-level manager',grants:grants(['clients.view','clients.create','clients.edit','reports.view','reports.generate','tasks.view','tasks.create','tasks.edit'],'team')},
 {id:'employee',name:'Employee',grants:grants(['clients.view','clients.edit','reports.view','tasks.view','tasks.edit'],'assigned')}
]);
export function validateGrants(input) {
 if(!Array.isArray(input)||input.length>PERMISSIONS.length)throw Error('invalid_grants');
 const seen=new Set();
 return input.map(g=>{
  if(!PERMISSIONS.includes(g.permission)||!['business','team','assigned'].includes(g.scope)||seen.has(g.permission))throw Error('invalid_grants');
  if(['business.view','users.manage','roles.manage','settings.manage','audit.view'].includes(g.permission)&&g.scope!=='business')throw Error('invalid_scope');
  seen.add(g.permission);return {permission:g.permission,scope:g.scope};
 });
}
