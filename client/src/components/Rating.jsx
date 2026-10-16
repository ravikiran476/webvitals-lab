import { RATING_LABEL } from '../metrics.js';

const ICON = { good: '●', warn: '▲', poor: '■' };

/** Status pill: color always paired with an icon and a text label. */
export default function Rating({ rating, compact = false }) {
  if (!rating) return <span className="rating none">No data</span>;
  return (
    <span className={`rating ${rating}`}>
      <span aria-hidden="true">{ICON[rating]}</span>
      {compact ? null : ` ${RATING_LABEL[rating]}`}
      {compact && <span className="sr-only">{RATING_LABEL[rating]}</span>}
    </span>
  );
}

export function Delta({ before, after, lowerIsBetter = true, format }) {
  if (before == null || after == null) return <span className="delta muted">—</span>;
  const diff = after - before;
  if (Math.abs(diff) < 1e-9) return <span className="delta muted">no change</span>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const pct = before !== 0 ? ` (${diff > 0 ? '+' : ''}${((diff / Math.abs(before)) * 100).toFixed(0)}%)` : '';
  return (
    <span className={`delta ${better ? 'better' : 'worse'}`}>
      <span aria-hidden="true">{diff > 0 ? '↑' : '↓'}</span>
      {' '}{diff > 0 ? '+' : '−'}{format(Math.abs(diff))}{pct}
      <span className="sr-only">{better ? ' improved' : ' regressed'}</span>
    </span>
  );
}
