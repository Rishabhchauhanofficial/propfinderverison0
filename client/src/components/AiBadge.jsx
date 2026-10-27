import { clamp } from '../utils/format.js';

/** Circular score gauge, 0-100. A null score renders as "—" (no data), never as zero. */
export function ScoreGauge({ score, label, size = 'md' }) {
  const hasValue = score !== null && score !== undefined && Number.isFinite(Number(score));
  const value = hasValue ? clamp(Math.round(Number(score)), 0, 100) : 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const tone = !hasValue ? 'none' : value >= 70 ? 'good' : value >= 45 ? 'warn' : 'bad';

  return (
    <div className={`gauge gauge--${tone} gauge--${size}`}>
      <svg viewBox="0 0 100 100" role="img" aria-label={hasValue ? `Score ${value} out of 100` : 'No score: insufficient data'}>
        <circle className="gauge__track" cx="50" cy="50" r={radius} />
        {hasValue && (
          <circle
            className="gauge__value"
            cx="50"
            cy="50"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 50 50)"
          />
        )}
      </svg>
      <div className="gauge__center">
        <strong>{hasValue ? value : '—'}</strong>
        <span>{hasValue ? '/100' : 'no data'}</span>
      </div>
      {label ? <div className="gauge__label">{label}</div> : null}
    </div>
  );
}

const VERDICTS = {
  'below-market': ['good', 'Below comparable listings'],
  'near-market': ['info', 'Near comparable listings'],
  'above-market': ['bad', 'Above comparable listings'],
  'insufficient-data': ['muted', 'Not enough comparables'],
  // v1 values
  fair: ['info', 'Near comparable listings'],
};

/** Price-position verdict pill. */
export function FairnessBadge({ verdict }) {
  const v = VERDICTS[String(verdict || '').toLowerCase()];
  if (!v) return null;
  return <span className={`verdict verdict--${v[0]}`}>{v[1]}</span>;
}

/** Shows whether text came from rules or an LLM. */
export function SourceTag({ source }) {
  if (!source) return null;
  const text = String(source).toLowerCase() === 'llm' ? 'AI-written from the data below' : 'Rule-based from the data below';
  return <span className="source-tag">{text}</span>;
}
