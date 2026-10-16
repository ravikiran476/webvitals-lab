// Turns a full Lighthouse result (LHR, several MB) into the compact record we store and chart.

const METRICS = {
  lcp: 'largest-contentful-paint',
  cls: 'cumulative-layout-shift',
  tbt: 'total-blocking-time',
  fcp: 'first-contentful-paint',
  si: 'speed-index',
  tti: 'interactive',
  ttfb: 'server-response-time',
};
const METRIC_IDS = new Set(Object.values(METRICS));

const IMAGE_AUDITS = new Set([
  'uses-optimized-images',
  'modern-image-formats',
  'uses-responsive-images',
  'offscreen-images',
  'efficient-animated-content',
  'unsized-images',
  'prioritize-lcp-image',
  'lcp-lazy-loaded',
]);

const SCRIPT_AUDITS = new Set([
  'unused-javascript',
  'unminified-javascript',
  'legacy-javascript',
  'duplicated-javascript',
  'bootup-time',
  'mainthread-work-breakdown',
  'third-party-summary',
  'long-tasks',
]);

const SKIP_MODES = new Set(['informative', 'notApplicable', 'manual', 'error']);

function categorize(id) {
  if (IMAGE_AUDITS.has(id) || /image|lcp-discovery/.test(id)) return 'images';
  if (SCRIPT_AUDITS.has(id) || /javascript|third-part|forced-reflow/.test(id)) return 'scripts';
  if (/css|font|render-blocking|preconnect|preload|critical-request|network-dependency|cache|text-compression|redirects|document-latency/.test(id)) return 'resources';
  return 'other';
}

function itemsOf(audit, limit = 8) {
  const items = audit?.details?.items;
  if (!Array.isArray(items)) return [];
  return items.slice(0, limit).map((i) => ({
    url: typeof i.url === 'string' ? i.url : i.entity?.text || i.source?.url || i.node?.snippet || null,
    totalBytes: i.totalBytes ?? i.transferSize ?? null,
    wastedBytes: i.wastedBytes ?? null,
    wastedMs: i.wastedMs ?? i.blockingTime ?? i.scripting ?? i.duration ?? null,
  }));
}

function lcpElement(lhr) {
  try {
    const details = lhr.audits['largest-contentful-paint-element']?.details;
    const table = details?.type === 'list' ? details.items[0] : details;
    const node = table?.items?.[0]?.node;
    return node ? { snippet: node.snippet, selector: node.selector } : null;
  } catch {
    return null;
  }
}

export function summarize(lhr) {
  const audits = lhr.audits;

  const scores = {};
  for (const [key, cat] of Object.entries(lhr.categories)) {
    scores[key] = cat.score == null ? null : Math.round(cat.score * 100);
  }

  const metrics = {};
  for (const [key, id] of Object.entries(METRICS)) {
    const a = audits[id];
    metrics[key] = a
      ? { value: a.numericValue ?? null, score: a.score, display: a.displayValue ?? null }
      : null;
  }

  // Only audits Lighthouse itself displays. Lighthouse 12 also ships "insight" audits in a
  // hidden group that duplicate the visible diagnostics.
  const perfIds = new Set((lhr.categories.performance?.auditRefs || [])
    .filter((r) => r.group !== 'hidden')
    .map((r) => r.id));
  const findings = [];
  for (const a of Object.values(audits)) {
    const isOpportunity = a.details?.type === 'opportunity';
    if (!perfIds.has(a.id) || METRIC_IDS.has(a.id)) continue;
    if (SKIP_MODES.has(a.scoreDisplayMode) || a.score == null || a.score >= 0.9) continue;
    findings.push({
      id: a.id,
      title: a.title,
      description: a.description,
      displayValue: a.displayValue ?? null,
      score: a.score,
      kind: isOpportunity ? 'opportunity' : 'diagnostic',
      category: categorize(a.id),
      savingsMs: a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? null,
      savingsBytes: a.details?.overallSavingsBytes ?? null,
      items: itemsOf(a),
    });
  }
  findings.sort((x, y) => (y.savingsMs || 0) - (x.savingsMs || 0) || x.score - y.score);

  const resourceSummary = (audits['resource-summary']?.details?.items || [])
    .filter((i) => i.resourceType !== 'total')
    .map((i) => ({
      type: i.resourceType,
      label: i.label,
      requests: i.requestCount,
      bytes: i.transferSize,
    }));

  const heaviestRequests = (audits['network-requests']?.details?.items || [])
    .filter((r) => r.transferSize > 0)
    .sort((a, b) => b.transferSize - a.transferSize)
    .slice(0, 15)
    .map((r) => ({
      url: r.url,
      type: r.resourceType || 'Other',
      bytes: r.transferSize,
      durationMs: r.networkEndTime != null && r.networkRequestTime != null
        ? Math.round(r.networkEndTime - r.networkRequestTime)
        : null,
    }));

  const totalBytes = audits['total-byte-weight']?.numericValue ?? null;
  const requestCount = audits['network-requests']?.details?.items?.length ?? null;

  return {
    finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl,
    lighthouseVersion: lhr.lighthouseVersion,
    fetchTime: lhr.fetchTime,
    scores,
    metrics,
    totals: { bytes: totalBytes, requests: requestCount },
    lcpElement: lcpElement(lhr),
    findings,
    resourceSummary,
    heaviestRequests,
    warnings: lhr.runWarnings || [],
  };
}
