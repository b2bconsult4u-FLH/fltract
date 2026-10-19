import assert from 'node:assert/strict';
assert.equal(process.env.GITHUB_EVENT_NAME,'push');
assert.ok(process.env.GITHUB_RUN_ID);
assert.ok(process.argv.includes('--send-owner-test'),'Explicit live-email flag required');
// This frozen version has preview D1 and restricts mail to the owner and office.
const base='https://e54a0265-fltract-intake-5a25.b2bconsult4u.workers.dev';
const marker='SYNTHETIC-EMAIL-PR24-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
const payload={inquiry_type:'General Property Question',county:'Indian River',property_type:'Other / Not Sure',property_location:marker,first_name:'Synthetic',last_name:'Email Acceptance Test',email:'b2bconsult4u@gmail.com',preferred_contact:'Email',rights_acknowledged:true,relationship_acknowledged:true,marketing_email_opt_in:false,live_call_opt_in:false,timeframe:'Just Exploring',owner_status:'No',referral_source:'Other',source_page:'https://fltract.com/contact/',details:'CONTROLLED SYSTEM TEST ONLY. No actual client or property. Preview D1; verifies receipt and internal office notification.'};
const response=await fetch(base+'/submit',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{Origin:'https://fltract.com','Content-Type':'application/json'},body:JSON.stringify(payload)});
const result=await response.json();
console.log(JSON.stringify({marker,status:response.status,...result}));
assert.equal(response.status,201);
assert.equal(result.account_processing_status,'complete');
assert.equal(result.acknowledgment_email,'sent');
assert.equal(result.internal_notification_email,'sent');
console.log('Both live-email send paths accepted; verify recipient/server receipt separately.');
