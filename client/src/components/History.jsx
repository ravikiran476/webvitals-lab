import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, formatDate, formatMetric, rate, rateScore, shortUrl } from '../metrics.js';
import Rating from './Rating.jsx';
import ChartTooltip from './ChartTooltip.jsx';

const TREND_OPTIONS = [
  ['performance', 'Performance score'],
  ['lcp', 'LCP'],
  ['cls', 'CLS'],
  ['tbt', 'TBT'],
  ['fcp', 'FCP'],
  ['si', 'Speed Index'],
];

const valueOf = (run, key) => (key === 'performance' ? run.scores.performance : run.metrics[key]?.value ?? null);
const format = (key, v) => (key === 'performance' ? `${v}` : formatMetric(key, v));

export default function History({ runs, onOpen, onDelete, onRename }) {
  const targets = useMemo(() => {
    const seen = new Map();
    for (const r of runs) {
      const k = `${r.url}|${r.formFactor}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return [...seen.entries()].map(([k, count]) => {
      const [url, formFactor] = k.split('|');
      return { key: k, url, formFactor, count };
    });
  }, [runs]);

  const [target, setTarget] = useState('');
  const [metric, setMetric] = useState('performance');
  useEffect(() => {
    if (!targets.some((t) => t.key === target)) setTarget(targets[0]?.key || '');
  }, [targets, target]);

  const series = useMemo(() => runs
    .filter((r) => `${r.url}|${r.formFactor}` === target)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r, i) => ({ ...r, n: i + 1, value: valueOf(r, metric) })), [runs, target, metric]);

  if (!runs.length) {
    return <section className="card empty">No audits yet. Run one from the Analyze tab and it will show up here.</section>;
  }

  const thresholds = metric === 'performance' ? [90, 50] : METRICS[metric].thresholds;
  const lowerIsBetter = metric !== 'performance';
  const maxVal = Math.max(...series.map((s) => s.value ?? 0), thresholds[1] * 1.2);

  return (
    <div className="report">
      <section className="card">
        <div className="filters">
          <label>
            <span>Page &amp; device</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {targets.map((t) => (
                <option key={t.key} value={t.key}>{shortUrl(t.url)} · {t.formFactor} ({t.count})</option>
              ))}
            </select>
          </label>
          <label>
            <span>Metric</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              {TREND_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <h3>{TREND_OPTIONS.find(([k]) => k === metric)[1]} over time</h3>
        <p className="muted small">
          Shaded bands show the good / needs-improvement / poor ranges. {series.length < 3 && 'Run at least 3 audits to see a reliable trend.'}
        </p>
        <div className="chart" style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 12, right: 24, left: 4, bottom: 4 }}>
              {lowerIsBetter ? (
                <>
                  <ReferenceArea y1={0} y2={thresholds[0]} fill="var(--status-good)" fillOpacity={0.07} ifOverflow="hidden" />
                  <ReferenceArea y1={thresholds[1]} y2={maxVal} fill="var(--status-critical)" fillOpacity={0.06} ifOverflow="hidden" />
                </>
              ) : (
                <>
                  <ReferenceArea y1={90} y2={100} fill="var(--status-good)" fillOpacity={0.07} />
                  <ReferenceArea y1={0} y2={50} fill="var(--status-critical)" fillOpacity={0.06} />
                </>
              )}
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="n" stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickFormatter={(n) => `#${n}`} />
              <YAxis
                stroke="var(--axis)"
                tick={{ fill: 'var(--muted)', fontSize: 12 }}
                domain={metric === 'performance' ? [0, 100] : [0, 'auto']}
                tickFormatter={(v) => format(metric, v)}
                width={64}
              />
              <Tooltip
                cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                content={(
                  <ChartTooltip
                    title={(d) => `Run #${d.n} · ${formatDate(d.createdAt)}`}
                    rows={(d) => [
                      [TREND_OPTIONS.find(([k]) => k === metric)[1], d.value == null ? '—' : format(metric, d.value), 'var(--series-1)'],
                      ...(d.label ? [['Label', d.label]] : []),
                    ]}
                  />
                )}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--series-1)"
                strokeWidth={2}
                dot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
                activeDot={{ r: 6, stroke: 'var(--surface)', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="card">
        <h3>All runs</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Page</th><th>Device</th><th>Label</th><th>Perf</th><th>LCP</th><th>CLS</th><th>TBT</th><th /></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.createdAt)}</td>
                  <td className="url-cell" title={r.url}>{shortUrl(r.url)}</td>
                  <td>{r.formFactor}</td>
                  <td>
                    <button className="link" onClick={() => {
                      const label = window.prompt('Label for this run', r.label);
                      if (label != null) onRename(r.id, label);
                    }}>{r.label || 'add label'}</button>
                  </td>
                  <td className="num"><Rating rating={rateScore(r.scores.performance)} compact /> {r.scores.performance ?? '—'}</td>
                  {['lcp', 'cls', 'tbt'].map((k) => (
                    <td key={k} className="num"><Rating rating={rate(k, r.metrics[k]?.value)} compact /> {formatMetric(k, r.metrics[k]?.value)}</td>
                  ))}
                  <td className="actions">
                    <button className="link" onClick={() => onOpen(r.id)}>View</button>
                    <button className="link danger" onClick={() => window.confirm('Delete this run?') && onDelete(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
