import admin from './worker.mjs';
import intake from '../intake/worker.mjs';
import contactHtml from '../../contact/index.html';
import siteCss from '../../assets/css/site.css';

// Review-only viewport harness. Production uses worker.mjs directly.
// Every frame still passes through the real Access/JWT and staff checks.
const views = {
  routing: '/work-routing',
  inquiry: '/inquiry/15',
  candidates: '/property/15/mini-comp',
  public: 'https://fix-intake-validation-current-main-2026-10-17-fltract.b2bconsult4u.workers.dev/contact/'
};
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/__review/')) {
      return admin.fetch(request, env, ctx);
    }
    const authorized = await admin.fetch(new Request(new URL('/', url), {headers:request.headers}), env, ctx);
    if (authorized.status !== 200) return authorized;
    await authorized.body?.cancel();
    // Hard boundaries for this test adapter: exact private host, preview DB,
    // authenticated staff and same-origin writes. Never use this in production.
    if (url.hostname !== 'fltract-admin-pr24-review.b2bconsult4u.workers.dev' ||
        env.ACCESS_AUDIENCE !== '28ac8d421065c44934ea67d4e8050634abf660b550725c5a39f9f74497fa5c04') {
      return new Response('Review environment required.', {status:403});
    }
    if (url.pathname === '/__review/contact' && request.method === 'GET') {
      const html = contactHtml
        .replace('const PUBLIC_SUBMISSIONS_ENABLED=false;', 'const PUBLIC_SUBMISSIONS_ENABLED=true;')
        .replace('https://fltract-intake-5a25.b2bconsult4u.workers.dev/submit', '/__review/submit')
        .replace('/assets/css/site.css', '/__review/site.css')
        .replace('<main>', '<main><p role="status" style="padding:16px;background:#fff3cc">PRIVATE SYSTEM TEST — synthetic records only; preview database; no email is sent.</p>');
      return new Response(html, {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin'}});
    }
    if (url.pathname === '/__review/site.css' && request.method === 'GET') {
      return new Response(siteCss, {headers:{'content-type':'text/css; charset=utf-8','cache-control':'no-store'}});
    }
    if (url.pathname === '/__review/submit' && request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin) return new Response('Origin denied.', {status:403});
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 16384) return new Response('Too large.', {status:413});
      const reader = request.body?.getReader();
      const chunks = [];
      let bytes = 0;
      if (reader) {
        while (true) {
          const {value,done} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 16384) { await reader.cancel(); return new Response('Too large.', {status:413}); }
          chunks.push(value);
        }
      }
      const body = await new Blob(chunks).text();
      let payload;
      try { payload = JSON.parse(body); } catch { return new Response('Invalid JSON.', {status:400}); }
      if (!String(payload?.property_location || '').startsWith('SYNTHETIC-') ||
          !String(payload?.email || '').endsWith('@example.invalid')) {
        return Response.json({ok:false,error:'Private review accepts only SYNTHETIC- locations and example.invalid email addresses.'}, {status:400});
      }
      // Map a validated private request to the canonical intake origin without
      // changing production CORS. Use the real handler and preview DB, no mail.
      const headers = new Headers({'content-type':'application/json',origin:'https://fltract.com'});
      return intake.fetch(new Request('https://fltract.com/submit', {method:'POST',headers,body}), {...env,SEND_EMAIL:undefined}, ctx);
    }
    if (url.pathname !== '/__review/mobile' || request.method !== 'GET') return new Response('Not found.', {status:404});
    const view = Object.hasOwn(views, url.searchParams.get('view')) ? url.searchParams.get('view') : 'routing';
    const src = views[view];
    return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FLTract mobile viewport acceptance</title><style>body{margin:0;padding:16px;background:#e7ece9;font:16px Arial;color:#173c36}nav{display:flex;gap:16px;margin:12px 0}iframe{display:block;width:390px;height:844px;border:2px solid #173c36;background:white}</style><h1>Preview acceptance — 390 × 844 CSS pixels</h1><p>Actual protected application in a narrow browser viewport. Test database only.</p><nav>${Object.keys(views).map(k=>`<a href="?view=${k}">${k}</a>`).join('')}</nav><iframe title="Mobile viewport" src="${src}"></iframe></html>`, {
      headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff'}
    });
  }
};
