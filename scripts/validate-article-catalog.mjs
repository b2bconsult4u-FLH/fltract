import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd();
const catalog=JSON.parse(readFileSync(resolve(root,'content/articles/catalog.json'),'utf8'));
const validStatuses=new Set(['draft','review','published-in-preview','published','archived']);
const validScopes=new Set(['statewide','regional','county']);
const seenIds=new Set(),seenUrls=new Set();
const errors=[];
if(catalog.schema_version!==1||!Array.isArray(catalog.articles))errors.push('Invalid catalog version or articles list');
for(const [index,a] of (catalog.articles||[]).entries()){
 const label='article '+index;
 for(const key of ['id','title','slug','url','status','content_type','scope','source_path'])if(typeof a[key]!=='string'||!a[key].trim())errors.push(label+': missing '+key);
 if(!validStatuses.has(a.status))errors.push(label+': invalid status');
 if(!validScopes.has(a.scope))errors.push(label+': invalid scope');
 if(!Array.isArray(a.counties)||!Array.isArray(a.regions)||!Array.isArray(a.topics))errors.push(label+': classifications must be arrays');
 if(seenIds.has(a.id))errors.push(label+': duplicate id');seenIds.add(a.id);
 if(seenUrls.has(a.url))errors.push(label+': duplicate URL');seenUrls.add(a.url);
 if(typeof a.url!=='string'||!/^\/[a-z0-9/-]+\/$/.test(a.url))errors.push(label+': invalid canonical URL');
 if(typeof a.source_path!=='string'||a.source_path.includes('..')||!existsSync(resolve(root,a.source_path)))errors.push(label+': source page missing');
 for(const field of ['published_at','updated_at'])if(a[field]!==null&&(typeof a[field]!=='string'||Number.isNaN(Date.parse(a[field]))))errors.push(label+': invalid '+field);
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Article catalog valid: '+catalog.articles.length+' records');
