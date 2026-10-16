import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from './httpError.js';

// Networks Lighthouse must never be pointed at (SSRF protection).
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

function isBlockedAddress(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

function allowedHosts() {
  return (process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validates that a URL is a public http(s) target and, if ALLOWED_HOSTS is set,
 * that its host is on the allowlist. Returns the normalized URL string.
 */
export async function validateTarget(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new HttpError(400, 'Enter a valid absolute URL, e.g. https://example.com');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, 'Only http and https URLs can be audited');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'URLs with embedded credentials are not allowed');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new HttpError(400, 'Local and internal hosts cannot be audited');
  }

  const allowlist = allowedHosts();
  if (allowlist.length && !allowlist.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new HttpError(403, `Host "${host}" is not in the ALLOWED_HOSTS list for this server`);
  }

  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch {
    throw new HttpError(400, `Could not resolve host "${host}"`);
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new HttpError(400, 'URL resolves to a private or reserved network address');
  }

  return url.toString();
}
