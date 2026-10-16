import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from '@upstash/redis';

const isSafeId = (id) => /^[a-z0-9-]+$/i.test(id);

// ---------- Upstash Redis (deployed) ----------
// Each run is stored at run:<id>; the "runs" sorted set orders ids by creation time.

function redisDriver(redis) {
  const key = (id) => `run:${id}`;
  return {
    kind: 'redis',
    persistent: true,
    storesReports: false, // full HTML reports are too large to keep in Redis
    async list() {
      const ids = await redis.zrange('runs', 0, -1, { rev: true });
      if (!ids.length) return [];
      return (await redis.mget(...ids.map(key))).filter(Boolean);
    },
    get: async (id) => (await redis.get(key(id))) || null,
    async save(run) {
      await redis.set(key(run.id), run);
      await redis.zadd('runs', { score: Date.parse(run.createdAt), member: run.id });
    },
    async update(id, patch) {
      const run = await redis.get(key(id));
      if (!run) return null;
      Object.assign(run, patch);
      await redis.set(key(id), run);
      return run;
    },
    async remove(id) {
      const removed = await redis.del(key(id));
      await redis.zrem('runs', id);
      return removed > 0;
    },
    reportPath: () => null,
  };
}

// ---------- JSON file (local development) ----------

function fileDriver(dataDir, persistent) {
  const runsFile = path.join(dataDir, 'runs.json');
  const reportsDir = path.join(dataDir, 'reports');
  let runs = null;
  let writing = Promise.resolve();

  async function load() {
    if (runs) return runs;
    await fs.mkdir(reportsDir, { recursive: true });
    try {
      runs = JSON.parse(await fs.readFile(runsFile, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      runs = [];
    }
    return runs;
  }

  function persist() {
    // Serialize writes and replace the file atomically so a crash can't truncate it.
    writing = writing.then(async () => {
      const tmp = `${runsFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(runs, null, 2));
      await fs.rename(tmp, runsFile);
    });
    return writing;
  }

  return {
    kind: 'file',
    persistent,
    storesReports: true,
    async list() {
      return [...(await load())].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get: async (id) => (await load()).find((r) => r.id === id) || null,
    async save(run, html) {
      await load();
      if (html) await fs.writeFile(path.join(reportsDir, `${run.id}.html`), html);
      runs.push(run);
      await persist();
    },
    async update(id, patch) {
      const run = (await load()).find((r) => r.id === id);
      if (!run) return null;
      Object.assign(run, patch);
      await persist();
      return run;
    },
    async remove(id) {
      await load();
      const idx = runs.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      runs.splice(idx, 1);
      await persist();
      if (isSafeId(id)) await fs.rm(path.join(reportsDir, `${id}.html`), { force: true });
      return true;
    },
    reportPath: (id) => (isSafeId(id) ? path.join(reportsDir, `${id}.html`) : null),
  };
}

function createDriver() {
  // The Vercel Marketplace Upstash integration sets KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return redisDriver(new Redis({ url, token }));

  if (process.env.VERCEL) {
    // Serverless file systems are read-only except /tmp, which is wiped between instances.
    return fileDriver(path.join(os.tmpdir(), 'webvitals-lab'), false);
  }
  const dataDir = process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
  return fileDriver(dataDir, true);
}

const driver = createDriver();

export const storageInfo = () => ({ kind: driver.kind, persistent: driver.persistent });

export async function listRuns({ url } = {}) {
  const all = await driver.list();
  return url ? all.filter((r) => r.url === url) : all;
}

export const getRun = (id) => driver.get(id);

export async function saveRun(run, reportHtml) {
  run.reportAvailable = Boolean(reportHtml) && driver.storesReports;
  await driver.save(run, run.reportAvailable ? reportHtml : null);
  return run;
}

export const updateRun = (id, patch) => driver.update(id, patch);
export const deleteRun = (id) => driver.remove(id);
export const reportPath = (id) => driver.reportPath(id);
