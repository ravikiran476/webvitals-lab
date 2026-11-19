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

/** Table rows of an audit. Lighthouse 13 insights often wrap their tables in a "list". */
function rowsOf(details) {
  if (!Array.isArray(details?.items)) return [];
  if (details.type !== 'list') return details.items;
  return details.items.flatMap((part) => {
    if (part?.type === 'table') return part.items || [];
    if (part?.type === 'list-section' && part.value?.type === 'table') return part.value.items || [];
    return [];
  });
}

function itemsOf(audit, limit = 8) {
  return rowsOf(audit?.details)
    .map((i) => ({
      url: typeof i.url === 'string' ? i.url : i.entity?.text || i.source?.url || i.node?.snippet || i.origin || null,
      totalBytes: i.totalBytes ?? i.transferSize ?? null,
      wastedBytes: i.wastedBytes ?? null,
      wastedMs: i.wastedMs ?? i.blockingTime ?? i.scripting ?? i.duration ?? null,
    }))
    .filter((i) => i.url || i.totalBytes != null || i.wastedBytes != null || i.wastedMs != null)
    .slice(0, limit);
}

function lcpElement(lhr) {
  try {
    // Lighthouse 12 has a dedicated audit; Lighthouse 13 puts the element in the LCP breakdown insight.
    const legacy = lhr.audits['largest-contentful-paint-element']?.details;
    if (legacy) {
      const table = legacy.type === 'list' ? legacy.items[0] : legacy;
      const node = table?.items?.[0]?.node;
      return node ? { snippet: node.snippet, selector: node.selector } : null;
    }
    const node = lhr.audits['lcp-breakdown-insight']?.details?.items?.find((i) => i?.type === 'node');
    return node ? { snippet: node.snippet, selector: node.selector } : null;
  } catch {
    return null;
  }
}

/** Estimated time saved, in ms. Insights report it per metric, some only for FCP. */
function savingsMsOf(a) {
  if (a.details?.overallSavingsMs != null) return a.details.overallSavingsMs;
  const values = [a.metricSavings?.LCP, a.metricSavings?.FCP].filter((v) => typeof v === 'number');
  return values.length ? Math.max(...values) : null;
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
  // hidden group that duplicate the visible diagnostics; Lighthouse 13 shows the insights and
  // drops most of the older audits.
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
      savingsMs: savingsMsOf(a),
      savingsBytes: a.details?.overallSavingsBytes ?? a.details?.debugData?.wastedBytes ?? null,
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
