import { Link, useLocation } from 'react-router-dom';
import { useShortlist } from '../context/ShortlistContext.jsx';
import { formatINR } from '../utils/format.js';

/** Floating bar showing the compare list; hidden on the compare page itself. */
export default function CompareTray() {
  const { compare, toggleCompare, clearCompare, maxCompare } = useShortlist();
  const { pathname } = useLocation();
  if (!compare.length || pathname.startsWith('/compare')) return null;

  return (
    <aside className="compare-tray" aria-label="Compare list">
      <div className="compare-tray__items">
        {compare.map((p) => (
          <div key={p.id} className="compare-tray__item">
            {p.image ? <img src={p.image} alt="" /> : <span className="compare-tray__ph" />}
            <span className="compare-tray__text">
              <span className="compare-tray__title">{p.title}</span>
              <span className="small muted">{formatINR(p.price, p.listingType)}</span>
            </span>
            <button type="button" className="compare-tray__x" aria-label={`Remove ${p.title}`} onClick={() => toggleCompare(p)}>
              ×
            </button>
          </div>
        ))}
        {compare.length < maxCompare && <span className="compare-tray__hint small muted">Add up to {maxCompare - compare.length} more</span>}
      </div>
      <div className="compare-tray__actions">
        <button type="button" className="link-btn" onClick={clearCompare}>Clear</button>
        {compare.length >= 2 ? (
          <Link className="btn btn--primary btn--sm" to={`/compare?ids=${compare.map((p) => p.id).join(',')}`}>
            Compare {compare.length}
          </Link>
        ) : (
          <span className="btn btn--outline btn--sm is-disabled" aria-disabled="true">Pick 1 more</span>
        )}
      </div>
    </aside>
  );
}
