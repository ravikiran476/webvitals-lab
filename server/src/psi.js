// Runs Lighthouse remotely via the PageSpeed Insights API. Used where Chrome can't be launched
// (e.g. Vercel functions). PSI also returns Chrome UX Report field data, including INP.

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const FIELD_METRICS = {
  lcp: 'LARGEST_CONTENTFUL_PAINT_MS',
  cls: 'CUMULATIVE_LAYOUT_SHIFT_SCORE',
  inp: 'INTERACTION_TO_NEXT_PAINT',
  fcp: 'FIRST_CONTENTFUL_PAINT_MS',
  ttfb: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE',
};

export async function runPageSpeed(url, { formFactor = 'mobile' } = {}) {
  const params = new URLSearchParams({ url, strategy: formFactor === 'desktop' ? 'DESKTOP' : 'MOBILE' });
  for (const c of CATEGORIES) params.append('category', c);
  if (process.env.PSI_API_KEY) params.set('key', process.env.PSI_API_KEY);

  const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(110_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body.error?.message || `PageSpeed Insights responded ${res.status}`;
    const hint = res.status === 429 && !process.env.PSI_API_KEY ? ' Set PSI_API_KEY to get your own quota.' : '';
    const err = new Error(`${message}${hint}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  if (!body.lighthouseResult) throw new Error('PageSpeed Insights returned no Lighthouse result');
  if (body.lighthouseResult.runtimeError) {
    throw new Error(`Lighthouse could not load the page: ${body.lighthouseResult.runtimeError.message}`);
  }

  return { lhr: body.lighthouseResult, field: fieldData(body) };
}

function fieldData(body) {
  const exp = body.loadingExperience?.metrics ? body.loadingExperience : body.originLoadingExperience;
  if (!exp?.metrics) return { available: false, reason: 'CrUX has no real-user data for this URL or origin.' };

  const metrics = {};
  for (const [short, name] of Object.entries(FIELD_METRICS)) {
    const p = exp.metrics[name]?.percentile;
    // PSI reports CLS multiplied by 100.
    metrics[short] = p == null ? null : short === 'cls' ? p / 100 : p;
  }
  return {
    available: true,
    scope: exp === body.originLoadingExperience || exp.origin_fallback ? 'origin' : 'url',
    collectionPeriod: null,
    metrics,
  };
}
