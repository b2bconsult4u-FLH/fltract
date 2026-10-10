import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const form = readFileSync(new URL('../../../contact/index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../../workers/intake/worker.mjs', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../intake-hook.mjs', import.meta.url), 'utf8');

test('public intake endpoint matches Worker submission route', () => {
  const endpoint = form.match(/fetch\("(https:\/\/[^"]+)"\s*,\s*\{/);
  assert.ok(endpoint, 'public form must post to a configured endpoint');
  assert.equal(new URL(endpoint[1]).pathname, '/submit');
  assert.match(worker, /url\.pathname\s*!==\s*"\/submit"/);
});

test('county module runs only after durable inquiry insert', () => {
  const saved = worker.indexOf('inquiryId =');
  const hookCall = worker.indexOf('await afterInquirySaved({ inquiryId, input, env, ctx })');
  assert.ok(saved > 0 && hookCall > saved, 'optional module must follow persisted inquiry');
  assert.match(worker, /async fetch\(request, env, ctx\)/);
  assert.match(worker, /try\s*\{\s*await afterInquirySaved/);
});

test('property research is disabled by default and does not block core intake', () => {
  assert.match(hook, /env\.PROPERTY_RECORDS_ENABLED !== 'true'/);
  assert.match(hook, /if \(!env\.PROPERTY_DB && !repository\)/);
  assert.match(worker, /catch \(error\) \{\s*console\.error\('Optional property-record intake hook failed:/);
});
