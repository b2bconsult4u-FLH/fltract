// Live, bounded official-source research. Never approves a report or sends mail.
export const MINI_COMP_ADAPTERS = Object.freeze({
  'Indian River': {
    key:'indian_river', name:'Indian River County GIS / IRCPA public parcel layer',
    endpoint:'https://gisportal.ircgov.com/server3/rest/services/IRCPA/Parcels_MS/MapServer/0/query',
    parcel:'PP_PIN',address:'SITE_ADDR',use:'PROPUSE_CD',price:'SALE_PRICE',
    fields:'OBJECTID,PP_PIN,SITE_ADDR,AD_CITY,AD_ZIP,AD_UNIT,PROPUSE_CD,DOR_DESC,LAND_ACRES,SALE_VI_CD,SALE_YEAR,SALE_MONTH,SALE_PRICE,BLDG_VALUE,UPD_DATE,SUBDIV_NME',
    order:'SALE_YEAR DESC,SALE_MONTH DESC,OBJECTID DESC',
  },
  'St. Lucie': {
    key:'st_lucie', name:'St. Lucie County Property Appraiser public parcel layer',
    endpoint:'https://map.paslc.gov/arcgis/rest/services/GISPublic/TaxMap/MapServer/9/query',
    parcel:'ParcelID',address:'SiteAddress',use:'LandUseCode',price:'SalePrice',
    fields:'OBJECTID,ParcelID,SiteAddress,SiteCity,SiteZIP,LandUseCode,LandUseCodeDescription,ImprovedStatus,TotalArea,SalePrice,SaleDate,NALCode,Isconfidential,SubdivisionDescription,Zoning',
    order:'SaleDate DESC,OBJECTID DESC',
  },
});

class ResearchStop extends Error {
  constructor(message,status='Needs Verification'){super(message);this.status=status;}
}
const sqlText=x=>String(x||'').replaceAll("'","''");
const number=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
export const parcelKey=x=>String(x||'').toUpperCase().replace(/[\s.-]/g,'');
const cityPattern=/\s+(VERO BEACH|VERO BCH|INDIAN RIVER SHORES|SEBASTIAN|FELLSMERE|ORCHID|PORT ST\.? LUCIE|PORT SAINT LUCIE|FORT PIERCE|ST\.? LUCIE VILLAGE|SAINT LUCIE VILLAGE|LAKEWOOD PARK)\s*$/i;
function streetPart(x){
  return String(x||'').split(',')[0].trim().replace(/\s+FL\.?\s+\d{5}(?:-\d{4})?\s*$/i,'').replace(cityPattern,'').trim();
}
function inputCity(x){
  const first=String(x||'').split(',')[0].trim().replace(/\s+FL\.?\s+\d{5}(?:-\d{4})?\s*$/i,'');
  return first.match(cityPattern)?.[1]?.toUpperCase().replaceAll('.','')||'';
}
export function addressKey(x){
  const suffix={COURT:'CT',AVENUE:'AVE',STREET:'ST',ROAD:'RD',DRIVE:'DR',LANE:'LN',PLACE:'PL',BOULEVARD:'BLVD',CIRCLE:'CIR',HIGHWAY:'HWY',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W'};
  return streetPart(x).toUpperCase().replace(/[^A-Z0-9#\s]/g,' ').trim().split(/\s+/).map(x=>suffix[x]||x).join(' ');
}
function addressVariants(x){
  const key=addressKey(x), words=key.split(' '), last=words.at(-1);
  const full={CT:'COURT',AVE:'AVENUE',ST:'STREET',RD:'ROAD',DR:'DRIVE',LN:'LANE',PL:'PLACE',BLVD:'BOULEVARD',CIR:'CIRCLE',HWY:'HIGHWAY'};
  return [...new Set([streetPart(x).toUpperCase(),key,full[last]?[...words.slice(0,-1),full[last]].join(' '):key])];
}
export function geometryPoint(geometry){
  if(number(geometry?.x)!==null&&number(geometry?.y)!==null)return {x:Number(geometry.x),y:Number(geometry.y)};
  const points=Array.isArray(geometry?.rings)?geometry.rings.flat().filter(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])):[];
  if(!points.length)return null;
  // Bounding-box center is a search reference, not a survey or property boundary.
  const bounds=points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.max(b[1],p[0]),Math.min(b[2],p[1]),Math.max(b[3],p[1])],[Infinity,-Infinity,Infinity,-Infinity]);
  const point={x:(bounds[0]+bounds[1])/2,y:(bounds[2]+bounds[3])/2};
  return Math.abs(point.x)<=180&&Math.abs(point.y)<=90?point:null;
}
function distanceMiles(a,b){
  if(!a||!b)return null;
  const rad=x=>x*Math.PI/180;
  const lat=rad(b.y-a.y),lon=rad(b.x-a.x);
  const h=Math.sin(lat/2)**2+Math.cos(rad(a.y))*Math.cos(rad(b.y))*Math.sin(lon/2)**2;
  return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,h)));
}

export async function queryCounty(adapter,params,fetcher=fetch){
  // Adapter endpoints are constants; neither requests nor DB values control hosts.
  const url=new URL(adapter.endpoint);
  for(const [key,value]of Object.entries({...params,f:'json'}))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Official county source returned HTTP ${response.status}.`);
  const reader=response.body?.getReader();if(!reader)throw Error('Official county source returned no body.');
  let length=0;const chunks=[];
  try{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4*1024*1024)throw Error('Official county response exceeds the research size limit.');chunks.push(value);}
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if(data.error)throw Error('Official county query failed: '+String(data.error.message||'unknown error').slice(0,200));
  if(!Array.isArray(data.features))throw Error('Official county response is missing feature records.');
  return data;
}

function normalizedFeature(feature,county){
  const a=feature.attributes||{},irc=county==='Indian River';
  let date='';
  if(irc){
    const year=number(a.SALE_YEAR),month=number(a.SALE_MONTH);
    if(Number.isInteger(year)&&year>=1900&&Number.isInteger(month)&&month>=1&&month<=12)date=`${year}-${String(month).padStart(2,'0')}`;
  }else if(number(a.SaleDate)!==null){
    const d=new Date(Number(a.SaleDate));if(Number.isFinite(d.getTime()))date=d.toISOString().slice(0,10);
  }
  const update=number(a.UPD_DATE);
  return {parcel:String(irc?a.PP_PIN||'':a.ParcelID||''),address:String(irc?a.SITE_ADDR||'':a.SiteAddress||''),
    city:String(irc?a.AD_CITY||'':a.SiteCity||''),zip:String(irc?a.AD_ZIP||'':a.SiteZIP||''),
    use:String(irc?a.PROPUSE_CD||'':a.LandUseCode||''),description:String(irc?a.DOR_DESC||'':a.LandUseCodeDescription||''),
    acreage:irc?number(a.LAND_ACRES):null,price:number(irc?a.SALE_PRICE:a.SalePrice),date,
    qualification:String(irc?a.SALE_VI_CD??'':a.NALCode??''),
    subdivision:String(irc?a.SUBDIV_NME||'':a.SubdivisionDescription||''),
    updated:update===null?null:new Date(update).toISOString(),
    restricted:!irc&&Number(a.Isconfidential)===1,
    point:geometryPoint(feature.geometry),rawArea:irc?null:number(a.TotalArea),
  };
}

export async function researchProperty(property,{fetcher=fetch,now=new Date()}={}){
  const adapter=MINI_COMP_ADAPTERS[property.county];
  if(!adapter)throw new ResearchStop(`Automatic research is not configured for ${property.county||'this county'}. Management must connect an official county source.`,'Source Not Configured');
  const hasParcel=!!String(property.parcel_id||'').trim();
  const address=addressKey(property.property_location);
  if(!hasParcel&&!/^\d+\s+\S+/.test(address))throw new ResearchStop('A complete street address or official parcel ID is required. A general location is not a parcel match.');
  const where=hasParcel?`${adapter.parcel}='${sqlText(property.parcel_id)}'`:
    `UPPER(${adapter.address}) IN (${addressVariants(property.property_location).map(x=>"'"+sqlText(x)+"'").join(',')})`;
  const data=await queryCounty(adapter,{where,outFields:adapter.fields,returnGeometry:'true',outSR:'4326',resultRecordCount:'5'},fetcher);
  if(data.exceededTransferLimit)throw new ResearchStop('The county returned more parcel matches than the verification limit; research stopped without guessing.');
  const zip=String(property.property_location||'').match(/\b\d{5}(?:-\d{4})?\s*$/)?.[0]?.slice(0,5);
  const city=inputCity(property.property_location);
  const matches=data.features.map(x=>normalizedFeature(x,property.county)).filter(x=>hasParcel?parcelKey(x.parcel)===parcelKey(property.parcel_id):addressKey(x.address)===address&&(!zip||x.zip.slice(0,5)===zip)&&(!city||x.city.toUpperCase()===city));
  if(matches.length!==1)throw new ResearchStop(matches.length?'Multiple exact parcels matched. Select the official parcel before research can continue.':'No exact parcel matched the supplied address/ID. Verify the property identifiers.');
  const subject=matches[0];
  if(subject.restricted)throw new ResearchStop('The county record is marked confidential. No county attributes or sales were imported.','Restricted Record');
  if(hasParcel&&/^\d+\s+\S+/.test(address)&&addressKey(subject.address)!==address)throw new ResearchStop('The official parcel address conflicts with the entered street address. Verify before importing.');
  if(!subject.parcel||!subject.use||!subject.point)throw new ResearchStop('The official parcel lacks a use code or usable location needed for comparable selection.');
  if(property.county==='Indian River'&&!subject.updated)throw new ResearchStop('The county row does not publish an update date; review source freshness before importing.','Source Needs Review');
  if(subject.updated){const age=(now.getTime()-Date.parse(subject.updated))/86400000;if(age< -1||age>30)throw new ResearchStop('The published parcel update is older than 30 days or in the future. Review the county source before importing.','Source Needs Review');}
  const radius=subject.acreage!==null&&subject.acreage>=5?20:5;
  const earliest=new Date(now);earliest.setUTCFullYear(earliest.getUTCFullYear()-2);
  let saleWhere=`${adapter.price}>0 AND ${adapter.parcel}<>'${sqlText(subject.parcel)}' AND ${adapter.use}='${sqlText(subject.use)}'`;
  if(property.county==='Indian River'){
    saleWhere+=` AND SALE_YEAR>=${earliest.getUTCFullYear()} AND SALE_YEAR<=${now.getUTCFullYear()}`;
    if(subject.acreage>0)saleWhere+=` AND LAND_ACRES>=${subject.acreage*0.5} AND LAND_ACRES<=${subject.acreage*2}`;
  }else saleWhere+=` AND Isconfidential=0 AND SaleDate>=TIMESTAMP '${earliest.toISOString().slice(0,10)} 00:00:00'`;
  const sales=await queryCounty(adapter,{where:saleWhere,geometry:JSON.stringify({...subject.point,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:radius,units:'esriSRUnit_StatuteMile',outFields:adapter.fields,returnGeometry:'true',outSR:'4326',resultRecordCount:'100',orderByFields:adapter.order},fetcher);
  const seen=new Set(),currentMonth=now.toISOString().slice(0,7),cutoff=earliest.toISOString().slice(0,7);
  const candidates=sales.features.map(x=>normalizedFeature(x,property.county)).filter(x=>{
    if(x.restricted||!x.parcel||parcelKey(x.parcel)===parcelKey(subject.parcel)||x.use!==subject.use||!(x.price>0)||!x.date||x.date.slice(0,7)<cutoff||x.date.slice(0,7)>currentMonth)return false;
    if(x.updated){const age=(now.getTime()-Date.parse(x.updated))/86400000;if(age< -1||age>30)return false;}
    if(subject.acreage>0&&(!(x.acreage>=subject.acreage*.5)||!(x.acreage<=subject.acreage*2)))return false;
    const distance=distanceMiles(subject.point,x.point);if(distance===null||distance>radius)return false;x.distance=distance;
    const key=parcelKey(x.parcel);if(seen.has(key))return false;seen.add(key);return true;
  });
  candidates.sort((a,b)=>Number(b.subdivision===subject.subdivision&&!!subject.subdivision)-Number(a.subdivision===subject.subdivision&&!!subject.subdivision)||a.distance-b.distance||b.date.localeCompare(a.date));
  return {adapter,subject,candidates:candidates.slice(0,10),retrievedAt:now.toISOString(),radius,truncated:!!sales.exceededTransferLimit};
}

export async function ensureResearchQueueSchema(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS mini_comp_research_fences(job_id INTEGER PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1))').run();
  const columns=await env.DB.prepare('PRAGMA table_info(mini_comp_queue)').all();
  const names=new Set(columns.results.map(x=>x.name));
  for(const name of ['lease_token','lease_expires_at'])if(!names.has(name)){
    try{await env.DB.prepare(`ALTER TABLE mini_comp_queue ADD COLUMN ${name} TEXT`).run();}
    catch(error){const check=await env.DB.prepare('PRAGMA table_info(mini_comp_queue)').all();if(!check.results.some(x=>x.name===name))throw error;}
  }
}

async function persistResearch(env,job,result){
  const {subject,adapter,candidates,retrievedAt,radius,truncated}=result;
  const property=await env.DB.prepare('SELECT * FROM properties WHERE id=?').bind(job.property_id).first();
  const report=await env.DB.prepare('SELECT * FROM mini_comp_reports WHERE id=?').bind(job.report_id).first();
  if(!property||!report||Number(report.property_id)!==Number(job.property_id))throw Error('Research property/report link is missing or inconsistent.');
  if(report.status==='Approved'){
    await env.DB.prepare("UPDATE mini_comp_queue SET status='Completed',lease_token=NULL,lease_expires_at=NULL,last_error='Approved report preserved.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?").bind(job.id,job.lease_token).run();return {preserved:true};
  }
  const limits=[`Official GIS research retrieved ${retrievedAt}. Parcel matching does not verify client ownership or provide a full recorded legal description.`,
    'Candidates share the published property-use code and are ranked by matching subdivision and approximate distance. HOA, access, condition, improvements and deed qualification require review.',
    property.county==='Indian River'?'Sale dates are published to month precision; no sale day was invented. County sale qualification codes are retained in notes and are not automatically interpreted as approval.':'The source does not document TotalArea units; acreage is left unknown. The parcel-layer publication update date is unavailable.',
    truncated?'The query was bounded to the 100 most recent source candidates; this is not an exhaustive sale history.':'The query used a bounded recent-sale sample.',
    'No automatic approval or client email was performed.'].join(' ');
  const summary=`Automated research: verified parcel ${subject.parcel}. Found ${candidates.length} documented nearby sale candidate(s), same use code ${subject.use} (${subject.description}), within ${radius} miles. ${subject.acreage===null?'Official acreage is unknown.':`Published subject acreage: ${subject.acreage}.`} Human comparability and qualification review is required.`;
  const status=candidates.length?'Ready for Review':'Insufficient Data';
  const statements=[env.DB.prepare(`INSERT OR REPLACE INTO mini_comp_research_fences(job_id,valid) VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM mini_comp_queue q JOIN mini_comp_reports r ON r.id=q.report_id WHERE q.id=? AND q.lease_token=? AND q.status='Processing' AND r.status<>'Approved') THEN 1 ELSE 0 END)`).bind(job.id,job.id,job.lease_token),env.DB.prepare(`UPDATE properties SET parcel_id=?,land_use=?,data_source=?,data_verified_at=?,research_status='Researching',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(subject.parcel,subject.description||subject.use,adapter.name+' — '+adapter.endpoint.replace(/\/query$/,''),retrievedAt,job.property_id)];
  for(const c of candidates){
    const reference=new URL(adapter.endpoint);reference.search=new URLSearchParams({f:'json',where:`${adapter.parcel}='${sqlText(c.parcel)}'`,outFields:adapter.fields,returnGeometry:'false'}).toString();
    statements.push(env.DB.prepare(`INSERT INTO mini_comp_comparables(report_id,property_location,county,parcel_id,sale_date,sale_price,acreage,qualified_sale,improvements,distance_miles,source_name,source_reference,source_retrieved_at,selection_reason,notes)
      SELECT ?,?,?,?,?,?,?,'Unknown',?,?,?,?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM mini_comp_comparables WHERE report_id=? AND parcel_id=? AND sale_date=? AND sale_price=?)`)
      .bind(job.report_id,[c.address,c.city,c.zip].filter(Boolean).join(', '),property.county,c.parcel,c.date,c.price,c.acreage,c.description,c.distance,adapter.name,reference.toString(),retrievedAt,
        `Same county use code ${c.use}; ${c.distance.toFixed(2)} miles from subject; ${c.subdivision&&c.subdivision===subject.subdivision?'same published subdivision':'subdivision/market-pocket review required'}.`,
        `Human review required. County sale qualification code: ${c.qualification||'not published'}. ${property.county==='Indian River'?'Sale month precision: YYYY-MM.':'TotalArea: '+(c.rawArea??'unknown')+'; units not assumed.'} Source row update: ${c.updated||'not published'}.`,job.report_id,c.parcel,c.date,c.price));
  }
  statements.push(env.DB.prepare(`UPDATE mini_comp_reports SET status=?,
    executive_summary=CASE WHEN TRIM(executive_summary)='' OR executive_summary LIKE 'Automated research:%' THEN ? ELSE executive_summary END,
    selection_notes=CASE WHEN TRIM(selection_notes)='' THEN ? ELSE selection_notes END,
    limitations=CASE WHEN TRIM(limitations)='' THEN ? ELSE limitations END,
    insufficient_data_reason=?,prepared_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'Approved'`)
    .bind(status,summary,'Review the documented candidates and select the strongest 3–5; nearby sales are not automatically comparable.',limits,candidates.length?'':'No eligible recent candidates matched the bounded county/use/acreage/distance search.',retrievedAt,job.report_id));
  if(job.run_id)statements.push(env.DB.prepare("UPDATE official_research_runs SET status='Completed',subject_matches=1,comparable_candidates=?,result_note=?,completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(candidates.length,summary,job.run_id));
  statements.push(env.DB.prepare(`UPDATE mini_comp_queue SET status='Completed',last_error='',lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`).bind(job.id,job.lease_token));
  statements.push(env.DB.prepare(`UPDATE report_library_items SET current_status=?,updated_at=CURRENT_TIMESTAMP WHERE source_table='mini_comp_reports' AND source_id=?`).bind(status,job.report_id));
  statements.push(env.DB.prepare(`INSERT INTO flt_work_routing_events(work_item_id,event_type,from_staff_email,reason,performed_by)
    SELECT id,'Automated Research Completed',assigned_staff_email,?,'FLTract Research Runner' FROM flt_work_items WHERE subject_type='mini_comp_queue' AND subject_id=? AND status NOT IN ('Completed','Closed','Cancelled')`).bind(summary,job.id));
  statements.push(env.DB.prepare(`UPDATE flt_work_items SET status='Completed',completed_at=CURRENT_TIMESTAMP,routing_reason=? WHERE subject_type='mini_comp_queue' AND subject_id=? AND status NOT IN ('Completed','Closed','Cancelled')`).bind(summary,job.id));
  if(property.primary_inquiry_id)statements.push(env.DB.prepare(`INSERT INTO activity_log(inquiry_id,activity_type,activity_note) VALUES(?,'Automatic Mini-Comp Research',?)`).bind(property.primary_inquiry_id,summary));
  const manager=await env.DB.prepare(`SELECT id,email FROM staff_users WHERE active=1 AND role IN ('Manager','CEO','Administrator') ORDER BY CASE role WHEN 'Manager' THEN 0 WHEN 'CEO' THEN 1 ELSE 2 END,id LIMIT 1`).first();
  const reviewTitle=`Review Mini-Comp — FLP-${String(job.property_id).padStart(6,'0')}`;
  statements.push(env.DB.prepare(`INSERT INTO flt_work_items(work_type,module_key,subject_type,subject_id,title,priority,status,required_role,required_competency,created_by,assigned_staff_user_id,assigned_staff_email,routing_reason)
    SELECT 'Review Mini-Comp','real-estate','mini_comp_reports',?,?,'Normal',?,'Manager','','FLTract Research Runner',?,?,?
    WHERE NOT EXISTS(SELECT 1 FROM flt_work_items WHERE work_type='Review Mini-Comp' AND subject_type='mini_comp_reports' AND subject_id=? AND status NOT IN ('Completed','Closed','Cancelled'))`)
    .bind(job.report_id,reviewTitle,manager?'Assigned':'Escalation Required',manager?.id||null,manager?.email||'',candidates.length?'Automated candidate research is complete; validate qualification/comparability before approval.':'Research found insufficient data; management review is required.',job.report_id));
  // A lost lease must not commit any report/candidate changes.
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO report_library_items(client_id,property_id,report_type,source_table,source_id,title,current_status,current_route) VALUES(?,?,'Mini-Comp','mini_comp_reports',?,?,?,?)`).bind(property.client_id,job.property_id,job.report_id,`Mini-Comp — FLP-${String(job.property_id).padStart(6,'0')}`,status,`/property/${job.property_id}/mini-comp/report`));
  const current=await env.DB.prepare('SELECT lease_token FROM mini_comp_queue WHERE id=? AND status=\'Processing\'').bind(job.id).first();
  if(current?.lease_token!==job.lease_token)throw Error('Research lease was lost.');
  await env.DB.batch(statements);
  return {status,candidates:candidates.length};
}

export async function processMiniCompQueue(env,{limit=2,fetcher=fetch,now=new Date()}={}){
  await ensureResearchQueueSchema(env);
  const jobs=await env.DB.prepare(`SELECT id,property_id,report_id,attempts FROM mini_comp_queue
    WHERE (status IN ('Queued','Retry') AND available_at<=CURRENT_TIMESTAMP)
      OR (status='Processing' AND COALESCE(lease_expires_at,datetime(updated_at,'+5 minutes'))<=CURRENT_TIMESTAMP)
    ORDER BY created_at,id LIMIT ?`).bind(Math.max(1,Math.min(5,limit))).all();
  const results=[];
  for(const row of jobs.results){
    const token=crypto.randomUUID();
    const claim=await env.DB.prepare(`UPDATE mini_comp_queue SET status='Processing',attempts=attempts+1,lease_token=?,lease_expires_at=datetime('now','+5 minutes'),updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND ((status IN ('Queued','Retry') AND available_at<=CURRENT_TIMESTAMP) OR (status='Processing' AND COALESCE(lease_expires_at,datetime(updated_at,'+5 minutes'))<=CURRENT_TIMESTAMP))`).bind(token,row.id).run();
    if(Number(claim.meta?.changes)!==1)continue;
    const job={...row,lease_token:token};
    let runId=null;
    try{
      const property=await env.DB.prepare('SELECT * FROM properties WHERE id=?').bind(job.property_id).first();
      const report=await env.DB.prepare('SELECT status,property_id FROM mini_comp_reports WHERE id=?').bind(job.report_id).first();
      if(!property||!report||Number(report.property_id)!==Number(job.property_id))throw new ResearchStop('The research property/report link is missing or inconsistent.');
      if(report.status==='Approved'){
        await env.DB.prepare(`UPDATE mini_comp_queue SET status='Completed',lease_token=NULL,lease_expires_at=NULL,last_error='Approved report preserved; automatic research skipped.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`).bind(job.id,token).run();
        results.push({id:job.id,status:'Approved Preserved'});continue;
      }
      const adapter=MINI_COMP_ADAPTERS[property.county];
      const run=await env.DB.prepare("INSERT INTO official_research_runs(property_id,county,adapter_key,status,source_name) VALUES(?,?,?,'Processing',?)").bind(property.id,property.county,adapter?.key||'not_configured',adapter?.name||'No automatic source configured').run();
      runId=Number(run.meta?.last_row_id)||null;
      job.run_id=runId;
      const data=await researchProperty(property,{fetcher,now});
      const outcome=await persistResearch(env,job,data);

      results.push({id:job.id,...outcome});
    }catch(error){
      const reason=String(error.message||error).slice(0,1000);
      const status=error instanceof ResearchStop?error.status:Number(row.attempts)+1>=5?'Failed':'Retry';
      const terminal=status!=='Retry';
      if(runId)await env.DB.prepare("UPDATE official_research_runs SET status=?,result_note=?,completed_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,reason,runId).run();
      const owned=await env.DB.prepare("SELECT lease_token FROM mini_comp_queue WHERE id=? AND status='Processing'").bind(job.id).first();
      if(owned?.lease_token!==token){results.push({id:job.id,status:'Lease Lost'});continue;}
      await env.DB.batch([
        env.DB.prepare(`INSERT OR REPLACE INTO mini_comp_research_fences(job_id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM mini_comp_queue WHERE id=? AND lease_token=? AND status='Processing') THEN 1 ELSE 0 END)`).bind(job.id,job.id,token),
        env.DB.prepare(`UPDATE mini_comp_queue SET status=?,last_error=?,available_at=datetime('now','+15 minutes'),lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?`).bind(status,reason,job.id,token),
        env.DB.prepare(`UPDATE mini_comp_reports SET insufficient_data_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'Approved'`).bind(reason,job.report_id),
      ]);
      if(terminal){
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO flt_work_routing_events(work_item_id,event_type,from_staff_email,reason,performed_by)
            SELECT id,'Automatic Research Blocked',assigned_staff_email,?,'FLTract Research Runner' FROM flt_work_items WHERE subject_type='mini_comp_queue' AND subject_id=? AND status NOT IN ('Completed','Closed','Cancelled')`).bind(reason,job.id),
          env.DB.prepare(`UPDATE flt_work_items SET status='Escalation Required',routing_reason=? WHERE subject_type='mini_comp_queue' AND subject_id=? AND status NOT IN ('Completed','Closed','Cancelled')`).bind(reason,job.id),
        ]);
      }
      console.error(JSON.stringify({event:'mini_comp_research',job:job.id,status,reason}));results.push({id:job.id,status,reason});
    }
  }
  return {attempted:results.length,results};
}
