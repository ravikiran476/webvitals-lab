// A forward proxy for the audit browser. Checking the URL before Lighthouse starts is not
// enough: the page can redirect, load subresources, open WebSockets or have its DNS answer
// change between the check and the load (DNS rebinding). Chrome is started with this proxy, so
// every connection goes through it; the proxy resolves each host itself, refuses private and
// reserved addresses, and connects to exactly the address it checked.
import http from 'node:http';
import net from 'node:net';
import { resolvePublicAddress } from './urlGuard.js';

const HOP_BY_HOP = new Set(['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade']);

/** Splits "host:port" and "[v6]:port" from a CONNECT request. */
function splitAuthority(authority) {
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(authority);
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

/**
 * Starts the proxy on 127.0.0.1 with a random port. `resolve(host)` returns the address to
 * connect to, or throws to block; tests can swap it.
 */
export async function startEgressProxy({ resolve = (host) => resolvePublicAddress(host) } = {}) {
  const blocked = [];
  const sockets = new Set();

  const block = (host, err) => {
    if (blocked.length < 50) blocked.push({ host, reason: err.message });
  };

  const server = http.createServer(async (req, res) => {
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    let addr;
    try {
      addr = await resolve(target.hostname);
    } catch (err) {
      block(target.hostname, err);
      res.writeHead(403, { 'content-type': 'text/plain' }).end(`Blocked by WebVitals Lab: ${err.message}`);
      return;
    }
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(name)) headers[name] = value;
    const upstream = http.request(
      { host: addr.address, family: addr.family, port: Number(target.port) || 80, method: req.method, path: `${target.pathname}${target.search}`, headers, setHost: false },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.statusMessage, up.rawHeaders);
        up.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });

  // HTTPS and WebSockets arrive as CONNECT tunnels.
  server.on('connect', async (req, client, head) => {
    client.on('error', () => client.destroy());
    const authority = splitAuthority(req.url ?? '');
    if (!authority) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    let addr;
    try {
      addr = await resolve(authority.host);
    } catch (err) {
      block(authority.host, err);
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host: addr.address, port: authority.port, family: addr.family }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy());
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    /** Hosts the page tried to reach that were refused (at most 50). */
    blocked,
    close: () =>
      new Promise((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
