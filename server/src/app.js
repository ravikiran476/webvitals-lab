import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './httpError.js';
import { validateTarget } from './urlGuard.js';
import { auditEngine, fieldDataEnabled, runAudit } from './engine.js';
import { summarize } from './summarize.js';
import * as store from './store.js';

const MAX_QUEUE = Number(process.env.MAX_QUEUE) || 3;

export const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '16kb' }));

// Local Lighthouse is CPU-heavy and parallel runs skew each other's timings, so audits run one at a time.
let queue = Promise.resolve();
let pending = 0;
function enqueue(task) {
  if (pending >= MAX_QUEUE) throw new HttpError(429, 'Too many audits queued, try again shortly');
  pending++;
  const result = queue.then(task).finally(() => pending--);
  queue = result.catch(() => {});
  return result;
}

const asyncRoute = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  pending,
  engine: auditEngine(),
  fieldData: fieldDataEnabled(),
  storage: store.storageInfo(),
}));

app.post('/api/runs', asyncRoute(async (req, res) => {
  const { url, formFactor = 'mobile', label = '', authorized } = req.body || {};
  if (authorized !== true) {
    throw new HttpError(400, 'Confirm you are authorized to test this URL');
  }
  if (!['mobile', 'desktop'].includes(formFactor)) {
    throw new HttpError(400, 'formFactor must be "mobile" or "desktop"');
  }
  const target = await validateTarget(url);

  const run = await enqueue(async () => {
    const started = Date.now();
    const { lhr, field, html } = await runAudit(target, { formFactor });
    return store.saveRun({
      id: crypto.randomUUID(),
      url: target,
      formFactor,
      label: String(label).slice(0, 80),
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      engine: auditEngine(),
      field,
      ...summarize(lhr),
    }, html);
  });

  res.status(201).json(run);
}));

app.get('/api/runs', asyncRoute(async (req, res) => {
  res.json(await store.listRuns({ url: req.query.url }));
}));

app.get('/api/runs/:id', asyncRoute(async (req, res) => {
  const run = await store.getRun(req.params.id);
  if (!run) throw new HttpError(404, 'Run not found');
  res.json(run);
}));

app.patch('/api/runs/:id', asyncRoute(async (req, res) => {
  const run = await store.updateRun(req.params.id, { label: String(req.body?.label ?? '').slice(0, 80) });
  if (!run) throw new HttpError(404, 'Run not found');
  res.json(run);
}));

app.delete('/api/runs/:id', asyncRoute(async (req, res) => {
  if (!(await store.deleteRun(req.params.id))) throw new HttpError(404, 'Run not found');
  res.status(204).end();
}));

app.get('/api/runs/:id/report', (req, res, next) => {
  const file = store.reportPath(req.params.id);
  if (!file || !fs.existsSync(file)) return next(new HttpError(404, 'Report not found'));
  // The Lighthouse report is self-contained HTML; keep it from reaching back to our API.
  res.set('Content-Security-Policy', "default-src 'self' 'unsafe-inline' data: blob: https:; connect-src 'none'");
  res.sendFile(file);
});

// Serve the built client for `npm start`. On Vercel the CDN serves it instead.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (!process.env.VERCEL && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal error' });
});
