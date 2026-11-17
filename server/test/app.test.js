import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// node --test runs each file in its own process, so these settings only affect this file.
process.env.WEBVITALS_TOKEN = 's3cret';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wvl-app-'));
const { app } = await import('../src/app.js');

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = (method, path, { token, body } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test('audits, renames and deletes need the token', async () => {
  const audit = { url: 'not a url', authorized: true };
  const anonymous = await call('POST', '/api/runs', { body: audit });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: 'API token required', auth: true });
  assert.equal((await call('POST', '/api/runs', { body: audit, token: 'wrong' })).status, 401);
  // With the token the request gets past auth and fails URL validation instead.
  assert.equal((await call('POST', '/api/runs', { body: audit, token: 's3cret' })).status, 400);
  assert.equal((await call('PATCH', '/api/runs/x', { body: { label: 'x' } })).status, 401);
  assert.equal((await call('DELETE', '/api/runs/x')).status, 401);
  assert.equal((await call('DELETE', '/api/runs/x', { token: 's3cret' })).status, 404);
});

test('reading history needs no token and reports the total', async () => {
  const res = await call('GET', '/api/runs');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
  assert.equal(res.headers.get('x-total-count'), '0');
  assert.equal((await (await call('GET', '/api/health')).json()).auth, true);
});
