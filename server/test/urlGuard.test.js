import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget } from '../src/urlGuard.js';

const rejects = (url, re) => assert.rejects(validateTarget(url), re);

test('rejects non-http protocols', () => rejects('file:///etc/passwd', /http and https/));
test('rejects malformed input', () => rejects('not a url', /valid absolute URL/));
test('rejects embedded credentials', () => rejects('https://user:pw@example.com', /credentials/));
test('rejects localhost names', () => rejects('http://localhost:3000', /Local/));
test('rejects loopback IPs', () => rejects('http://127.0.0.1', /private/));
test('rejects private IPv4', () => rejects('http://192.168.1.10', /private/));
test('rejects cloud metadata address', () => rejects('http://169.254.169.254/latest', /private/));
test('rejects IPv6 loopback', () => rejects('http://[::1]/', /private/));
test('rejects IPv4-mapped IPv6 loopback', () => rejects('http://[::ffff:127.0.0.1]/', /private/));

test('accepts a public IP', async () => {
  assert.equal(await validateTarget('https://1.1.1.1/'), 'https://1.1.1.1/');
});

test('enforces ALLOWED_HOSTS', async () => {
  process.env.ALLOWED_HOSTS = 'example.org';
  try {
    await rejects('https://1.1.1.1/', /ALLOWED_HOSTS/);
  } finally {
    delete process.env.ALLOWED_HOSTS;
  }
});
