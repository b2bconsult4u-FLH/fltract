// Secure, transaction-specific FLTract questionnaire. No separate vendor or CRM login.
const FIELDS = {
 buyer: [["use","Intended property use",["Personal","Investment","Business","Agricultural","Other","Not sure"]],["budget","Approximate budget",["Under $250,000","$250,000–$500,000","$500,000–$1 million","$1–5 million","$5 million+","Not sure"]],["funding","Purchase method",["Cash","Financing","Undecided"]],["area","Preferred Florida area",null],["size","Preferred acreage or building size",null],["requirements","Must-have features or special requirements",null]],
 seller: [["authority","Your relationship to the property",["Owner","Authorized representative","Other","Not sure"]],["location","Property address or parcel ID, if known",null],["occupancy","Current occupancy",["Vacant","Owner-occupied","Tenant-occupied","Mixed","Not sure"]],["price","Estimated asking price or range",null],["improvements","Buildings, improvements or access considerations",null]],
 broker: [["brokerage","Brokerage legal name",null],["license_state","License state",null],["license_number","Your real estate license number",null],["responsible_broker","Responsible broker name and contact",null],["client_authorized","Client has authorized this proposed referral",["Yes","No","Not sure"]],["transaction","Client needs and anticipated transaction",null]]
};
const COMMON = [["representation","Are you currently working with or represented by a licensed real estate agent or broker for this transaction?",["Yes","No","Not sure"]],["timeline","Preferred transaction timeline",["Immediately","Within 3 months","3–6 months","6–12 months","Later","Not sure"]],["additional","Anything else the receiving broker should know?",null]];
const ESC=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const SECURITY={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json",...SECURITY}});
const digest=async t=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t)))].map(x=>x.toString(16).padStart(2,"0")).join("");
async function schema(db){await db.prepare("CREATE TABLE IF NOT EXISTS intake_questionnaires (inquiry_id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Invited', answers_json TEXT NOT NULL DEFAULT '{}', consent_version TEXT, completed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();}
export function categoryForInquiry(value){const s=String(value||"").toLowerCase();return /broker|agent|referr/.test(s)?"broker":/sell/.test(s)?"seller":"buyer";}
export async function createInvitation(db,inquiryId,type,origin){
 await schema(db);
 const bytes=crypto.getRandomValues(new Uint8Array(32)),token=Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
 const hash=await digest(token),expires=new Date(Date.now()+7*86400000).toISOString(),category=categoryForInquiry(type);
 await db.prepare("INSERT INTO intake_questionnaires(inquiry_id,token_hash,expires_at,category) VALUES(?,?,?,?) ON CONFLICT(inquiry_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,category=excluded.category,status='Invited',updated_at=CURRENT_TIMESTAMP").bind(inquiryId,hash,expires,category).run();
 return new URL("/questionnaire?token="+token,origin).toString();
}
function page(record,token){
 const fields=[...FIELDS[record.category],...COMMON];
 const answers=JSON.parse(record.answers_json||"{}");
 const input=([name,label,choices])=>'<label>'+ESC(label)+(choices?'<select name="'+name+'"><option value="">Select one</option>'+choices.map(c=>'<option value="'+ESC(c)+'" '+(answers[name]===c?"selected":"")+'>'+ESC(c)+'</option>').join("")+'</select>':'<textarea name="'+name+'" maxlength="1000">'+ESC(answers[name]||"")+'</textarea>')+'</label>';
 const finished=record.status==="Completed";
 const body=finished?'<p>Thank you. Your answers have been received by FLTract.</p>':'<p>Help us understand your request. Most answers are optional; buyers should provide intended use, budget and preferred area (you may write Not sure). Do not include passwords, financial account details or Social Security numbers.</p><form method="post" action="/questionnaire"><input type="hidden" name="token" value="'+ESC(token)+'">'+fields.map(input).join("")+'<label><input type="checkbox" name="sharing" value="yes" '+(answers.sharing==="yes"?"checked":"")+' required> I authorize FLTract to share information about this inquiry with an appropriately licensed brokerage to evaluate and handle my requested referral, subject to its privacy notice and applicable law.</label><button name="intent" value="save" type="submit" formnovalidate>Save for later</button><button name="intent" value="complete" type="submit">Send questionnaire</button></form>';
 return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FLTract | Client Qualification</title><style>body{font:16px system-ui,Arial;max-width:650px;margin:35px auto;padding:0 18px;color:#1d3240}label{display:block;margin:20px 0;font-weight:600}select,textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:12px;font:inherit}textarea{min-height:72px}button{background:#133e54;color:white;border:0;padding:13px 20px;margin:8px 12px 8px 0;border-radius:5px;cursor:pointer}h1{color:#134c59}</style></head><body><h1>FLTract Client Qualification</h1>'+body+'<p><small>Your Business Is Our Secret — Confidentiality Is of the Utmost Importance to Us. Your information may be shared as you authorize or as required by law.</small></p></body></html>',{headers:{"Content-Type":"text/html; charset=utf-8",...SECURITY}});
}
export async function handleQuestionnaire(request,env){
 if(!env.DB)return json({ok:false,error:"Service unavailable"},503);
 if(request.method!=="GET"&&request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
 if(request.method==="POST"){const origin=request.headers.get("Origin");if(origin&&origin!==new URL(request.url).origin)return json({ok:false,error:"Origin not allowed"},403);if(Number(request.headers.get("Content-Length")||0)>15000)return json({ok:false,error:"Request too large"},413);}
 const data=request.method==="POST"?await request.formData():new URL(request.url).searchParams, token=String(data.get("token")||"");
 if(!/^[a-f0-9]{64}$/.test(token))return json({ok:false,error:"Invalid or expired link"},403);
 await schema(env.DB);
 const hash=await digest(token);
 const record=await env.DB.prepare("SELECT * FROM intake_questionnaires WHERE token_hash=?").bind(hash).first();
 if(!record||Date.parse(record.expires_at)<=Date.now())return json({ok:false,error:"Invalid or expired link"},403);
 if(request.method==="GET")return page(record,token);
 if(record.status==="Completed")return page(record,token);
 const fields=[...FIELDS[record.category],...COMMON],answers={...JSON.parse(record.answers_json||"{}")};
 for(const [key,,choices] of fields){const value=String(data.get(key)||"").trim();if(value.length>1000||(choices&&value&&!choices.includes(value)))return json({ok:false,error:"Invalid answer"},400);answers[key]=value;}
 const intent=data.get("intent")==="complete"?"complete":"save";
 if(intent==="complete" && record.category==="buyer" && (!answers.area || !answers.budget || !answers.use))return json({ok:false,error:"Please provide your preferred area, intended use and approximate budget (Not sure is acceptable)."},400);
 if(intent==="complete"&&data.get("sharing")!=="yes")return json({ok:false,error:"Authorization is required to complete the questionnaire"},400);
 if(data.get("sharing")==="yes")answers.sharing="yes";
 const result=await env.DB.prepare("UPDATE intake_questionnaires SET answers_json=?,status=?,consent_version=?,completed_at=CASE WHEN ?='Completed' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE inquiry_id=? AND token_hash=? AND status<>'Completed'").bind(JSON.stringify(answers),intent==="complete"?"Completed":"Partially Completed","FLTRACT-QUESTIONNAIRE-2026-10-19-V1",intent==="complete"?"Completed":"Partially Completed",record.inquiry_id,hash).run();
 // Only the request that actually transitions the inquiry to Completed may notify the office.
 // This also prevents a stale concurrent submission from overwriting completed answers.
 if(Number(result?.meta?.changes||0)===0){
   const latest=await env.DB.prepare("SELECT * FROM intake_questionnaires WHERE token_hash=?").bind(hash).first();
   return page(latest||record,token);
 }
 if(intent==="complete" && env.SEND_EMAIL){
   try {
     await env.SEND_EMAIL.send({
       to:"fltractoffice@gmail.com",from:"noreply@fltract.com",subject:"FLTract Client Questionnaire Completed",
       text:"A qualification questionnaire has been completed. Sign in to FLTract to review inquiry #"+record.inquiry_id+".",
       html:"<p>A qualification questionnaire has been completed. Sign in to FLTract to review inquiry #"+record.inquiry_id+".</p>"
     });
   } catch(error){console.error("Questionnaire completion notification failed",String(error?.message||error));}
 }
 return page({...record,answers_json:JSON.stringify(answers),status:intent==="complete"?"Completed":"Partially Completed"},token);
}
