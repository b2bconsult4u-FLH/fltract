import test from 'node:test';
import assert from 'node:assert/strict';
import intake from '../../../workers/intake/worker.mjs';

test('health status accurately reports public intake availability', async () => {
  const env = { DB: {} };
  const health = await intake.fetch(new Request('https://intake.example/'), env);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.public_submissions_enabled, true);
  const invalidMethod = await intake.fetch(new Request('https://intake.example/submit', { method: 'GET' }), env);
  assert.equal(invalidMethod.status, 405);
});
