import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';

// Read-only release checks. No credentials, submissions, email or database writes.
const routes = ['/', '/regions/', '/brevard/', '/indian-river/', '/st-lucie/', '/martin/', '/okeechobee/', '/tract-desk/', '/landowner-guides/', '/contact/'];
const live = process.argv.includes('--live');
assert.ok(process.argv.slice(2).every(arg => arg === '--live'), 'Only --live is supported; the production target is fixed.');
const base = 'https://fltract.com';
async function read(path) {
  if (!live) return readFile(new URL('..' + (path.endsWith('/') ? path + 'index.html' : path), import.meta.url), 'utf8');
  const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, path + ': HTTP ' + response.status);
  return response.text();
}
let checked = 0;
const failures = [];
async function check(name, action) {
  try { await action(); checked++; }
  catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
}
for (const path of routes) {
  await check(path, async () => {
  const html = await read(path);
  const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i)?.[1];
  assert.ok(footer, path + ': footer missing');
  assert.match(footer, /FARLESS REAL ESTATE REFERRALS LLC\s*\|\s*CQ1034069/, path + ': exact brokerage identification missing');
  assert.match(footer, /SL3654181/, path + ': associate license missing');
  assert.ok(html.includes('href="' + base + path + '"'), path + ': canonical mismatch');
  assert.ok(html.includes('href="/assets/css/site.css"'), path + ': shared CSS missing');
  if (path === '/contact/') {
    assert.match(html, /const\s+PUBLIC_SUBMISSIONS_ENABLED\s*=\s*false\s*;/, 'Release checks require public intake to remain disabled');
    assert.match(html, /fltract-intake-5a25\.b2bconsult4u\.workers\.dev\/submit/, 'Unexpected intake destination');
  }
  console.log('PASS ' + path + ': disclosure, canonical and asset reference');
  });
}
for (const [path, pattern] of [
  ['/assets/css/site.css', /\.license-block/],
  ['/assets/js/property-records.js', /propertyRecords/],
  ['/robots.txt', /Sitemap:/i],
  ['/sitemap.xml', /<urlset/],
]) {
  await check(path, async () => {
    assert.match(await read(path), pattern, path + ': expected asset contents missing');
    console.log('PASS ' + path);
  });
}
if (live) {
  for (const path of ['/package.json', '/wrangler.jsonc', '/workers/intake/worker.mjs', '/workers/admin/worker.mjs', '/.git/config']) {
    await check(path, async () => {
    const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 404, path + ': internal path must be unavailable (404), got ' + response.status);
    await response.body?.cancel();
    console.log('PASS internal file unavailable: ' + path);
    });
  }
}
const summary = (live ? 'Production read-only HTTP' : 'Candidate source') + ' checks passed: ' + checked + '; failed: ' + failures.length + '. Public submissions remain disabled. This does not certify visual layout or signed-in CRM behavior.';
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n');

if (failures.length) throw new AggregateError(failures.map(message => new Error(message)), 'Release preflight failed');
