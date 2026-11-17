import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedIPv4, isBlockedAddress, resolvePublicAddress, validateTarget } from '../src/urlGuard.js';

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

test('rejects private IPv4 hidden in NAT64 and 6to4 addresses', async () => {
  await rejects('http://[64:ff9b::7f00:1]/', /private/);
  await rejects('http://[64:ff9b::a9fe:a9fe]/', /private/); // 169.254.169.254
  await rejects('http://[2002:7f00:1::]/', /private/);
  await rejects('http://[2002:c0a8:10a::1]/', /private/); // 192.168.1.10
  assert.equal(embeddedIPv4('64:ff9b::8.8.8.8'), '8.8.8.8');
  assert.equal(embeddedIPv4('2606:4700::1111'), undefined);
  assert.equal(isBlockedAddress('64:ff9b::808:808'), false); // public IPv4 through NAT64 is fine
});

test('resolvePublicAddress returns the address it checked', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  assert.deepEqual(await resolvePublicAddress('example.test', lookup), { address: '93.184.216.34', family: 4 });
  const rebinding = async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(resolvePublicAddress('example.test', rebinding), /private or reserved address \(127\.0\.0\.1\)/);
});

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
