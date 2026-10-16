import test from 'node:test';
import assert from 'node:assert/strict';
import { runPageSpeed } from '../src/psi.js';

const realFetch = globalThis.fetch;

function mockFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url));
    return { ok: status < 400, status, json: async () => body };
  };
  return calls;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PSI_API_KEY;
});

test('requests all categories with strategy and key', async () => {
  process.env.PSI_API_KEY = 'k123';
  const calls = mockFetch(200, { lighthouseResult: { audits: {} } });
  await runPageSpeed('https://example.com/', { formFactor: 'desktop' });
  const params = calls[0].searchParams;
  assert.equal(params.get('strategy'), 'DESKTOP');
  assert.equal(params.get('key'), 'k123');
  assert.deepEqual(params.getAll('category'), ['performance', 'accessibility', 'best-practices', 'seo']);
});

test('parses URL-level field data and rescales CLS', async () => {
  mockFetch(200, {
    lighthouseResult: { audits: {} },
    loadingExperience: {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 7 },
        INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
      },
    },
  });
  const { field } = await runPageSpeed('https://example.com/');
  assert.equal(field.available, true);
  assert.equal(field.scope, 'url');
  assert.deepEqual(field.metrics, { lcp: 2100, cls: 0.07, inp: 180, fcp: null, ttfb: null });
});

test('falls back to origin field data', async () => {
  mockFetch(200, {
    lighthouseResult: { audits: {} },
    loadingExperience: { id: 'https://example.com/' },
    originLoadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 250 } } },
  });
  const { field } = await runPageSpeed('https://example.com/');
  assert.equal(field.scope, 'origin');
  assert.equal(field.metrics.inp, 250);
});

test('reports missing field data', async () => {
  mockFetch(200, { lighthouseResult: { audits: {} } });
  const { field } = await runPageSpeed('https://example.com/');
  assert.equal(field.available, false);
});

test('surfaces quota errors as 429 with a key hint', async () => {
  mockFetch(429, { error: { message: 'Quota exceeded' } });
  await assert.rejects(runPageSpeed('https://example.com/'), (err) => err.status === 429 && /PSI_API_KEY/.test(err.message));
});

test('surfaces page load failures', async () => {
  mockFetch(200, { lighthouseResult: { runtimeError: { message: 'DNS failure' } } });
  await assert.rejects(runPageSpeed('https://example.com/'), /DNS failure/);
});
