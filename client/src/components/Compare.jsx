import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CATEGORY_LABELS, LAB_ORDER, METRICS, formatBytes, formatMetric, rate, runName } from '../metrics.js';
import Rating, { Delta } from './Rating.jsx';
import ChartTooltip from './ChartTooltip.jsx';

export default function Compare({ runs }) {
  const [baseId, setBaseId] = useState('');
  const [candId, setCandId] = useState('');

  // Default to the two most recent runs of the most recently audited page.
  useEffect(() => {
    if (!runs.length || (runs.some((r) => r.id === baseId) && runs.some((r) => r.id === candId))) return;
    const latest = runs[0];
    const prev = runs.find((r) => r.id !== latest.id && r.url === latest.url && r.formFactor === latest.formFactor)
      || runs.find((r) => r.id !== latest.id);
    setCandId(latest.id);
    setBaseId(prev?.id || latest.id);
  }, [runs, baseId, candId]);

  const base = runs.find((r) => r.id === baseId);
  const cand = runs.find((r) => r.id === candId);

  const scoreData = useMemo(() => (base && cand ? Object.entries(CATEGORY_LABELS).map(([k, label]) => ({
    label, before: base.scores[k], after: cand.scores[k],
  })) : []), [base, cand]);

  const findingDiff = useMemo(() => {
    if (!base || !cand) return null;
    const b = new Map(base.findings.map((f) => [f.id, f]));
    const c = new Map(cand.findings.map((f) => [f.id, f]));
    return {
      fixed: [...b.values()].filter((f) => !c.has(f.id)),
      added: [...c.values()].filter((f) => !b.has(f.id)),
      remaining: [...c.values()].filter((f) => b.has(f.id)),
    };
  }, [base, cand]);

  if (runs.length < 2) {
    return <section className="card empty">Run at least two audits to compare. Audit once before an optimization and again after it ships.</section>;
  }

  return (
    <div className="report">
      <section className="card">
        <div className="filters">
          <label className="grow">
            <span>Before (baseline)</span>
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
              {runs.map((r) => <option key={r.id} value={r.id}>{runName(r)}</option>)}
            </select>
          </label>
          <label className="grow">
            <span>After (candidate)</span>
            <select value={candId} onChange={(e) => setCandId(e.target.value)}>
              {runs.map((r) => <option key={r.id} value={r.id}>{runName(r)}</option>)}
            </select>
          </label>
        </div>
        {base && cand && (base.url !== cand.url || base.formFactor !== cand.formFactor) && (
          <div className="banner warn">These runs are for different pages or devices, so differences may not reflect your optimization.</div>
        )}
      </section>

      {base && cand && (
        <>
          <section className="card">
            <h3>Category scores</h3>
            <div className="chart" style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={scoreData} margin={{ top: 20, right: 16, left: 0, bottom: 4 }} barGap={2} barCategoryGap="24%">
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="label" stroke="var(--axis)" tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
                  <YAxis domain={[0, 100]} stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} width={36} />
                  <Tooltip
                    cursor={{ fill: 'var(--hover)' }}
                    content={<ChartTooltip rows={(d) => [
                      ['Before', d.before ?? '—', 'var(--series-1)'],
                      ['After', d.after ?? '—', 'var(--series-2)'],
                    ]} />}
                  />
                  <Legend wrapperStyle={{ color: 'var(--text-2)', fontSize: 13 }} />
                  <Bar isAnimationActive={false} dataKey="before" name="Before" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    <LabelList dataKey="before" position="top" fill="var(--text-2)" fontSize={12} />
                  </Bar>
                  <Bar isAnimationActive={false} dataKey="after" name="After" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    <LabelList dataKey="after" position="top" fill="var(--text-2)" fontSize={12} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h3>Metrics</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
                <tbody>
                  {LAB_ORDER.map((k) => {
                    const b = base.metrics[k]?.value;
                    const a = cand.metrics[k]?.value;
                    return (
                      <tr key={k}>
                        <td><strong>{METRICS[k].short}</strong> <span className="muted">{METRICS[k].name}</span></td>
                        <td className="num"><Rating rating={rate(k, b)} compact /> {formatMetric(k, b)}</td>
                        <td className="num"><Rating rating={rate(k, a)} compact /> {formatMetric(k, a)}</td>
                        <td className="num"><Delta before={b} after={a} format={(v) => formatMetric(k, v)} /></td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td><strong>Weight</strong> <span className="muted">Total transfer size</span></td>
                    <td className="num">{formatBytes(base.totals?.bytes)}</td>
                    <td className="num">{formatBytes(cand.totals?.bytes)}</td>
                    <td className="num"><Delta before={base.totals?.bytes} after={cand.totals?.bytes} format={formatBytes} /></td>
                  </tr>
                  <tr>
                    <td><strong>Requests</strong></td>
                    <td className="num">{base.totals?.requests ?? '—'}</td>
                    <td className="num">{cand.totals?.requests ?? '—'}</td>
                    <td className="num"><Delta before={base.totals?.requests} after={cand.totals?.requests} format={(v) => `${v}`} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h3>Audit changes</h3>
            <div className="diff-cols">
              <FindingList title="Fixed" tone="better" list={findingDiff.fixed} empty="Nothing resolved yet." />
              <FindingList title="New issues" tone="worse" list={findingDiff.added} empty="No new issues." />
              <FindingList title="Still open" tone="" list={findingDiff.remaining} empty="None." />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FindingList({ title, tone, list, empty }) {
  return (
    <div>
      <h4 className={tone ? `delta ${tone}` : ''}>{title} <span className="count">{list.length}</span></h4>
      {list.length ? (
        <ul className="plain">{list.map((f) => <li key={f.id}>{f.title}</li>)}</ul>
      ) : <p className="muted small">{empty}</p>}
    </div>
  );
}
