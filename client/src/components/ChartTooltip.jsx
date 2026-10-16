/** Shared Recharts tooltip. `rows(payloadRow, payloadEntries)` returns [label, value, color?] tuples. */
export default function ChartTooltip({ active, payload, label, title, rows }) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  const lines = rows ? rows(datum, payload) : payload.map((p) => [p.name, p.value, p.color]);
  return (
    <div className="chart-tooltip">
      {(title ? title(datum) : label) && <div className="tt-title">{title ? title(datum) : label}</div>}
      {lines.map(([name, value, color]) => (
        <div key={name} className="tt-row">
          {color && <span className="swatch" style={{ background: color }} />}
          <span className="tt-name">{name}</span>
          <span className="tt-value">{value}</span>
        </div>
      ))}
    </div>
  );
}
