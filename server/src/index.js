import { app } from './app.js';
import { auditEngine } from './engine.js';
import { storageInfo } from './store.js';

const PORT = Number(process.env.PORT) || 4000;
// Local by default: the server drives a real browser, so it should not be reachable from the
// network unless HOST says so (and then set WEBVITALS_TOKEN).
const hosts = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];

const listening = await Promise.all(
  hosts.map(
    (host) =>
      new Promise((resolve, reject) => {
        const server = app.listen(PORT, host);
        server.once('listening', () => resolve(host));
        server.once('error', (err) => {
          if (host === '::1' && (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT')) resolve(null);
          else reject(err);
        });
      }),
  ),
);

console.log(`WebVitals Lab API listening on http://${hosts.length > 1 ? 'localhost' : process.env.HOST}:${PORT} (${listening.filter(Boolean).join(', ')})`);
console.log(`Audit engine: ${auditEngine()} · storage: ${storageInfo().kind}`);
if (process.env.ALLOWED_HOSTS) console.log(`Restricted to hosts: ${process.env.ALLOWED_HOSTS}`);
if (process.env.WEBVITALS_TOKEN) console.log('Audits and changes require WEBVITALS_TOKEN');
