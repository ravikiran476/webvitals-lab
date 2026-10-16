// Thresholds follow web.dev guidance: [good upper bound, poor lower bound].
export const METRICS = {
  lcp: { name: 'Largest Contentful Paint', short: 'LCP', unit: 'ms', thresholds: [2500, 4000], core: true,
    hint: 'Time until the largest image or text block is visible.' },
  inp: { name: 'Interaction to Next Paint', short: 'INP', unit: 'ms', thresholds: [200, 500], core: true,
    hint: 'Responsiveness to user input. Field data only; lab runs use TBT as a proxy.' },
  cls: { name: 'Cumulative Layout Shift', short: 'CLS', unit: '', thresholds: [0.1, 0.25], core: true,
    hint: 'How much visible content moves unexpectedly while loading.' },
  tbt: { name: 'Total Blocking Time', short: 'TBT', unit: 'ms', thresholds: [200, 600],
    hint: 'Main-thread time blocked by long tasks. Lab proxy for INP.' },
  fcp: { name: 'First Contentful Paint', short: 'FCP', unit: 'ms', thresholds: [1800, 3000],
    hint: 'Time until the first text or image is painted.' },
  si: { name: 'Speed Index', short: 'SI', unit: 'ms', thresholds: [3400, 5800],
    hint: 'How quickly content is visually populated.' },
  tti: { name: 'Time to Interactive', short: 'TTI', unit: 'ms', thresholds: [3800, 7300],
    hint: 'Time until the page reliably responds to input.' },
  ttfb: { name: 'Time to First Byte', short: 'TTFB', unit: 'ms', thresholds: [800, 1800],
    hint: 'Server response time for the main document.' },
};

export const LAB_ORDER = ['lcp', 'cls', 'tbt', 'fcp', 'si', 'tti', 'ttfb'];
export const FIELD_ORDER = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'];
export const CATEGORY_LABELS = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  'best-practices': 'Best practices',
  seo: 'SEO',
};

export function rate(key, value) {
  if (value == null) return null;
  const [good, poor] = METRICS[key].thresholds;
  if (value <= good) return 'good';
  if (value <= poor) return 'warn';
  return 'poor';
}

export function rateScore(score) {
  if (score == null) return null;
  if (score >= 90) return 'good';
  if (score >= 50) return 'warn';
  return 'poor';
}

export const RATING_LABEL = { good: 'Good', warn: 'Needs improvement', poor: 'Poor' };

export function formatMetric(key, value) {
  if (value == null) return '—';
  if (key === 'cls') return value.toFixed(3);
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${p}`;
  } catch {
    return url;
  }
}

export function runName(run) {
  return `${run.label || shortUrl(run.url)} · ${run.formFactor} · ${formatDate(run.createdAt)}`;
}
