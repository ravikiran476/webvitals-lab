import { fetchFieldData } from './crux.js';
import { runPageSpeed } from './psi.js';

/** "local" launches Chrome on this machine; "psi" uses the PageSpeed Insights API. */
export function auditEngine() {
  const configured = process.env.AUDIT_ENGINE;
  if (configured === 'local' || configured === 'psi') return configured;
  return process.env.VERCEL ? 'psi' : 'local';
}

export async function runAudit(url, { formFactor }) {
  if (auditEngine() === 'psi') {
    const { lhr, field } = await runPageSpeed(url, { formFactor });
    return { lhr, field, html: null };
  }

  // A computed specifier keeps Vercel's file tracer from bundling Lighthouse + Puppeteer
  // into the serverless function, where they could not run anyway.
  const localModule = './lighthouse.js';
  const { runLighthouse } = await import(localModule);
  const [{ lhr, html }, field] = await Promise.all([
    runLighthouse(url, { formFactor }),
    fetchFieldData(url, formFactor),
  ]);
  return { lhr, field, html };
}

export function fieldDataEnabled() {
  return auditEngine() === 'psi' || Boolean(process.env.CRUX_API_KEY);
}
