# WebVitals Lab

A website performance analyzer. It runs Lighthouse audits against public URLs you are authorized to test, reports Core Web Vitals and other metrics, tracks results across runs, points to the images, scripts and resources that need work, and compares before/after runs.

**Stack:** React 18 + Vite + Recharts (client) · Node.js + Express + Lighthouse 13 (server) · Vercel + Upstash Redis (deployment)

## Features

- **Analyze:** Lighthouse performance, accessibility, best-practices and SEO scores; LCP, CLS, TBT, FCP, Speed Index, TTI and TTFB, each rated good / needs improvement / poor, with deltas against the previous run of the same page.
- **INP:** Lighthouse lab runs can't measure INP because it needs real user interactions. Set `CRUX_API_KEY` to pull 75th-percentile field data (LCP, INP, CLS, FCP, TTFB) from the Chrome UX Report. Without it, TBT is shown as the lab proxy.
- **What needs attention:** failing audits grouped into Images, JavaScript, CSS/fonts/loading and Other, ranked by estimated savings, with the specific resources involved.
- **Resources:** page weight by resource type (chart) and the heaviest requests.
- **History:** a trend chart per page/device for any metric, with threshold bands, plus a table of every run with labels.
- **Compare:** pick a before and an after run to see score, metric, weight and request deltas, and which audits were fixed, are new, or are still open.
- Each run's full Lighthouse HTML report is saved and can be opened.

## Requirements

- Node.js 22.19 or newer (Lighthouse 13 requires it)
- Google Chrome or Chromium installed. Set `CHROME_PATH` if it isn't found automatically.

## Getting started

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:4000

Production build, served by the API server:

```bash
npm run build
npm start          # http://localhost:4000
```

Tests (URL guard, egress proxy, API token, run store, LHR summarizer, PageSpeed client):

```bash
npm test -w server
```

## Deploying to Vercel

Vercel functions can't launch Chrome, so the deployed app uses a different audit engine and storage than local development:

| | Local (`npm run dev`) | Vercel |
|---|---|---|
| Audits | Lighthouse in your local Chrome | [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started), which runs Lighthouse on Google's servers |
| Field data / INP | Needs `CRUX_API_KEY` | Included in the PageSpeed response |
| Run history | `server/data/runs.json` | Upstash Redis |
| Full HTML report | Saved per run | Links to PageSpeed Insights instead |

The React build is served from Vercel's CDN. `api/index.js` exports the Express app as one function, and `vercel.json` routes `/api/*` to it.

1. **Get a PageSpeed Insights API key.** In Google Cloud Console, enable the *PageSpeed Insights API* and create an API key. Without a key, requests share Google's anonymous quota, which is usually exhausted, and audits fail with "Quota exceeded".
2. **Deploy:** `npx vercel` (first time: links the project), then `npx vercel --prod`. You can also import the Git repository in the Vercel dashboard. No build settings are needed because `vercel.json` provides them.
3. **Add storage:** in the Vercel project, go to **Storage → Create Database → Upstash for Redis** (free tier) and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Set environment variables:** `PSI_API_KEY` and `WEBVITALS_TOKEN` (a long random value), plus optionally `ALLOWED_HOSTS`. Without `WEBVITALS_TOKEN`, a Vercel deployment answers audits, renames and deletes with 503, so strangers cannot spend your PageSpeed quota or delete your history.
5. **Redeploy** so the new variables take effect: `npx vercel --prod`. The app asks for the token the first time you run an audit and remembers it in that browser.

Without Redis the app still works, but history lives in the function's temporary storage and disappears; the UI shows a warning banner when that's the case.

## Configuration (server environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `HOST` | `127.0.0.1` and `::1` | Address to listen on. The server drives a real browser, so it is local by default; if you open it to the network, set `WEBVITALS_TOKEN` too |
| `WEBVITALS_TOKEN` | *(unset)* | API token required to run audits and to rename or delete runs (`Authorization: Bearer` or `X-WebVitals-Token`). Reading history stays open. Required on Vercel |
| `REQUIRE_TOKEN` | `true` on Vercel | Refuse audits and changes (503) while no `WEBVITALS_TOKEN` is set |
| `MAX_RUNS` | `500` | Runs kept in history; the oldest are deleted beyond this |
| `PSI_TIMEOUT_MS` | `100000` | Give up on a PageSpeed Insights audit after this long (below the 120 s function limit) |
| `CHROME_NO_SANDBOX` | *(unset)* | `true` adds `--no-sandbox`, for containers that cannot run Chrome's sandbox (for example as root in Docker). Leave it off otherwise |
| `ALLOWED_HOSTS` | *(unset)* | Comma-separated host allowlist, e.g. `example.com,staging.example.com`. Subdomains match. Recommended for shared deployments. |
| `AUDIT_ENGINE` | `local`, or `psi` on Vercel | `local` runs Lighthouse in local Chrome; `psi` uses the PageSpeed Insights API |
| `PSI_API_KEY` | *(unset)* | PageSpeed Insights API key. Required in practice for the `psi` engine. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | *(unset)* | Upstash Redis credentials (set by the Vercel integration). `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work. Without them, runs are stored in a local JSON file. |
| `CRUX_API_KEY` | *(unset)* | Local engine only: Google API key with the Chrome UX Report API enabled, used for field data and INP |
| `CHROME_PATH` | auto | Path to the Chrome binary |
| `DATA_DIR` | `server/data` | File storage only: where `runs.json` and saved HTML reports live |
| `MAX_QUEUE` | `3` | Maximum audits in progress or queued at once. Local audits run one at a time so timings don't interfere; PageSpeed Insights audits run in parallel. |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin for the API |

## Authorized testing only

Only audit sites you own or have permission to test. The server enforces some of this:

- The client must send `authorized: true` (the confirmation checkbox).
- Only `http`/`https` URLs without embedded credentials are accepted.
- Hostnames are resolved, and any address in a loopback, private, link-local (including cloud metadata `169.254.169.254`), CGNAT, multicast or reserved range is rejected.
- `ALLOWED_HOSTS` restricts audits to an explicit list.
- Addresses hidden inside IPv6 (NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-mapped) are checked as the IPv4 address they carry.
- **Everything the local Chrome loads goes through a filtering proxy.** Redirects, images, scripts, `fetch` calls and WebSockets are all checked, not only the first URL. The proxy resolves each host itself and connects to the address it checked, so a DNS answer that changes after the check (DNS rebinding) cannot reach an internal address either. A page whose main document is redirected to an internal address fails to load; blocked subresources are listed in the run's warnings.
- Chrome keeps its sandbox on (see `CHROME_NO_SANDBOX`).

With the PageSpeed Insights engine (Vercel), Google's servers load the page, so it cannot reach your network at all. An internet-facing local-engine server should still run somewhere with no route to internal services.

## Project layout

```
api/index.js          Vercel function entry (re-exports the Express app)
vercel.json           Build output, /api rewrite, function timeout
server/
  src/app.js          Express API and audit queue
  src/index.js        Local server entry (listens on PORT)
  src/engine.js       Chooses the local Lighthouse or PageSpeed Insights engine
  src/lighthouse.js   Launches headless Chrome and runs Lighthouse
  src/psi.js          PageSpeed Insights API client plus field data
  src/summarize.js    Reduces the full Lighthouse result to the stored run record
  src/crux.js         Optional Chrome UX Report field data
  src/urlGuard.js     URL validation and private-network blocking
  src/egressProxy.js  Filtering proxy for every connection the local Chrome makes
  src/store.js        Upstash Redis or JSON-file persistence
client/
  src/App.jsx         Tabs: Analyze / History / Compare
  src/components/     RunReport, History, Compare, AnalyzePanel, Rating, ChartTooltip
  src/metrics.js      Thresholds, ratings and formatting
```

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/runs` | `{ url, formFactor: "mobile" \| "desktop", label?, authorized: true }` runs an audit and returns the run. Token required when set |
| `GET` | `/api/runs` | Run summaries (scores, metric values, totals; no findings or request lists), newest first. `?url=` filters, `?limit=` (default 200, max 1000); the `X-Total-Count` header has the total |
| `GET` | `/api/runs/:id` | One full run |
| `PATCH` | `/api/runs/:id` | `{ label }`. Token required when set |
| `DELETE` | `/api/runs/:id` | Delete a run and its report. Token required when set |
| `GET` | `/api/runs/:id/report` | Full Lighthouse HTML report |
| `GET` | `/api/health` | Queue depth, audit engine, storage type, and whether field data is enabled |
