import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from '@upstash/redis';

const isSafeId = (id) => /^[a-z0-9-]+$/i.test(id);

/**
 * What the history table, trend chart and "vs previous" deltas need. Findings, resource
 * lists and request lists, which make up most of a run, stay in the full record.
 */
export function runSummary(run) {
  const { findings, resourceSummary, heaviestRequests, warnings, field, lcpElement, ...rest } = run;
  return { ...rest, metrics: Object.fromEntries(Object.entries(run.metrics ?? {}).map(([k, m]) => [k, m ? { value: m.value } : null])) };
}

// ---------- Upstash Redis (deployed) ----------
// Each run is stored at run:<id> and its summary at runsum:<id>; the "runs" sorted set
// orders ids by creation time.

export function redisDriver(redis) {
  const key = (id) => `run:${id}`;
  const sumKey = (id) => `runsum:${id}`;

  async function summaries(ids) {
    if (!ids.length) return [];
    const found = await redis.mget(...ids.map(sumKey));
    // Runs saved before summaries existed: build the summary from the full run once.
    const missing = ids.filter((_, i) => !found[i]);
    const full = missing.length ? await redis.mget(...missing.map(key)) : [];
    const built = new Map(full.filter(Boolean).map((r) => [r.id, runSummary(r)]));
    for (const s of built.values()) await redis.set(sumKey(s.id), s);
    return ids.map((id, i) => found[i] ?? built.get(id)).filter(Boolean);
  }

  return {
    kind: 'redis',
    persistent: true,
    storesReports: false, // full HTML reports are too large to keep in Redis
    async list({ url, limit }) {
      const total = await redis.zcard('runs');
      if (!url) return { runs: await summaries(await redis.zrange('runs', 0, limit - 1, { rev: true })), total };
      // Filtering by URL reads every summary (small, and bounded by MAX_RUNS).
      const all = (await summaries(await redis.zrange('runs', 0, -1, { rev: true }))).filter((r) => r.url === url);
      return { runs: all.slice(0, limit), total: all.length };
    },
    get: async (id) => (await redis.get(key(id))) || null,
    async save(run) {
      await redis.set(key(run.id), run);
      await redis.set(sumKey(run.id), runSummary(run));
      await redis.zadd('runs', { score: Date.parse(run.createdAt), member: run.id });
    },
    async update(id, patch) {
      const run = await redis.get(key(id));
      if (!run) return null;
      Object.assign(run, patch);
      await redis.set(key(id), run);
      await redis.set(sumKey(id), runSummary(run));
      return run;
    },
    async remove(id) {
      const removed = await redis.del(key(id), sumKey(id));
      await redis.zrem('runs', id);
      return removed > 0;
    },
    async prune(maxRuns) {
      const excess = (await redis.zcard('runs')) - maxRuns;
      if (excess <= 0) return 0;
      const oldest = await redis.zrange('runs', 0, excess - 1);
      for (const id of oldest) await this.remove(id);
      return oldest.length;
    },
    reportPath: () => null,
  };
}

// ---------- JSON file (local development) ----------

export function fileDriver(dataDir, persistent) {
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

  const newestFirst = (list) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    kind: 'file',
    persistent,
    storesReports: true,
    async list({ url, limit }) {
      const matching = newestFirst(await load()).filter((r) => !url || r.url === url);
      return { runs: matching.slice(0, limit).map(runSummary), total: matching.length };
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
    async prune(maxRuns) {
      const old = newestFirst(await load()).slice(maxRuns);
      for (const r of old) await this.remove(r.id);
      return old.length;
    },
    reportPath: (id) => (isSafeId(id) ? path.join(reportsDir, `${id}.html`) : null),
  };
}

/** Run history on top of a driver. Keeps at most `maxRuns` runs, dropping the oldest. */
export function createRunStore(driver, { maxRuns = 500 } = {}) {
  return {
    storageInfo: () => ({ kind: driver.kind, persistent: driver.persistent }),
    listRuns: ({ url, limit = 200 } = {}) => driver.list({ url, limit }),
    getRun: (id) => driver.get(id),
    async saveRun(run, reportHtml) {
      run.reportAvailable = Boolean(reportHtml) && driver.storesReports;
      await driver.save(run, run.reportAvailable ? reportHtml : null);
      await driver.prune(maxRuns);
      return run;
    },
    updateRun: (id, patch) => driver.update(id, patch),
    deleteRun: (id) => driver.remove(id),
    reportPath: (id) => driver.reportPath(id),
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

const store = createRunStore(createDriver(), { maxRuns: Number(process.env.MAX_RUNS) || 500 });

export const { storageInfo, listRuns, getRun, saveRun, updateRun, deleteRun, reportPath } = store;
