import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunStore, fileDriver, redisDriver, runSummary } from '../src/store.js';

const run = (i, url = 'https://a.example/') => ({
  id: `r${i}`,
  url,
  formFactor: 'mobile',
  label: '',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  scores: { performance: 90 },
  metrics: { lcp: { value: 1000 + i, score: 1, display: '1 s' } },
  totals: { bytes: 1, requests: 1 },
  findings: [{ id: 'big', description: 'x'.repeat(5000) }],
  heaviestRequests: [{ url: 'u' }],
  resourceSummary: [],
});

test('summaries leave out findings and request lists', () => {
  const s = runSummary(run(1));
  assert.equal(s.findings, undefined);
  assert.equal(s.heaviestRequests, undefined);
  assert.deepEqual(s.metrics, { lcp: { value: 1001 } });
  assert.equal(s.scores.performance, 90);
});

test('file store lists newest first, limits, filters and keeps at most maxRuns', async () => {
  const store = createRunStore(fileDriver(mkdtempSync(join(tmpdir(), 'wvl-')), true), { maxRuns: 3 });
  for (let i = 1; i <= 5; i++) await store.saveRun(run(i, i % 2 ? 'https://a.example/' : 'https://b.example/'));
  const { runs, total } = await store.listRuns({ limit: 2 });
  assert.equal(total, 3);
  assert.deepEqual(runs.map((r) => r.id), ['r5', 'r4']);
  assert.equal(runs[0].findings, undefined);
  assert.equal(await store.getRun('r1'), null); // pruned
  assert.equal((await store.getRun('r5')).findings.length, 1);
  assert.deepEqual((await store.listRuns({ url: 'https://a.example/' })).runs.map((r) => r.id), ['r5', 'r3']);
});

test('redis store reads summaries, not full runs, and prunes', async () => {
  const redis = fakeRedis();
  const store = createRunStore(redisDriver(redis), { maxRuns: 2 });
  for (let i = 1; i <= 3; i++) await store.saveRun(run(i));
  redis.reads.length = 0;
  const { runs, total } = await store.listRuns();
  assert.equal(total, 2);
  assert.deepEqual(runs.map((r) => r.id), ['r3', 'r2']);
  assert.ok(redis.reads.every((k) => !k.startsWith('run:')), `full runs read: ${redis.reads}`);
  assert.equal(await store.getRun('r1'), null);

  await store.updateRun('r3', { label: 'after' });
  assert.equal((await store.listRuns()).runs[0].label, 'after');
});

test('redis store builds a missing summary for runs saved by older versions', async () => {
  const redis = fakeRedis();
  const old = run(7);
  await redis.set('run:r7', old);
  await redis.zadd('runs', { score: Date.parse(old.createdAt), member: 'r7' });
  const { runs } = await createRunStore(redisDriver(redis)).listRuns();
  assert.equal(runs[0].id, 'r7');
  assert.equal(runs[0].findings, undefined);
  assert.ok(await redis.get('runsum:r7'));
});

function fakeRedis() {
  const kv = new Map();
  const zset = new Map();
  const reads = [];
  const clone = (v) => (v == null ? null : structuredClone(v));
  return {
    reads,
    async get(k) {
      reads.push(k);
      return clone(kv.get(k));
    },
    async mget(...keys) {
      reads.push(...keys);
      return keys.map((k) => clone(kv.get(k)));
    },
    async set(k, v) {
      kv.set(k, clone(v));
    },
    async del(...keys) {
      return keys.filter((k) => kv.delete(k)).length;
    },
    async zadd(_k, { score, member }) {
      zset.set(member, score);
    },
    async zrem(_k, member) {
      zset.delete(member);
    },
    async zcard() {
      return zset.size;
    },
    async zrange(_k, start, stop, opts = {}) {
      const ids = [...zset.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
      if (opts.rev) ids.reverse();
      return ids.slice(start, stop === -1 ? undefined : stop + 1);
    },
  };
}
