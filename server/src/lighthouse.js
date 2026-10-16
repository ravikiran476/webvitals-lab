import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import * as chromeLauncher from 'chrome-launcher';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

/** Runs a Lighthouse navigation audit in a fresh headless Chrome. */
export async function runLighthouse(url, { formFactor = 'mobile' } = {}) {
  const chrome = await chromeLauncher.launch({
    chromePath: process.env.CHROME_PATH || undefined,
    chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const flags = {
      port: chrome.port,
      output: 'html',
      logLevel: 'error',
      onlyCategories: CATEGORIES,
    };
    const result = await lighthouse(url, flags, formFactor === 'desktop' ? desktopConfig : undefined);
    if (!result?.lhr) throw new Error('Lighthouse returned no result');
    if (result.lhr.runtimeError) {
      throw new Error(`Lighthouse could not load the page: ${result.lhr.runtimeError.message}`);
    }
    return { lhr: result.lhr, html: result.report };
  } finally {
    await chrome.kill();
  }
}
