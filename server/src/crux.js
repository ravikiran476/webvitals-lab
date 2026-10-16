// Optional real-user (field) data from the Chrome UX Report API.
// Lighthouse lab runs cannot measure INP, because it needs real user interactions,
// so INP comes from CrUX when CRUX_API_KEY is set.

const ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
const FIELD_METRICS = {
  lcp: 'largest_contentful_paint',
  cls: 'cumulative_layout_shift',
  inp: 'interaction_to_next_paint',
  fcp: 'first_contentful_paint',
  ttfb: 'experimental_time_to_first_byte',
};

async function query(key, body) {
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, metrics: Object.values(FIELD_METRICS) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null; // not enough real-user traffic in CrUX
  if (!res.ok) throw new Error(`CrUX API responded ${res.status}`);
  return res.json();
}

export async function fetchFieldData(url, formFactor) {
  const key = process.env.CRUX_API_KEY;
  if (!key) return { available: false, reason: 'Set CRUX_API_KEY to include real-user field data (needed for INP).' };

  const ff = formFactor === 'desktop' ? 'DESKTOP' : 'PHONE';
  try {
    let scope = 'url';
    let data = await query(key, { url, formFactor: ff });
    if (!data) {
      scope = 'origin';
      data = await query(key, { origin: new URL(url).origin, formFactor: ff });
    }
    if (!data) return { available: false, reason: 'CrUX has no field data for this URL or origin.' };

    const metrics = {};
    for (const [short, name] of Object.entries(FIELD_METRICS)) {
      const p75 = data.record?.metrics?.[name]?.percentiles?.p75;
      metrics[short] = p75 == null ? null : Number(p75);
    }
    return {
      available: true,
      scope,
      collectionPeriod: data.record?.collectionPeriod ?? null,
      metrics,
    };
  } catch (err) {
    return { available: false, reason: `Field data unavailable: ${err.message}` };
  }
}
