import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../contact/index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../workers/intake/worker.mjs', import.meta.url), 'utf8');

test('intake shows a durable thank-you view, not an automatically reset form', () => {
  const success = page.slice(page.indexOf('const emailState='), page.indexOf('}catch(err)'));
  assert.match(success, /form\.hidden=true/);
  assert.match(success, /successModal\.hidden=false/);
  assert.doesNotMatch(success, /form\.reset\(\)/);
  assert.match(page, /Would you like to submit another inquiry\?/);
  assert.match(page, /Submit Another Inquiry/);
});

test('only explicit second-inquiry action resets form and returns to intake', () => {
  const start = page.indexOf('successAnother.addEventListener');
  const end = page.indexOf('// Keep successful submission confirmation', start);
  const section = page.slice(start, end);
  assert.match(section, /form\.hidden=false/);
  assert.match(section, /form\.reset\(\)/);
});

test('internal receipt ID stays server-side and email status comes from server response', () => {
  assert.match(worker, /inquiry_id:\s*inquiryId/);
  assert.match(worker, /acknowledgment_email:\s*acknowledgmentEmailStatus/);
  assert.doesNotMatch(page, /success-reference|Please retain your reference number|Inquiry reference:/);
  assert.match(page, /result\.acknowledgment_email/);
  assert.match(page, /could not confirm delivery/);
});

test('in-flight double submissions are prevented', () => {
  assert.match(page, /if\(submitting\) return/);
  assert.match(page, /submitting=true/);
  assert.match(page, /finally\{\s*submitting=false/);
});
