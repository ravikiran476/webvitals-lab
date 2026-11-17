import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { startEgressProxy } from '../src/egressProxy.js';

// A stand-in for an internal service, reachable only on this machine.
async function internalService() {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.end('internal');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, port: server.address().port, hits: () => hits, close: () => server.close() };
}

/** GET through the proxy, the way a browser sends plain HTTP to a proxy. */
function viaProxy(proxyUrl, target) {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    http
      .get({ host: proxy.hostname, port: proxy.port, path: target, headers: { host: new URL(target).host } }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

/** Opens a CONNECT tunnel and returns the proxy's status line. */
function connectVia(proxyUrl, authority) {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port), proxy.hostname, () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.once('data', (d) => {
      resolve(d.toString().split('\r\n')[0]);
      socket.destroy();
    });
    socket.on('error', reject);
  });
}

test('blocks private addresses over HTTP and CONNECT, and records them', async () => {
  const svc = await internalService();
  const proxy = await startEgressProxy();
  try {
    const res = await viaProxy(proxy.url, svc.url);
    assert.equal(res.status, 403);
    assert.match(res.body, /private or reserved/);
    assert.match(await connectVia(proxy.url, `127.0.0.1:${svc.port}`), /403/);
    assert.match(await connectVia(proxy.url, '[::1]:443'), /403/);
    assert.equal(svc.hits(), 0);
    assert.deepEqual([...new Set(proxy.blocked.map((b) => b.host))], ['127.0.0.1', '::1']);
  } finally {
    await proxy.close();
    svc.close();
  }
});

test('forwards allowed requests to the exact address that was checked', async () => {
  const svc = await internalService();
  // The resolver decides where "public.test" goes; the proxy must not resolve it again.
  const proxy = await startEgressProxy({ resolve: async (host) => {
    if (host !== 'public.test') throw new Error('unexpected host');
    return { address: '127.0.0.1', family: 4 };
  } });
  try {
    const res = await viaProxy(proxy.url, `http://public.test:${svc.port}/page`);
    assert.deepEqual(res, { status: 200, body: 'internal' });
    assert.match(await connectVia(proxy.url, `public.test:${svc.port}`), /200 Connection Established/);
    assert.equal(proxy.blocked.length, 0);
  } finally {
    await proxy.close();
    svc.close();
  }
});
