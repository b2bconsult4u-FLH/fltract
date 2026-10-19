import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';

// Read-only release checks. No credentials, submissions, email or database writes.
const routes = ['/', '/regions/', '/brevard/', '/indian-river/', '/st-lucie/', '/martin/', '/okeechobee/', '/tract-desk/', '/landowner-guides/', '/contact/'];
const live = process.argv.includes('--live');
const expectAccess = process.argv.includes('--expect-access');
const intakeEnabled = process.argv.includes('--intake-enabled');
assert.ok(process.argv.slice(2).every(arg => ['--live','--expect-access','--intake-enabled'].includes(arg)), 'Unsupported option; the production target is fixed.');
assert.ok(!expectAccess || live, '--expect-access requires --live');
const base = 'https://fltract.com';
async function request(path) {
  const url = base + path;
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!expectAccess && response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      throw new Error('HTTP ' + response.status + ' redirect to ' + location);
    }
    return response;
  } catch (error) {
    const causes = [];
    for (let cause = error; cause; cause = cause.cause) {
      causes.push([cause.name, cause.code, cause.message].filter(Boolean).join(': '));
      if (cause instanceof AggregateError) {
        causes.push(...cause.errors.map(item => [item.code, item.message].filter(Boolean).join(': ')));
      }
    }
    throw new Error(url + ': ' + causes.join(' <- '), { cause: error });
  }
}
async function read(path) {
  if (!live) return readFile(new URL('..' + (path.endsWith('/') ? path + 'index.html' : path), import.meta.url), 'utf8');
  const response = await request(path);
  assert.equal(response.status, 200, path + ': HTTP ' + response.status);
  return response.text();
}
let checked = 0;
const failures = [];
async function check(name, action) {
  try { await action(); checked++; }
  catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
}
async function checkAccess(path) {
  const response = await request(path);
  assert.equal(response.status,302,path+': must redirect anonymous traffic to Access');
  const target = new URL(response.headers.get('location'));
  assert.equal(target.origin,'https://b2bconsult4u.cloudflareaccess.com');
  assert.ok(target.pathname.startsWith('/cdn-cgi/access/login/'));
  await response.body?.cancel();
  console.log('PASS owner-only Access redirect: '+path);
}
for (const path of routes) {
  await check(path, async () => {
  if(expectAccess)return checkAccess(path);
  const html = await read(path);
  const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i)?.[1];
  assert.ok(footer, path + ': footer missing');
  assert.match(footer, /FARLESS REAL ESTATE REFERRALS LLC\s*\|\s*CQ1034069/, path + ': exact brokerage identification missing');
  assert.match(footer, /SL3654181/, path + ': associate license missing');
  assert.ok(html.includes('href="' + base + path + '"'), path + ': canonical mismatch');
  assert.ok(html.includes('href="/assets/css/site.css"'), path + ': shared CSS missing');
  if (path === '/contact/') {
    assert.match(html, new RegExp('const\\s+PUBLIC_SUBMISSIONS_ENABLED\\s*=\\s*'+intakeEnabled+'\\s*;'), 'Intake enablement must match the explicit release mode');
    assert.match(html, /fltract-intake-5a25\.b2bconsult4u\.workers\.dev\/submit/, 'Unexpected intake destination');
  }
  console.log('PASS ' + path + ': disclosure, canonical and asset reference');
  });
}
for (const [path, pattern] of [
  ['/assets/css/site.css', /\.license-block/],
  ['/assets/js/property-records.js', /propertyRecords/],
  ['/assets/js/florida-places.js', /countiesForCity/],
  ['/assets/js/location-fields.js', /resolveCity/],
  ['/robots.txt', /Sitemap:/i],
  ['/sitemap.xml', /<urlset/],
]) {
  await check(path, async () => {
    if(expectAccess)return checkAccess(path);
    assert.match(await read(path), pattern, path + ': expected asset contents missing');
    console.log('PASS ' + path);
  });
}
if (live) {
  for (const path of ['/package.json', '/wrangler.jsonc', '/workers/intake/worker.mjs', '/workers/admin/worker.mjs', '/.git/config']) {
    await check(path, async () => {
    if(expectAccess)return checkAccess(path);
    const response = await request(path);
    assert.equal(response.status, 404, path + ': internal path must be unavailable (404), got ' + response.status);
    await response.body?.cancel();
    console.log('PASS internal file unavailable: ' + path);
    });
  }
}
const summary = (expectAccess ? 'Production anonymous Access restriction' : live ? 'Production read-only HTTP' : 'Candidate source') + ' checks passed: ' + checked + '; failed: ' + failures.length + '. '+(expectAccess?'Protected content and intake state were not inspected.':'Expected intake enabled: '+intakeEnabled+'.')+' This does not certify visual layout or signed-in CRM behavior.';
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n' + failures.map(message => '- ' + message).join('\n') + '\n');

if (failures.length) throw new AggregateError(failures.map(message => new Error(message)), 'Release preflight failed');
