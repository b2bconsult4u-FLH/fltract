const STATUSES = [
  "New",
  "Reviewing",
  "Researching",
  "Referral Candidate",
  "Referral Prepared",
  "Referred",
  "Closed"
];

const FLORIDA_TIME_ZONE = "America/New_York";


/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}


function redirect(location) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location
    }
  });
}


function idFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const id = Number(parts[1]);

  return Number.isInteger(id) && id > 0
    ? id
    : null;
}


function sameOriginPost(request) {
  if (request.method !== "POST") {
    return false;
  }

  const target = new URL(request.url);

  const origin = request.headers.get("Origin");

  if (origin) {
    try {
      if (new URL(origin).origin === target.origin) {
        return true;
      }
    } catch {}
  }

  const referer = request.headers.get("Referer");

  if (referer) {
    try {
      if (new URL(referer).origin === target.origin) {
        return true;
      }
    } catch {}
  }

  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}


/* ============================================================
   FLORIDA DATE / TIME
   ============================================================ */

function floridaTime(value) {
  if (!value) return "";

  let raw = String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
  ) {
    raw = raw.replace(" ", "T") + "Z";
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: FLORIDA_TIME_ZONE,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    }
  ).format(date);
}


function calendarDate(value) {
  if (!value) return "";

  const raw = String(value).trim();

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) {
    return raw;
  }

  const [, year, month, day] = match;

  const names = [
    "Jan", "Feb", "Mar", "Apr",
    "May", "Jun", "Jul", "Aug",
    "Sep", "Oct", "Nov", "Dec"
  ];

  return `${names[Number(month) - 1]} ${Number(day)}, ${year}`;
}


function floridaToday() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: FLORIDA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    )
    .formatToParts(new Date());

  const values = {};

  for (const p of parts) {
    values[p.type] = p.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}


function addDays(dateString, days) {
  const [y, m, d] =
    dateString.split("-").map(Number);

  const date =
    new Date(
      Date.UTC(y, m - 1, d)
    );

  date.setUTCDate(
    date.getUTCDate() + days
  );

  return date
    .toISOString()
    .slice(0, 10);
}


function daysBetween(a, b) {
  const dateA =
    new Date(`${a}T12:00:00Z`);

  const dateB =
    new Date(`${b}T12:00:00Z`);

  return Math.round(
    (dateB - dateA) /
    86400000
  );
}


/* ============================================================
   CONTACT STATUS
   ============================================================ */

function phoneContactStatus(inquiry, warningDays = 30) {
  if (Number(inquiry.do_not_call) === 1) {
    return {
      text: "DO NOT CALL",
      css: "danger"
    };
  }

  if (!inquiry.phone_contact_expires_at) {
    return {
      text: "NO ACTIVE CLOCK",
      css: "muted"
    };
  }

  const today = floridaToday();

  const expires =
    String(
      inquiry.phone_contact_expires_at
    ).slice(0, 10);

  const remaining =
    daysBetween(today, expires);

  if (remaining < 0) {
    return {
      text: "STALE — DO NOT INITIATE CALL",
      css: "danger"
    };
  }

  if (remaining <= warningDays) {
    return {
      text: `EXPIRING — ${remaining} DAYS`,
      css: "warning"
    };
  }

  return {
    text: `ACTIVE — ${remaining} DAYS`,
    css: "good"
  };
}


function emailContactStatus(inquiry) {
  if (Number(inquiry.do_not_email) === 1) {
    return {
      text: "DO NOT EMAIL",
      css: "danger"
    };
  }

  if (!inquiry.consent_recorded_at && !inquiry.consent_version) {
    return {
      text: "LEGACY — PERMISSION NOT VERIFIED",
      css: "warning"
    };
  }

  if (Number(inquiry.marketing_email_opt_in) === 1) {
    return {
      text: "MARKETING EMAIL OK",
      css: "good"
    };
  }

  if (Number(inquiry.inquiry_email_allowed) === 1) {
    return {
      text: "INQUIRY EMAIL ONLY",
      css: "warning"
    };
  }

  return {
    text: "NO EMAIL PERMISSION",
    css: "muted"
  };
}


function textContactStatus(inquiry) {
  if (Number(inquiry.do_not_text) === 1) {
    return {
      text: "DO NOT TEXT",
      css: "danger"
    };
  }

  if (Number(inquiry.text_opt_in) === 1) {
    return {
      text: "TEXT CONSENT RECORDED",
      css: "good"
    };
  }

  return {
    text: "NO TEXT CONSENT",
    css: "muted"
  };
}


/* ============================================================
   PAGE TEMPLATE
   ============================================================ */

function page(body, title = "FLTract Admin") {
  return `<!doctype html>
<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>${esc(title)}</title>

<style>

:root{
  --ink:#17352b;
  --green:#245943;
  --sand:#f4efe4;
  --paper:#fffdf8;
  --gold:#b98b3e;
  --muted:#65736d;
  --danger:#8b1e1e;
  --warning:#8a5a00;
  --good:#1f6b3a;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  font-family:Arial,Helvetica,sans-serif;
  background:var(--sand);
  color:#1e2925;
}

header{
  background:var(--ink);
  color:#fff;
  padding:18px 0;
}

.wrap{
  width:min(1180px,94%);
  margin:auto;
}

header .wrap{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:20px;
}

.brand{
  font-size:1.5rem;
  font-weight:900;
}

.brand span{
  color:#e4c98d;
}

nav a{
  color:#fff;
  text-decoration:none;
  margin-left:16px;
  font-weight:700;
}

main{
  padding:36px 0 60px;
}

h1,
h2,
h3{
  color:var(--ink);
}

.panel{
  background:#fff;
  border:1px solid #d8d8d2;
  padding:24px;
  margin-bottom:22px;
  box-shadow:0 4px 14px #0000000a;
}

.filters,
.action-row{
  display:flex;
  gap:12px;
  flex-wrap:wrap;
  align-items:end;
}

.filters{
  margin-bottom:20px;
}

input,
select,
textarea,
button{
  font:inherit;
}

input,
select,
textarea{
  width:100%;
  padding:10px 12px;
  border:1px solid #adb7b1;
  border-radius:4px;
  background:#fff;
}

textarea{
  resize:vertical;
}

button{
  background:var(--ink);
  color:#fff;
  border:0;
  border-radius:4px;
  padding:11px 16px;
  font-weight:800;
  cursor:pointer;
}

button.secondary{
  background:#65736d;
}

.filters input{
  width:260px;
}

.filters select{
  width:210px;
}

table{
  width:100%;
  border-collapse:collapse;
}

th,
td{
  text-align:left;
  padding:12px;
  border-bottom:1px solid #e3e0d8;
  vertical-align:top;
}

th{
  background:#faf6ec;
  color:var(--ink);
}

a{
  color:var(--green);
}

.badge{
  display:inline-block;
  padding:5px 9px;
  border-radius:20px;
  background:#eef3ef;
  font-size:.82rem;
  font-weight:800;
}

.badge.good{
  background:#e6f4ea;
  color:var(--good);
}

.badge.warning{
  background:#fff2cf;
  color:var(--warning);
}

.badge.danger{
  background:#fde8e8;
  color:var(--danger);
}

.badge.muted{
  background:#ecefed;
  color:#57615d;
}

.grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:18px;
}

.form-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:16px;
}

.form-grid .full{
  grid-column:1/-1;
}

label{
  display:block;
  font-weight:700;
  color:var(--ink);
}

label span{
  display:block;
  margin-bottom:5px;
}

.label{
  color:var(--muted);
  font-size:.82rem;
  font-weight:800;
  text-transform:uppercase;
  letter-spacing:.04em;
}

.value{
  margin-top:3px;
}

.empty{
  padding:30px;
  text-align:center;
  color:var(--muted);
}

.back{
  display:inline-block;
  margin-bottom:18px;
  font-weight:700;
}

.note{
  white-space:pre-wrap;
}

.small{
  font-size:.88rem;
  color:var(--muted);
}

.section-note{
  font-size:.9rem;
  color:var(--muted);
  line-height:1.5;
}

.followup-overdue{
  border-left:5px solid var(--danger);
}

.followup-today{
  border-left:5px solid var(--gold);
}

.followup-future{
  border-left:5px solid var(--green);
}

.summary-grid{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:16px;
  margin-bottom:22px;
}

.summary-card{
  background:#fff;
  border:1px solid #d8d8d2;
  padding:18px;
}

.summary-number{
  font-size:2rem;
  font-weight:900;
  color:var(--ink);
}

@media(max-width:760px){

  .grid,
  .form-grid,
  .summary-grid{
    grid-template-columns:1fr;
  }

  .form-grid .full{
    grid-column:auto;
  }

  table{
    font-size:.88rem;
  }

  th,
  td{
    padding:8px;
  }

  .filters input,
  .filters select{
    width:100%;
  }

}

</style>

</head>

<body>

<header>

<div class="wrap">

<div class="brand">
FL<span>TRACT</span> Admin
</div>

<nav>
<a href="/">Inquiries</a>
<a href="/followups">Follow Ups</a>
<a href="/export.csv">Export CSV</a>
</nav>

</div>

</header>

<main>

<div class="wrap">

${body}

</div>

</main>

</body>

</html>`;
}


/* ============================================================
   WORKER
   ============================================================ */

export default {

async fetch(request, env) {

const url =
new URL(request.url);


if (!env.DB) {

return new Response(
"Database binding DB is missing.",
{
status:500
}
);

}


/* ============================================================
   LOAD COMPLIANCE RULES
   ============================================================ */

let warningDays = 30;
let inquiryCallDays = 90;

try {

const rules =
await env.DB.prepare(`
SELECT
rule_key,
rule_value
FROM compliance_rules
`).all();

for (const r of rules.results) {

if (
r.rule_key ===
"phone_expiration_warning_days"
) {
warningDays =
Number(r.rule_value) || 30;
}

if (
r.rule_key ===
"website_inquiry_live_call_days"
) {
inquiryCallDays =
Number(r.rule_value) || 90;
}

}

} catch {}


/* ============================================================
   CSV EXPORT
   ============================================================ */

if (
request.method === "GET" &&
url.pathname === "/export.csv"
) {

const { results } =
await env.DB.prepare(`
SELECT *
FROM inquiries
ORDER BY created_at DESC
`).all();


const headers = [

"ID",
"Created UTC",
"Created Florida Time",
"Inquiry Type",
"First Name",
"Last Name",
"Email",
"Phone",
"Preferred Contact",
"County",
"Property Type",
"Acreage",
"Timeframe",
"Owner Status",
"Best Contact Time",
"How Heard About FLTract",
"Source Page",
"Improvements",
"Property Location",
"Details",
"Status",
"Marketing Email Opt In",
"Live Call Opt In",
"Text Opt In",
"Do Not Email",
"Do Not Call",
"Do Not Text",
"Phone Contact Expires",
"Next Follow Up",
"Follow Up Reason"

];


const rows =
results.map(r => [

r.id,
r.created_at,
floridaTime(r.created_at),
r.inquiry_type,
r.first_name,
r.last_name,
r.email,
r.phone,
r.preferred_contact,
r.county,
r.property_type,
r.acreage,
r.timeframe,
r.owner_status,
r.best_contact_time,
r.referral_source,
r.source_page,
r.improvements,
r.property_location,
r.details,
r.status,
r.marketing_email_opt_in,
r.live_call_opt_in,
r.text_opt_in,
r.do_not_email,
r.do_not_call,
r.do_not_text,
r.phone_contact_expires_at,
r.next_follow_up_date,
r.next_follow_up_reason

].map(csvCell).join(","));


const csv =
[
headers.map(csvCell).join(","),
...rows
].join("\r\n");


return new Response(
csv,
{
headers:{
"content-type":
"text/csv; charset=utf-8",

"content-disposition":
'attachment; filename="fltract-inquiries.csv"',

"cache-control":
"no-store"
}
}
);

}


/* ============================================================
   STATUS CHANGE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/status$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}


const id =
idFromPath(url.pathname);


const form =
await request.formData();


const status =
String(
form.get("status") || ""
);


if (
!id ||
!STATUSES.includes(status)
) {

return new Response(
"Invalid status update.",
{status:400}
);

}


const existing =
await env.DB.prepare(`
SELECT status
FROM inquiries
WHERE id = ?
`)
.bind(id)
.first();


if (!existing) {

return new Response(
"Inquiry not found.",
{status:404}
);

}


await env.DB.prepare(`
UPDATE inquiries

SET
status = ?,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
status,
id
)
.run();


if (
existing.status !== status
) {

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Status Change',
?
)
`)
.bind(
id,
`Status changed from ${existing.status} to ${status}.`
)
.run();

}


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   INTERNAL NOTE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/note$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}


const id =
idFromPath(url.pathname);


const form =
await request.formData();


const note =
String(
form.get("note") || ""
).trim();


if (
!id ||
!note ||
note.length > 4000
) {

return new Response(
"Invalid note.",
{status:400}
);

}

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Internal Note',
?
)
`)
.bind(
id,
note
)
.run();


await env.DB.prepare(`
UPDATE inquiries
SET updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(id)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   REFERRAL WORKFLOW — PREPARE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/referral$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}

const id = idFromPath(url.pathname);
const form = await request.formData();

const name = String(form.get("referred_to_name") || "").trim().slice(0,200);
const company = String(form.get("referred_to_company") || "").trim().slice(0,200);
const email = String(form.get("referred_to_email") || "").trim().toLowerCase().slice(0,254);
const phone = String(form.get("referred_to_phone") || "").trim().slice(0,100);
const referralNote = String(form.get("referral_note") || "").trim().slice(0,4000);

if (!id || (!name && !company) || !email || !referralNote) {
return new Response(
"Referral preparation requires a name or company, email address, and referral message.",
{status:400}
);
}

await env.DB.prepare(`
INSERT INTO referral_history (
inquiry_id,
referred_to_name,
referred_to_company,
referred_to_email,
referred_to_phone,
referral_status,
referral_date,
referral_note
)
VALUES (?,?,?,?,?,'Prepared',NULL,?)
`)
.bind(
id,
name,
company,
email,
phone,
referralNote
)
.run();

const who = company || name;

await env.DB.prepare(`
UPDATE inquiries
SET
status = 'Referral Prepared',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(id)
.run();

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)
VALUES (
?,
'Referral Prepared',
?
)
`)
.bind(
id,
`Referral communication prepared for ${who}; human approval required before sending.`
)
.run();

return redirect(`/inquiry/${id}`);

}


/* ============================================================
   REFERRAL WORKFLOW — APPROVE & SEND
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/referral-send$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}

if (!env.SEND_EMAIL) {
return new Response(
"Email binding SEND_EMAIL is missing.",
{status:500}
);
}

const id = idFromPath(url.pathname);
const form = await request.formData();
const referralId = Number(form.get("referral_id"));
const followupDate = String(form.get("followup_date") || "").trim();

if (
!id ||
!Number.isInteger(referralId) ||
referralId < 1 ||
!/^\d{4}-\d{2}-\d{2}$/.test(followupDate)
) {
return new Response(
"A valid prepared referral and follow-up date are required.",
{status:400}
);
}

const referral = await env.DB.prepare(`
SELECT *
FROM referral_history
WHERE
id = ?
AND inquiry_id = ?
AND referral_status = 'Prepared'
LIMIT 1
`)
.bind(referralId,id)
.first();

if (!referral) {
return new Response(
"Prepared referral not found or already sent.",
{status:409}
);
}

const inquiry = await env.DB.prepare(`
SELECT *
FROM inquiries
WHERE id = ?
LIMIT 1
`)
.bind(id)
.first();

if (!inquiry) {
return new Response(
"Inquiry not found.",
{status:404}
);
}

const recipient = String(referral.referred_to_email || "").trim().toLowerCase();
const subject = `FLTract Referral — Inquiry #${id}`;
const message = String(referral.referral_note || "").trim();

if (!recipient || !message) {
return new Response(
"Prepared referral is missing its recipient or message.",
{status:400}
);
}

let emailLogId = null;

try {

const logResult = await env.DB.prepare(`
INSERT INTO email_log (
inquiry_id,
email_type,
recipient,
subject,
status
)
VALUES (
?,
'Referral Communication',
?,
?,
'Prepared'
)
`)
.bind(id,recipient,subject)
.run();

emailLogId = Number(logResult?.meta?.last_row_id) || null;

const sendResult = await env.SEND_EMAIL.send({
to: recipient,
from: "noreply@fltract.com",
subject,
text: message,
html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${esc(message)}</div>`
});

if (emailLogId) {
await env.DB.prepare(`
UPDATE email_log
SET
status = 'Sent',
provider_message_id = ?,
sent_at = CURRENT_TIMESTAMP,
failure_reason = NULL
WHERE id = ?
`)
.bind(sendResult?.messageId ?? null,emailLogId)
.run();
}

await env.DB.prepare(`
UPDATE referral_history
SET
referral_status = 'Referred',
referral_date = DATE('now')
WHERE
id = ?
AND inquiry_id = ?
`)
.bind(referralId,id)
.run();

await env.DB.prepare(`
UPDATE inquiries
SET
status = 'Referred',
next_follow_up_date = ?,
next_follow_up_reason = 'Confirm referral professional contacted client',
follow_up_status = 'Open',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(followupDate,id)
.run();

await env.DB.prepare(`
INSERT INTO follow_ups (
inquiry_id,
due_date,
reason,
status
)
VALUES (
?,
?,
'Confirm referral professional contacted client',
'Open'
)
`)
.bind(id,followupDate)
.run();

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)
VALUES (
?,
'Referral Sent',
?
)
`)
.bind(
id,
`Referral #${referralId} approved and sent to ${recipient}. Follow-up scheduled for ${followupDate}.`
)
.run();

}
catch (error) {

if (emailLogId) {
try {
await env.DB.prepare(`
UPDATE email_log
SET
status = 'Failed',
failure_reason = ?
WHERE id = ?
`)
.bind(
String(error?.message || error || "Unknown referral email error"),
emailLogId
)
.run();
} catch {}
}

console.error("Referral send failed:", error);

return new Response(
"Referral email was not sent. The referral remains prepared for review.",
{status:502}
);
}

return redirect(`/inquiry/${id}`);

}


/* ============================================================
   CONTACT PERMISSION CHANGE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/permission$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {

return new Response(
"Invalid request origin.",
{status:403}
);

}


const id =
idFromPath(url.pathname);

const form =
await request.formData();


const channel =
String(
form.get("channel") || ""
);


const action =
String(
form.get("permission_action") || ""
);


const note =
String(
form.get("permission_note") || ""
).trim().slice(0,4000);


if (
!id ||
!["Email","Phone","Text"].includes(channel) ||
!["Allow","Withdraw"].includes(action)
) {

return new Response(
"Invalid permission change.",
{status:400}
);

}


const inquiry =
await env.DB.prepare(`
SELECT *
FROM inquiries
WHERE id = ?
`)
.bind(id)
.first();


if (!inquiry) {

return new Response(
"Inquiry not found.",
{status:404}
);

}


const granted =
action === "Allow"
? 1
: 0;


let contactValue = "";

let purpose = "";

let eventType =
granted
? "Permission Granted"
: "Permission Withdrawn";


/* ---------- EMAIL ---------- */

if (channel === "Email") {

contactValue =
inquiry.email || "";

purpose =
"Future email communications";


if (granted) {

await env.DB.prepare(`
UPDATE inquiries

SET
marketing_email_opt_in = 1,
do_not_email = 0,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


await env.DB.prepare(`
UPDATE suppression_list

SET active = 0

WHERE
channel = 'Email'
AND contact_value = ?
`)
.bind(contactValue)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
marketing_email_opt_in = 0,
do_not_email = 1,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


if (contactValue) {

await env.DB.prepare(`
INSERT INTO suppression_list (
channel,
contact_value,
reason,
inquiry_id,
source,
active
)

VALUES (
'Email',
?,
?,
?,
'Client Preference Change',
1
)

ON CONFLICT(channel, contact_value)
DO UPDATE SET
reason = excluded.reason,
inquiry_id = excluded.inquiry_id,
source = excluded.source,
active = 1
`)
.bind(
contactValue,
"Client withdrew email permission.",
id
)
.run();

}

}

}


/* ---------- PHONE ---------- */

if (channel === "Phone") {

contactValue =
inquiry.phone || "";

purpose =
"Live telephone follow-up";


if (granted) {

const today =
floridaToday();

const expires =
addDays(
today,
inquiryCallDays
);


await env.DB.prepare(`
UPDATE inquiries

SET
live_call_opt_in = 1,
do_not_call = 0,
contact_authority_basis = 'Client Reauthorization',
contact_authority_started_at = CURRENT_TIMESTAMP,
phone_contact_expires_at = ?,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
expires,
id
)
.run();


await env.DB.prepare(`
UPDATE suppression_list

SET active = 0

WHERE
channel = 'Phone'
AND contact_value = ?
`)
.bind(contactValue)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
live_call_opt_in = 0,
do_not_call = 1,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


if (contactValue) {

await env.DB.prepare(`
INSERT INTO suppression_list (
channel,
contact_value,
reason,
inquiry_id,
source,
active
)

VALUES (
'Phone',
?,
?,
?,
'Client Preference Change',
1
)

ON CONFLICT(channel, contact_value)
DO UPDATE SET
reason = excluded.reason,
inquiry_id = excluded.inquiry_id,
source = excluded.source,
active = 1
`)
.bind(
contactValue,
"Client requested no further telephone contact.",
id
)
.run();

}

}

}


/* ---------- TEXT ---------- */

if (channel === "Text") {

contactValue =
inquiry.phone || "";

purpose =
"Text communications";


if (granted) {

await env.DB.prepare(`
UPDATE inquiries

SET
text_opt_in = 1,
do_not_text = 0,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


await env.DB.prepare(`
UPDATE suppression_list

SET active = 0

WHERE
channel = 'Text'
AND contact_value = ?
`)
.bind(contactValue)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
text_opt_in = 0,
do_not_text = 1,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


if (contactValue) {

await env.DB.prepare(`
INSERT INTO suppression_list (
channel,
contact_value,
reason,
inquiry_id,
source,
active
)

VALUES (
'Text',
?,
?,
?,
'Client Preference Change',
1
)

ON CONFLICT(channel, contact_value)
DO UPDATE SET
reason = excluded.reason,
inquiry_id = excluded.inquiry_id,
source = excluded.source,
active = 1
`)
.bind(
contactValue,
"Client withdrew text permission.",
id
)
.run();

}

}

}


/* ---------- AUDIT HISTORY ---------- */

await env.DB.prepare(`
INSERT INTO consent_history (
inquiry_id,
event_type,
channel,
purpose,
permission_granted,
consent_version,
contact_value,
source,
event_note
)

VALUES (
?,?,?,?,?,?,?,?,?
)
`)
.bind(
id,
eventType,
channel,
purpose,
granted,
"ADMIN-PREFERENCE-CHANGE-001",
contactValue,
"FLTract Admin",
note || `${channel} permission ${action.toLowerCase()}.`
)
.run();


await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Contact Permission',
?
)
`)
.bind(
id,
`${channel} permission ${action.toLowerCase()}. ${note}`
)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   CREATE FOLLOW UP
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/followup$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {

return new Response(
"Invalid request origin.",
{status:403}
);

}


const id =
idFromPath(url.pathname);

const form =
await request.formData();


const dueDate =
String(
form.get("due_date") || ""
).trim();


const reason =
String(
form.get("reason") || ""
).trim().slice(0,1000);


if (
!id ||
!dueDate ||
!reason
) {

return new Response(
"Follow-up date and reason are required.",
{status:400}
);

}


await env.DB.prepare(`
INSERT INTO follow_ups (
inquiry_id,
due_date,
reason,
status
)

VALUES (
?,
?,
?,
'Open'
)
`)
.bind(
id,
dueDate,
reason
)
.run();


await env.DB.prepare(`
UPDATE inquiries

SET
next_follow_up_date = ?,
next_follow_up_reason = ?,
follow_up_status = 'Open',
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
dueDate,
reason,
id
)
.run();


await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Follow Up Scheduled',
?
)
`)
.bind(
id,
`Follow up scheduled for ${dueDate}: ${reason}`
)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   COMPLETE FOLLOW UP
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/followup-complete$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {

return new Response(
"Invalid request origin.",
{status:403}
);

}


const id =
idFromPath(url.pathname);

const form =
await request.formData();


const followupId =
Number(
form.get("followup_id")
);


const completedNote =
String(
form.get("completed_note") || ""
).trim().slice(0,4000);


if (
!id ||
!Number.isInteger(followupId)
) {

return new Response(
"Invalid follow-up.",
{status:400}
);

}


await env.DB.prepare(`
UPDATE follow_ups

SET
status = 'Completed',
completed_at = CURRENT_TIMESTAMP,
completed_note = ?

WHERE
id = ?
AND inquiry_id = ?
`)
.bind(
completedNote,
followupId,
id
)
.run();


const nextOpen =
await env.DB.prepare(`
SELECT
id,
due_date,
reason

FROM follow_ups

WHERE
inquiry_id = ?
AND status = 'Open'

ORDER BY due_date ASC
LIMIT 1
`)
.bind(id)
.first();


if (nextOpen) {

await env.DB.prepare(`
UPDATE inquiries

SET
next_follow_up_date = ?,
next_follow_up_reason = ?,
follow_up_status = 'Open',
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
nextOpen.due_date,
nextOpen.reason,
id
)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
next_follow_up_date = NULL,
next_follow_up_reason = NULL,
follow_up_status = 'None',
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();

}


await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Follow Up Completed',
?
)
`)
.bind(
id,
completedNote
? `Follow up completed: ${completedNote}`
: "Follow up completed."
)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   FOLLOW UP DASHBOARD
   ============================================================ */

if (
request.method === "GET" &&
url.pathname === "/followups"
) {

const today =
floridaToday();


const open =
await env.DB.prepare(`
SELECT
f.id AS followup_id,
f.inquiry_id,
f.due_date,
f.reason,
i.first_name,
i.last_name,
i.county,
i.status AS inquiry_status

FROM follow_ups f

JOIN inquiries i
ON i.id = f.inquiry_id

WHERE f.status = 'Open'

ORDER BY f.due_date ASC
`).all();


let overdue = 0;
let dueToday = 0;
let future = 0;


const rows =
open.results.length
?
open.results.map(r => {

let cls =
"followup-future";

let dueLabel =
calendarDate(r.due_date);


if (r.due_date < today) {
overdue++;
cls =
"followup-overdue";
dueLabel +=
" — OVERDUE";
}
else if (r.due_date === today) {
dueToday++;cls =
"followup-today";
dueLabel +=
" — DUE TODAY";
}
else {
future++;
}


return `

<div class="panel ${cls}">

<div class="grid">

<div>
<div class="label">
Client
</div>

<div class="value">
<a href="/inquiry/${r.inquiry_id}">
#${r.inquiry_id}
${esc(r.first_name)}
${esc(r.last_name)}
</a>
</div>
</div>


<div>
<div class="label">
Due
</div>

<div class="value">
${esc(dueLabel)}
</div>
</div>


<div>
<div class="label">
County
</div>

<div class="value">
${esc(r.county)}
</div>
</div>


<div>
<div class="label">
Inquiry Status
</div>

<div class="value">
${esc(r.inquiry_status)}
</div>
</div>

</div>


<div style="margin-top:15px">

<div class="label">
Reason
</div>

<div class="value">
${esc(r.reason)}
</div>

</div>

</div>

`;

}).join("")
:
`
<div class="panel empty">
No open follow-ups.
</div>
`;


return new Response(
page(`

<h1>
Follow Ups
</h1>


<div class="summary-grid">

<div class="summary-card">

<div class="label">
Overdue
</div>

<div class="summary-number">
${overdue}
</div>

</div>


<div class="summary-card">

<div class="label">
Due Today
</div>

<div class="summary-number">
${dueToday}
</div>

</div>


<div class="summary-card">

<div class="label">
Upcoming
</div>

<div class="summary-number">
${future}
</div>

</div>

</div>


${rows}

`),
{
headers:{
"content-type":
"text/html; charset=utf-8",

"cache-control":
"no-store"
}
}
);

}


/* ============================================================
   INQUIRY DETAIL
   ============================================================ */

if (
request.method === "GET" &&
/^\/inquiry\/\d+$/.test(
url.pathname
)
) {

const id =
idFromPath(url.pathname);


const inquiry =
await env.DB.prepare(`
SELECT *
FROM inquiries
WHERE id = ?
`)
.bind(id)
.first();


if (!inquiry) {

return new Response(
"Inquiry not found.",
{status:404}
);

}


const activities =
await env.DB.prepare(`
SELECT *
FROM activity_log
WHERE inquiry_id = ?
ORDER BY
created_at DESC,
id DESC
`)
.bind(id)
.all();


const referrals =
await env.DB.prepare(`
SELECT *
FROM referral_history
WHERE inquiry_id = ?
ORDER BY
created_at DESC,
id DESC
`)
.bind(id)
.all();


const consents =
await env.DB.prepare(`
SELECT *
FROM consent_history
WHERE inquiry_id = ?
ORDER BY
created_at DESC,
id DESC
`)
.bind(id)
.all();


const followups =
await env.DB.prepare(`
SELECT *
FROM follow_ups
WHERE inquiry_id = ?
ORDER BY
due_date DESC,
id DESC
`)
.bind(id)
.all();


const phoneStatus =
phoneContactStatus(
inquiry,
warningDays
);


const emailStatus =
emailContactStatus(
inquiry
);


const textStatus =
textContactStatus(
inquiry
);


const statusOptions =
STATUSES
.map(s => `
<option
value="${esc(s)}"
${inquiry.status === s
? "selected"
: ""}
>
${esc(s)}
</option>
`)
.join("");


const activityHtml =
activities.results.length
?
activities.results
.map(a => `

<div class="panel">

<div class="label">
${esc(a.activity_type)}
</div>

<div class="value note">
${esc(a.activity_note)}
</div>

<div class="small"
style="margin-top:10px">
${esc(
floridaTime(
a.created_at
)
)}
</div>

</div>

`)
.join("")
:
`
<div class="panel empty">
No activity recorded yet.
</div>
`;


const referralHtml =
referrals.results.length
?
referrals.results
.map(r => `

<div class="panel">

<div class="grid">

<div>
<div class="label">
Name
</div>
<div class="value">
${esc(r.referred_to_name)}
</div>
</div>


<div>
<div class="label">
Company
</div>
<div class="value">
${esc(r.referred_to_company)}
</div>
</div>


<div>
<div class="label">
Email
</div>
<div class="value">
${esc(r.referred_to_email)}
</div>
</div>


<div>
<div class="label">
Phone
</div>
<div class="value">
${esc(r.referred_to_phone)}
</div>
</div>


<div>
<div class="label">
Status
</div>
<div class="value">
${esc(r.referral_status)}
</div>
</div>


<div>
<div class="label">
Referral Date
</div>
<div class="value">
${esc(
calendarDate(
r.referral_date
)
)}
</div>
</div>

</div>


${r.referral_note
?
`
<div style="margin-top:18px">

<div class="label">
Referral Note
</div>

<div class="value note">
${esc(r.referral_note)}
</div>

</div>
`
:
""}


<div
class="small"
style="margin-top:14px"
>

Record created:
${esc(
floridaTime(
r.created_at
)
)}

</div>

${r.referral_status === "Prepared" && r.referred_to_email
?
`
<form
method="post"
action="/inquiry/${id}/referral-send"
style="margin-top:16px"
>
<input type="hidden" name="referral_id" value="${esc(r.id)}">

<div class="form-grid">
<label>
<span>Follow-Up Date After Referral *</span>
<input type="date" name="followup_date" required>
</label>
</div>

<div style="margin-top:12px">
<button type="submit">
Approve & Send Referral
</button>
</div>

<p class="section-note">
This button sends the exact prepared referral message above, records the email result, changes the inquiry to Referred, and schedules the follow-up date you select.
</p>
</form>
`
:
""}

</div>

`)
.join("")
:
`
<div class="panel empty">
No referrals recorded yet.
</div>
`;


const consentHtml =
consents.results.length
?
consents.results
.map(c => `

<div class="panel">

<div class="grid">

<div>
<div class="label">
Event
</div>
<div class="value">
${esc(c.event_type)}
</div>
</div>


<div>
<div class="label">
Channel
</div>
<div class="value">
${esc(c.channel)}
</div>
</div>


<div>
<div class="label">
Permission
</div>
<div class="value">
${Number(c.permission_granted) === 1
? "Granted"
: "Withdrawn"}
</div>
</div>


<div>
<div class="label">
Contact Value
</div>
<div class="value">
${esc(c.contact_value)}
</div>
</div>


<div>
<div class="label">
Source
</div>
<div class="value">
${esc(c.source)}
</div>
</div>


<div>
<div class="label">
Recorded
</div>
<div class="value">
${esc(
floridaTime(
c.created_at
)
)}
</div>
</div>

</div>


${c.event_note
?
`
<div style="margin-top:14px">

<div class="label">
Note
</div>

<div class="value note">
${esc(c.event_note)}
</div>

</div>
`
:
""}

</div>

`)
.join("")
:
`
<div class="panel empty">
No consent-history events recorded yet.
</div>
`;


const followupHtml =
followups.results.length
?
followups.results
.map(f => `

<div class="panel">

<div class="grid">

<div>
<div class="label">
Due
</div>
<div class="value">
${esc(
calendarDate(
f.due_date
)
)}
</div>
</div>


<div>
<div class="label">
Status
</div>
<div class="value">
${esc(f.status)}
</div>
</div>

</div>


<div style="margin-top:14px">

<div class="label">
Reason
</div>

<div class="value">
${esc(f.reason)}
</div>

</div>


${f.completed_note
?
`
<div style="margin-top:14px">

<div class="label">
Completion Note
</div>

<div class="value note">
${esc(f.completed_note)}
</div>

</div>
`
:
""}


${f.status === "Open"
?
`
<form
method="post"
action="/inquiry/${id}/followup-complete"
style="margin-top:18px"
>

<input
type="hidden"
name="followup_id"
value="${f.id}"
>

<label>

<span>
Completion Note
</span>

<textarea
name="completed_note"
rows="3"
maxlength="4000"
></textarea>

</label>

<div style="margin-top:10px">

<button type="submit">
Follow Up Complete
</button>

</div>

</form>
`
:
""}

</div>

`)
.join("")
:
`
<div class="panel empty">
No follow-ups recorded yet.
</div>
`;


const html =
page(`

<a
class="back"
href="/"
>
← Back to inquiries
</a>


<div class="panel">

<h1>
Inquiry #${esc(inquiry.id)}
</h1>


<div class="grid">

<div>
<div class="label">
Received
</div>
<div class="value">
${esc(
floridaTime(
inquiry.created_at
)
)}
</div>
</div>


<div>
<div class="label">
Status
</div>
<div class="value">
<span class="badge">
${esc(inquiry.status)}
</span>
</div>
</div>


<div>
<div class="label">
Name
</div>
<div class="value">
${esc(inquiry.first_name)}
${esc(inquiry.last_name)}
</div>
</div>


<div>
<div class="label">
Preferred Contact
</div>
<div class="value">
${esc(inquiry.preferred_contact)}
</div>
</div>


<div>
<div class="label">
Email
</div>
<div class="value">
${esc(inquiry.email)}
</div>
</div>


<div>
<div class="label">
Phone
</div>
<div class="value">
${esc(inquiry.phone)}
</div>
</div>


<div>
<div class="label">
Inquiry Type
</div>
<div class="value">
${esc(inquiry.inquiry_type)}
</div>
</div>


<div>
<div class="label">
County
</div>
<div class="value">
${esc(inquiry.county)}
</div>
</div>


<div>
<div class="label">
Property Type
</div>
<div class="value">
${esc(inquiry.property_type)}
</div>
</div>


<div>
<div class="label">
Approx. Acreage
</div>
<div class="value">
${esc(inquiry.acreage)}
</div>
</div>


<div>
<div class="label">
Timeframe
</div>
<div class="value">
${esc(inquiry.timeframe || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Owner Status
</div>
<div class="value">
${esc(inquiry.owner_status || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Best Contact Time
</div>
<div class="value">
${esc(inquiry.best_contact_time || "Not recorded")}
</div>
</div>

<div>
<div class="label">
How Heard About FLTract
</div>
<div class="value">
${esc(inquiry.referral_source || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Source Page
</div>
<div class="value">
${esc(inquiry.source_page || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Improvements
</div>
<div class="value">
${esc(inquiry.improvements)}
</div>
</div>


<div>
<div class="label">
Property Location
</div>
<div class="value">
${esc(inquiry.property_location)}
</div>
</div>

</div>


<div style="margin-top:20px">

<div class="label">
Client Details
</div>

<div class="value note">
${esc(inquiry.details)}
</div>

</div>

</div>


<!-- ======================================================
     CONTACT COMPLIANCE
     ====================================================== -->

<div class="panel">

<h2>
Contact Compliance
</h2>


<div class="grid">

<div>

<div class="label">
Phone
</div>

<div class="value">
<span class="badge ${phoneStatus.css}">
${esc(phoneStatus.text)}
</span>
</div>

</div>


<div>

<div class="label">
Email
</div>

<div class="value">
<span class="badge ${emailStatus.css}">
${esc(emailStatus.text)}
</span>
</div>

</div>


<div>

<div class="label">
Text
</div>

<div class="value">
<span class="badge ${textStatus.css}">
${esc(textStatus.text)}
</span>
</div>

</div>


<div>

<div class="label">
Contact Authority Basis
</div>

<div class="value">
${esc(
inquiry.contact_authority_basis ||
"Not yet recorded"
)}
</div>

</div>


<div>

<div class="label">
Phone Contact Through
</div>

<div class="value">
${inquiry.phone_contact_expires_at
? esc(
calendarDate(
String(
inquiry.phone_contact_expires_at
).slice(0,10)
)
)
: "Not established"}
</div>

</div>


<div>

<div class="label">
Consent Version
</div>

<div class="value">
${esc(
inquiry.consent_version ||
"Legacy / Not recorded"
)}
</div>

</div>

</div>


<p class="section-note">

Contact permissions are channel-specific.
A withdrawal does not delete the inquiry.
It creates a compliance history record and,
when appropriate, a suppression-list entry.

</p>

</div>


<div class="panel">

<h2>
Record Client Contact Preference Change
</h2>


<form
method="post"
action="/inquiry/${id}/permission"
>

<div class="form-grid">

<label>

<span>
Channel
</span>

<select
name="channel"
required
>

<option value="">
Select
</option>

<option>
Email
</option>

<option>
Phone
</option>

<option>
Text
</option>

</select>
</label>


<label>

<span>
Action
</span>

<select
name="permission_action"
required
>

<option value="">
Select
</option>

<option>
Allow
</option>

<option>
Withdraw
</option>

</select>

</label>


<label class="full">

<span>
Reason / Client Request
</span>

<textarea
name="permission_note"
rows="3"
maxlength="4000"
placeholder="Example: Client requested no further telephone contact."
></textarea>

</label>

</div>


<div style="margin-top:14px">

<button type="submit">
Record Preference Change
</button>

</div>

</form>

</div>


<!-- ======================================================
     STATUS
     ====================================================== -->

<div class="panel">

<h2>
Change Status
</h2>


<form
method="post"
action="/inquiry/${id}/status"
>

<div class="action-row">

<label>

<span>
Status
</span>

<select name="status">
${statusOptions}
</select>

</label>


<button type="submit">
Save Status
</button>

</div>

</form>

</div>


<!-- ======================================================
     INTERNAL NOTE
     ====================================================== -->

<div class="panel">

<h2>
Add Internal Note
</h2>


<form
method="post"
action="/inquiry/${id}/note"
>

<label>

<span>
Note
</span>

<textarea
name="note"
rows="5"
maxlength="4000"
required
></textarea>

</label>


<div style="margin-top:12px">

<button type="submit">
Add Note
</button>

</div>

</form>

</div>


<!-- ======================================================
     FOLLOW UP
     ====================================================== -->

<div class="panel">

<h2>
Schedule Follow Up
</h2>


<form
method="post"
action="/inquiry/${id}/followup"
>

<div class="form-grid">

<label>

<span>
Follow-Up Date
</span>

<input
type="date"
name="due_date"
required
>

</label>


<label>

<span>
Reason
</span>

<input
name="reason"
maxlength="1000"
placeholder="Example: Confirm broker contacted client"
required
>

</label>

</div>


<div style="margin-top:14px">

<button type="submit">
Schedule Follow Up
</button>

</div>

</form>

</div>


<h2>
Follow-Up History
</h2>

${followupHtml}


<!-- ======================================================
     ACTIVITY
     ====================================================== -->

<h2>
Activity History
</h2>

${activityHtml}


<!-- ======================================================
     REFERRAL
     ====================================================== -->

<div class="panel">

<h2>
Prepare Referral
</h2>

<p class="section-note">
Prepare and review the referral here. Nothing is sent until you use the separate Approve &amp; Send Referral button in Referral History.
</p>

<form
method="post"
action="/inquiry/${id}/referral"
>

<div class="form-grid">

<label>
<span>Broker / Agent Name</span>
<input name="referred_to_name" maxlength="200">
</label>

<label>
<span>Company / Brokerage</span>
<input name="referred_to_company" maxlength="200">
</label>

<label>
<span>Email *</span>
<input type="email" name="referred_to_email" maxlength="254" required>
</label>

<label>
<span>Phone</span>
<input name="referred_to_phone" maxlength="100">
</label>

<label class="full">
<span>Referral Message *</span>
<textarea
name="referral_note"
rows="16"
maxlength="4000"
required
>Hello,

FLTract is referring the following property inquiry for your review.

Client: ${esc(inquiry.first_name)} ${esc(inquiry.last_name)}
Preferred contact: ${esc(inquiry.preferred_contact)}
Email: ${esc(inquiry.email)}
Phone: ${esc(inquiry.phone)}
County: ${esc(inquiry.county)}
Property type: ${esc(inquiry.property_type)}
Approx. acreage: ${esc(inquiry.acreage)}
Property location: ${esc(inquiry.property_location)}

Client inquiry:
${esc(inquiry.details)}

Please review the inquiry and contact the client directly as appropriate.

FLTract
Florida Land & Property Information and Referral Resource</textarea>
</label>

</div>

<div style="margin-top:14px">
<button type="submit">
Prepare Referral for Review
</button>
</div>

</form>

</div>


<h2>
Referral History
</h2>

${referralHtml}


<!-- ======================================================
     CONSENT HISTORY
     ====================================================== -->

<h2>
Consent & Contact Preference History
</h2>

${consentHtml}

`,
`Inquiry #${inquiry.id} | FLTract Admin`
);


return new Response(
html,
{
headers:{
"content-type":
"text/html; charset=utf-8",

"cache-control":
"no-store",

"x-content-type-options":
"nosniff",

"referrer-policy":
"no-referrer"
}
}
);

}


/* ============================================================
   MAIN INQUIRY LIST
   ============================================================ */

const status =
url.searchParams.get("status") || "";

const county =
url.searchParams.get("county") || "";

const search =
url.searchParams.get("q") || "";


let sql = `
SELECT *
FROM inquiries
WHERE archived = 0
`;


const params = [];


if (status) {

sql += `
AND status = ?
`;

params.push(status);

}


if (county) {

sql += `
AND county = ?
`;

params.push(county);

}


if (search) {

sql += `
AND (
first_name LIKE ?
OR last_name LIKE ?
OR property_location LIKE ?
)
`;

const term =
`%${search}%`;

params.push(
term,
term,
term
);

}


sql += `
ORDER BY created_at DESC
LIMIT 250
`;


const stmt =
env.DB.prepare(sql);


const { results } =
params.length
?
await stmt.bind(...params).all()
:
await stmt.all();


const today =
floridaToday();


let dueTodayCount = 0;
let overdueCount = 0;


for (const r of results) {

if (
r.follow_up_status === "Open" &&
r.next_follow_up_date
) {

if (
r.next_follow_up_date < today
) {
overdueCount++;
}
else if (
r.next_follow_up_date === today
) {
dueTodayCount++;
}

}

}


const rows =
results.length
?
results.map(r => {

const phone =
phoneContactStatus(
r,
warningDays
);


let followup = "";

if (
r.follow_up_status === "Open" &&
r.next_follow_up_date
) {

if (
r.next_follow_up_date < today
) {

followup =
`<span class="badge danger">OVERDUE</span>`;

}
else if (
r.next_follow_up_date === today
) {

followup =
`<span class="badge warning">DUE TODAY</span>`;

}
else {

followup =
esc(
calendarDate(
r.next_follow_up_date
)
);

}

}


return `

<tr>

<td>
<a href="/inquiry/${r.id}">
#${esc(r.id)}
</a>
</td>


<td>
${esc(
floridaTime(
r.created_at
)
)}
</td>


<td>
${esc(r.first_name)}
${esc(r.last_name)}
</td>


<td>
${esc(r.inquiry_type)}
</td>


<td>
${esc(r.county)}
</td>


<td>
${esc(r.property_type)}
</td>


<td>
<span class="badge">
${esc(r.status)}
</span>
</td>


<td>
<span class="badge ${phone.css}">
${esc(phone.text)}
</span>
</td>


<td>
${followup}
</td>

</tr>

`;

}).join("")
:
`
<tr>
<td
colspan="9"
class="empty"
>
No inquiries found.
</td>
</tr>
`;


const statusOptions =
STATUSES
.map(s => `

<option
value="${esc(s)}"
${status === s
? "selected"
: ""}
>
${esc(s)}
</option>

`)
.join("");


const html =
page(`

<h1>
Property Inquiries
</h1>


<div class="summary-grid">

<div class="summary-card">

<div class="label">
Open Records
</div>

<div class="summary-number">
${results.length}
</div>

</div>


<div class="summary-card">

<div class="label">
Follow Ups Due Today
</div>

<div class="summary-number">
${dueTodayCount}
</div>

</div>


<div class="summary-card">

<div class="label">
Overdue Follow Ups
</div>

<div class="summary-number">
${overdueCount}
</div>

</div>

</div>


<div class="panel">

<form
class="filters"
method="get"
>

<input
name="q"
value="${esc(search)}"
placeholder="Search name or property location"
>


<select name="status">

<option value="">
All statuses
</option>

${statusOptions}

</select>


<select name="county">

<option value="">
All counties
</option>

<option
${county === "Brevard"
? "selected"
: ""}
>
Brevard
</option>

<option
${county === "Indian River"
? "selected"
: ""}
>
Indian River
</option>

<option
${county === "St. Lucie"
? "selected"
: ""}
>
St. Lucie
</option>

<option
${county === "Martin"
? "selected"
: ""}
>
Martin
</option>

<option
${county === "Okeechobee"
? "selected"
: ""}
>
Okeechobee
</option>

</select>


<button type="submit">
Filter
</button>

</form>


<table>

<thead>

<tr>

<th>
ID
</th>

<th>
Received
</th>

<th>
Contact
</th>

<th>
Inquiry
</th>

<th>
County
</th>

<th>
Property
</th>

<th>
Status
</th>

<th>
Phone Contact
</th>

<th>
Follow Up
</th>

</tr>

</thead>


<tbody>

${rows}

</tbody>

</table>

</div>

`);


return new Response(
html,
{
headers:{
"content-type":
"text/html; charset=utf-8",

"cache-control":
"no-store",

"x-content-type-options":
"nosniff",

"referrer-policy":
"no-referrer"
}
}
);

}

};