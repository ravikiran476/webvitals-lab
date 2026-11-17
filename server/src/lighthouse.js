import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import * as chromeLauncher from 'chrome-launcher';
import { startEgressProxy } from './egressProxy.js';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

/**
 * Runs a Lighthouse navigation audit in a fresh headless Chrome. All of Chrome's traffic goes
 * through the egress proxy, so a page cannot reach private or internal addresses through a
 * redirect, a subresource or a changed DNS answer.
 */
export async function runLighthouse(url, { formFactor = 'mobile', resolve } = {}) {
  // `resolve` lets tests stand in for DNS; production always uses the default resolver.
  const proxy = await startEgressProxy(resolve ? { resolve } : {});
  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: process.env.CHROME_PATH || undefined,
      chromeFlags: [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--proxy-server=${proxy.url}`,
        // Chrome normally bypasses proxies for localhost; "<-loopback>" removes that exception.
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        // The sandbox stays on. Containers that cannot provide one can opt out explicitly.
        ...(process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : []),
      ],
    });
    const flags = {
      port: chrome.port,
      output: 'html',
      logLevel: 'error',
      onlyCategories: CATEGORIES,
    };
    const result = await lighthouse(url, flags, formFactor === 'desktop' ? desktopConfig : undefined);
    if (!result?.lhr) throw new Error('Lighthouse returned no result');
    if (result.lhr.runtimeError) {
      const blocked = proxy.blocked.find((b) => result.lhr.finalDisplayedUrl?.includes(b.host)) ?? proxy.blocked[0];
      const why = blocked ? ` (blocked: ${blocked.reason})` : '';
      throw new Error(`Lighthouse could not load the page: ${result.lhr.runtimeError.message}${why}`);
    }
    if (proxy.blocked.length) {
      const hosts = [...new Set(proxy.blocked.map((b) => b.host))].join(', ');
      result.lhr.runWarnings = [...(result.lhr.runWarnings ?? []), `Requests to private or reserved addresses were blocked: ${hosts}`];
    }
    return { lhr: result.lhr, html: result.report };
  } finally {
    await chrome?.kill();
    await proxy.close();
  }
}
