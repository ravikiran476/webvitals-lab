# Changelog

## 0.2.0

### Security

- **API token.** `WEBVITALS_TOKEN` protects running audits and renaming or deleting runs. On Vercel these are refused (503) until the token is set, so a public deployment can no longer be used to spend its PageSpeed quota or wipe its history. The app asks for the token once per browser. Reading history stays open.
- **Every connection the local Chrome makes is filtered.** A proxy checks redirects, subresources, `fetch` calls and WebSockets, not only the URL that was submitted, and connects only to the address it checked, which also stops DNS rebinding. Blocked subresources appear in the run's warnings.
- IPv6 forms that carry a private IPv4 address (NAT64, 6to4) are now rejected.
- Chrome keeps its sandbox on. `CHROME_NO_SANDBOX=true` restores the old flag for containers that need it.
- The local server listens on `127.0.0.1` and `::1` only (`HOST` to change).

### History and performance

- `GET /api/runs` returns summaries without findings or request lists, with `?limit=` (default 200) and an `X-Total-Count` header. Redis keeps a summary per run, so listing no longer reads every full run. Older runs get their summary on first listing.
- History keeps at most `MAX_RUNS` runs (default 500), deleting the oldest.
- PageSpeed Insights audits run in parallel (local Lighthouse audits still run one at a time), and give up after `PSI_TIMEOUT_MS` (100 s) with a clear 504 instead of being cut off by the 120 s function limit.
- The client loads the charts only when a report, History or Compare is shown: the first page needs about 150 kB of JavaScript instead of 566 kB.

### Fixes

- Compare warns when the two runs used different audit engines or Lighthouse versions.

### Dependencies

- `npm audit fix` for the advisories that have fixes within the current version ranges (body-parser, Vite).
- 30 advisories remain (10 high, 20 moderate), all in Lighthouse 12's dependency tree (Puppeteer, proxy-agent, Sentry). They are fixed only in Lighthouse 13.5+, which needs Node 22.19+ and removes audits this app reads (`total-byte-weight`, `largest-contentful-paint-element`, the image opportunities). That upgrade is planned separately. Lighthouse runs only with the local engine; Vercel deployments use PageSpeed Insights and never load it.
- CI (GitHub Actions) runs the server tests and the client build.

### Upgrading

- **Vercel:** set `WEBVITALS_TOKEN`, then redeploy. Until then, audits return 503.
- **Local:** nothing required. If you reach the server from another machine, set `HOST=0.0.0.0` and `WEBVITALS_TOKEN`. If Chrome fails to start in a container, set `CHROME_NO_SANDBOX=true`.
- Code that reads `findings` or `heaviestRequests` from `GET /api/runs` must fetch `GET /api/runs/:id` instead.

## 0.1.0

First release.
