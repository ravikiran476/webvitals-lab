import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/summarize.js';

const lhr = {
  lighthouseVersion: '12.0.0',
  finalDisplayedUrl: 'https://example.com/',
  fetchTime: '2026-01-01T00:00:00.000Z',
  categories: {
    performance: {
      score: 0.62,
      auditRefs: [
        { id: 'largest-contentful-paint', group: 'metrics' },
        { id: 'modern-image-formats', group: 'diagnostics' },
        { id: 'render-blocking-resources', group: 'diagnostics' },
        { id: 'dom-size', group: 'diagnostics' },
        { id: 'cache-insight', group: 'hidden' },
      ],
    },
    seo: { score: 1, auditRefs: [] },
  },
  audits: {
    'largest-contentful-paint': { id: 'largest-contentful-paint', numericValue: 3200, score: 0.4, displayValue: '3.2 s' },
    'cumulative-layout-shift': { id: 'cumulative-layout-shift', numericValue: 0.02, score: 1 },
    'modern-image-formats': {
      id: 'modern-image-formats', title: 'Serve images in modern formats', score: 0.3, scoreDisplayMode: 'metricSavings',
      details: { type: 'opportunity', overallSavingsMs: 900, overallSavingsBytes: 120000, items: [{ url: 'https://example.com/hero.png', totalBytes: 200000, wastedBytes: 120000 }] },
    },
    'render-blocking-resources': {
      id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', score: 0.5, scoreDisplayMode: 'metricSavings',
      details: { type: 'opportunity', overallSavingsMs: 300, items: [] },
    },
    'cache-insight': { id: 'cache-insight', title: 'Use efficient cache lifetimes', score: 0, scoreDisplayMode: 'metricSavings' },
    'dom-size': { id: 'dom-size', title: 'Avoid an excessive DOM size', score: 0.95, scoreDisplayMode: 'numeric' },
    'resource-summary': {
      details: { items: [{ resourceType: 'total', transferSize: 500 }, { resourceType: 'image', label: 'Image', requestCount: 3, transferSize: 300 }] },
    },
    'network-requests': {
      details: { items: [{ url: 'a.js', resourceType: 'Script', transferSize: 10 }, { url: 'b.png', resourceType: 'Image', transferSize: 50 }] },
    },
  },
};

test('extracts scores and metrics', () => {
  const s = summarize(lhr);
  assert.equal(s.scores.performance, 62);
  assert.equal(s.metrics.lcp.value, 3200);
  assert.equal(s.metrics.cls.value, 0.02);
  assert.equal(s.metrics.tbt, null);
});

test('ranks failing findings by savings and categorizes them', () => {
  const s = summarize(lhr);
  assert.deepEqual(s.findings.map((f) => f.id), ['modern-image-formats', 'render-blocking-resources']);
  assert.equal(s.findings[0].category, 'images');
  assert.equal(s.findings[1].category, 'resources');
  assert.equal(s.findings[0].items[0].wastedBytes, 120000);
});

test('summarizes resources without the total row, heaviest first', () => {
  const s = summarize(lhr);
  assert.equal(s.resourceSummary.length, 1);
  assert.deepEqual(s.heaviestRequests.map((r) => r.url), ['b.png', 'a.js']);
});
