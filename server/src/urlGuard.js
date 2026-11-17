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
  ['100::', 64], // discard-only
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8],
]) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

/** The 8 groups of an IPv6 address as numbers, expanding "::" and a trailing dotted IPv4. */
function ipv6Groups(address) {
  let text = address.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? Array(8 - left.length - right.length).fill('0') : [];
  return [...left, ...fill, ...right].map((g) => parseInt(g, 16));
}

const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * IPv4 addresses carried inside IPv6 ones. A host that resolves to 64:ff9b::7f00:1 (NAT64)
 * or 2002:7f00:1:: (6to4) reaches 127.0.0.1, so the embedded address is checked as well.
 */
export function embeddedIPv4(address) {
  if (!net.isIPv6(address)) return undefined;
  const g = ipv6Groups(address);
  if (g.length !== 8 || g.some(Number.isNaN)) return undefined;
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return g[6] || g[7] ? v4(g[6], g[7]) : undefined; // ::ffff:a.b.c.d, ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4(g[6], g[7]); // 64:ff9b::/96 NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return v4(g[6], g[7]); // 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 2002::/16 6to4
  return undefined;
}

export function isBlockedAddress(address) {
  const inner = embeddedIPv4(address);
  if (inner && blocked.check(inner, 'ipv4')) return true;
  return blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/**
 * Resolves a hostname and returns one public address to connect to, or throws. Connecting to
 * the address that was checked (not resolving again) is what defeats DNS rebinding.
 */
export async function resolvePublicAddress(host, lookup = dns.lookup) {
  const name = host.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(name) ? [{ address: name, family: net.isIPv6(name) ? 6 : 4 }] : await lookup(name, { all: true });
  if (!addresses.length) throw new Error(`Could not resolve host "${name}"`);
  const bad = addresses.find((a) => isBlockedAddress(a.address));
  if (bad) throw new Error(`"${name}" resolves to a private or reserved address (${bad.address})`);
  return addresses[0];
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
