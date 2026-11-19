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

// Shapes taken from a real Lighthouse 13.6 run.
const lhr13 = {
  lighthouseVersion: '13.6.0',
  finalDisplayedUrl: 'https://example.com/',
  categories: {
    performance: {
      score: 0.4,
      auditRefs: [
        { id: 'largest-contentful-paint', group: 'metrics' },
        { id: 'cache-insight', group: 'insights' },
        { id: 'font-display-insight', group: 'insights' },
        { id: 'lcp-discovery-insight', group: 'insights' },
        { id: 'lcp-breakdown-insight', group: 'insights' },
      ],
    },
  },
  audits: {
    'largest-contentful-paint': { id: 'largest-contentful-paint', numericValue: 9100, score: 0.01 },
    'cache-insight': {
      id: 'cache-insight', title: 'Use efficient cache lifetimes', score: 0, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 0, LCP: 900 },
      details: { type: 'table', items: [{ url: 'https://cdn.example/a.js', cacheLifetimeMs: 900000, totalBytes: 180430, wastedBytes: 161259 }], debugData: { type: 'debugdata', wastedBytes: 161259 } },
    },
    'font-display-insight': {
      id: 'font-display-insight', title: 'Font display', score: 0, scoreDisplayMode: 'metricSavings', metricSavings: { FCP: 50, INP: 0 },
      details: { type: 'table', items: [{ url: 'https://example.com/f.woff2', wastedMs: 60 }] },
    },
    'lcp-discovery-insight': {
      id: 'lcp-discovery-insight', title: 'LCP request discovery', score: 0, scoreDisplayMode: 'numeric', metricSavings: { LCP: 0 },
      details: { type: 'list', items: [{ type: 'checklist', items: { priorityHinted: { label: 'fetchpriority=high should be applied', value: false } } }, { type: 'node', snippet: '<img>' }] },
    },
    'lcp-breakdown-insight': {
      id: 'lcp-breakdown-insight', title: 'LCP breakdown', score: 1, scoreDisplayMode: 'informative',
      details: { type: 'list', items: [{ type: 'table', items: [{ subpart: 'timeToFirstByte', duration: 190 }] }, { type: 'node', snippet: '<img src="hero.jpg">', selector: 'main > img' }] },
    },
  },
};

test('reads Lighthouse 13 insight audits', () => {
  const s = summarize(lhr13);
  assert.deepEqual(s.findings.map((f) => f.id), ['cache-insight', 'font-display-insight', 'lcp-discovery-insight']);
  const [cache, font, discovery] = s.findings;
  assert.equal(cache.category, 'resources');
  assert.equal(cache.savingsMs, 900);
  assert.equal(cache.savingsBytes, 161259);
  assert.equal(cache.items[0].url, 'https://cdn.example/a.js');
  assert.equal(font.savingsMs, 50, 'FCP-only savings still count');
  assert.equal(discovery.category, 'images');
  assert.deepEqual(discovery.items, [], 'checklists and nodes are not resource rows');
  assert.deepEqual(s.lcpElement, { snippet: '<img src="hero.jpg">', selector: 'main > img' });
});
