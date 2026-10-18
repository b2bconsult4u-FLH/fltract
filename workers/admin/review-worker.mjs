import admin from './worker.mjs';

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
    if (url.pathname !== '/__review/mobile' || request.method !== 'GET') {
      return admin.fetch(request, env, ctx);
    }
    const authorized = await admin.fetch(new Request(new URL('/', url), {headers:request.headers}), env, ctx);
    if (authorized.status !== 200) return authorized;
    await authorized.body?.cancel();
    const view = Object.hasOwn(views, url.searchParams.get('view')) ? url.searchParams.get('view') : 'routing';
    const src = views[view];
    return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FLTract mobile viewport acceptance</title><style>body{margin:0;padding:16px;background:#e7ece9;font:16px Arial;color:#173c36}nav{display:flex;gap:16px;margin:12px 0}iframe{display:block;width:390px;height:844px;border:2px solid #173c36;background:white}</style><h1>Preview acceptance — 390 × 844 CSS pixels</h1><p>Actual protected application in a narrow browser viewport. Test database only.</p><nav>${Object.keys(views).map(k=>`<a href="?view=${k}">${k}</a>`).join('')}</nav><iframe title="Mobile viewport" src="${src}"></iframe></html>`, {
      headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff'}
    });
  }
};
