import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import {
  CATEGORY_LABELS, FIELD_ORDER, LAB_ORDER, METRICS,
  formatBytes, formatDate, formatMetric, rate, rateScore,
} from '../metrics.js';
import Rating, { Delta } from './Rating.jsx';
import ChartTooltip from './ChartTooltip.jsx';

const FINDING_GROUPS = [
  ['images', 'Images'],
  ['scripts', 'JavaScript'],
  ['resources', 'CSS, fonts & loading'],
  ['other', 'Other'],
];

export default function RunReport({ run, previous }) {
  return (
    <div className="report">
      <section className="card">
        <div className="report-head">
          <div>
            <h2>{run.label || 'Audit result'}</h2>
            <p className="muted">
              <a href={run.finalUrl || run.url} target="_blank" rel="noreferrer">{run.finalUrl || run.url}</a>
              {' · '}{run.formFactor}{' · '}{formatDate(run.createdAt)}{' · '}Lighthouse {run.lighthouseVersion}
            </p>
          </div>
          {run.reportAvailable === false ? (
            <a className="button" href={pageSpeedUrl(run)} target="_blank" rel="noreferrer">Open in PageSpeed Insights ↗</a>
          ) : (
            <a className="button" href={api.reportUrl(run.id)} target="_blank" rel="noreferrer">Full Lighthouse report ↗</a>
          )}
        </div>
        {previous && (
          <p className="muted small">Deltas compare against the previous {run.formFactor} run of this URL ({formatDate(previous.createdAt)}).</p>
        )}
        {run.warnings?.length > 0 && (
          <div className="banner warn">
            {run.warnings.map((w) => <div key={w}>{w}</div>)}
          </div>
        )}
        <div className="scores">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <ScoreGauge key={key} label={label} score={run.scores[key]} prev={previous?.scores?.[key]} />
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Lab metrics</h3>
        <p className="muted small">Measured in a single simulated page load. Expect some variation between runs; repeat audits to confirm a trend.</p>
        <div className="metric-grid">
          {LAB_ORDER.map((key) => (
            <MetricCard key={key} metric={key} value={run.metrics[key]?.value} prev={previous?.metrics?.[key]?.value} />
          ))}
        </div>
        {run.lcpElement && (
          <div className="lcp-element">
            <span className="muted small">LCP element</span>
            <code>{run.lcpElement.snippet}</code>
          </div>
        )}
      </section>

      <FieldData field={run.field} />

      <Findings findings={run.findings} />

      <Resources run={run} />
    </div>
  );
}

function ScoreGauge({ label, score, prev }) {
  const rating = rateScore(score);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="gauge">
      <svg viewBox="0 0 80 80" width="88" height="88" role="img" aria-label={`${label} score ${score ?? 'unavailable'}`}>
        <circle cx="40" cy="40" r={r} className="gauge-track" />
        <circle
          cx="40" cy="40" r={r}
          className={`gauge-fill ${rating || ''}`}
          strokeDasharray={`${((score || 0) / 100) * c} ${c}`}
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="46" textAnchor="middle" className="gauge-text">{score ?? '—'}</text>
      </svg>
      <div className="gauge-label">{label}</div>
      <Rating rating={rating} compact />
      {prev != null && <Delta before={prev} after={score} lowerIsBetter={false} format={(v) => `${v}`} />}
    </div>
  );
}

function MetricCard({ metric, value, prev, source }) {
  const def = METRICS[metric];
  const rating = rate(metric, value);
  return (
    <div className={`metric ${rating || ''}`} title={def.hint}>
      <div className="metric-top">
        <span className="metric-short">{def.short}{def.core && <span className="core">Core Web Vital</span>}</span>
        <Rating rating={rating} />
      </div>
      <div className="metric-value">{formatMetric(metric, value)}</div>
      <div className="metric-name">{def.name}{source && <span className="muted"> · {source}</span>}</div>
      {prev !== undefined && <Delta before={prev} after={value} format={(v) => formatMetric(metric, v)} />}
    </div>
  );
}

function FieldData({ field }) {
  if (!field) return null;
  return (
    <section className="card">
      <h3>Real-user field data (CrUX, 75th percentile)</h3>
      {field.available ? (
        <>
          <p className="muted small">
            Based on {field.scope === 'url' ? 'this URL' : 'the whole origin'} over the last 28 days of Chrome users.
            {field.collectionPeriod?.lastDate && ` Through ${Object.values(field.collectionPeriod.lastDate).join('-')}.`}
          </p>
          <div className="metric-grid">
            {FIELD_ORDER.map((key) => <MetricCard key={key} metric={key} value={field.metrics[key]} />)}
          </div>
        </>
      ) : (
        <p className="muted">
          {field.reason} Lab runs can't measure <strong>INP</strong>; use <strong>TBT</strong> above as its proxy.
        </p>
      )}
    </section>
  );
}

function Findings({ findings }) {
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => FINDING_GROUPS
    .map(([key, label]) => [key, label, findings.filter((f) => f.category === key)])
    .filter(([, , list]) => list.length), [findings]);

  return (
    <section className="card">
      <h3>What needs attention</h3>
      {!groups.length && <p className="muted">No failing performance audits. Nice work.</p>}
      {groups.map(([key, label, list]) => (
        <div key={key} className="finding-group">
          <h4>{label} <span className="count">{list.length}</span></h4>
          <ul className="findings">
            {list.map((f) => (
              <li key={f.id}>
                <button className="finding" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>
                  <Rating rating={f.score < 0.5 ? 'poor' : 'warn'} compact />
                  <span className="finding-title">{f.title}</span>
                  <span className="finding-savings">
                    {f.savingsMs ? `~${formatMetric('lcp', f.savingsMs)}` : ''}
                    {f.savingsBytes ? ` · ${formatBytes(f.savingsBytes)}` : ''}
                    {!f.savingsMs && !f.savingsBytes && f.displayValue}
                  </span>
                </button>
                {open === f.id && (
                  <div className="finding-body">
                    <p>{stripMarkdownLinks(f.description)}</p>
                    {f.items.length > 0 && (
                      <table>
                        <thead><tr><th>Resource</th><th>Size</th><th>Potential savings</th></tr></thead>
                        <tbody>
                          {f.items.map((i, idx) => (
                            <tr key={idx}>
                              <td className="url-cell" title={i.url || ''}>{i.url || '—'}</td>
                              <td>{formatBytes(i.totalBytes)}</td>
                              <td>
                                {i.wastedBytes != null && formatBytes(i.wastedBytes)}
                                {i.wastedBytes != null && i.wastedMs != null && ' · '}
                                {i.wastedMs != null && formatMetric('lcp', i.wastedMs)}
                                {i.wastedBytes == null && i.wastedMs == null && '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Resources({ run }) {
  const data = [...(run.resourceSummary || [])].filter((r) => r.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  return (
    <section className="card">
      <h3>Page weight by resource type</h3>
      <p className="muted small">
        {formatBytes(run.totals?.bytes)} transferred across {run.totals?.requests ?? '—'} requests.
      </p>
      {data.length > 0 && (
        <div className="chart" style={{ height: Math.max(160, data.length * 36) }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis type="number" tickFormatter={formatBytes} stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
              <YAxis type="category" dataKey="label" width={100} stroke="var(--axis)" tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: 'var(--hover)' }}
                content={<ChartTooltip rows={(p) => [[p.label, `${formatBytes(p.bytes)} · ${p.requests} requests`]]} />}
              />
              <Bar isAnimationActive={false} dataKey="bytes" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <h4>Heaviest requests</h4>
      <div className="table-wrap">
      <table className="requests">
        <thead><tr><th>URL</th><th>Type</th><th>Transfer size</th><th>Duration</th></tr></thead>
        <tbody>
          {(run.heaviestRequests || []).map((r) => (
            <tr key={r.url}>
              <td className="url-cell" title={r.url}>{r.url}</td>
              <td>{r.type}</td>
              <td className="num">{formatBytes(r.bytes)}</td>
              <td className="num">{r.durationMs != null ? formatMetric('lcp', r.durationMs) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

// PSI-backed runs have no stored HTML report; PageSpeed Insights shows a fresh one for the same page.
function pageSpeedUrl(run) {
  return `https://pagespeed.web.dev/report?${new URLSearchParams({ url: run.url, form_factor: run.formFactor })}`;
}

function stripMarkdownLinks(text = '') {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
