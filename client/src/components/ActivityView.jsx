import { Link } from 'react-router-dom';
import { formatINR, labelize } from '../utils/format.js';

const ICON = { view: '👁', save: '♥', unsave: '♡', compare: '⇄', contact: '✉', visit: '📅', search: '🔍', 'saved-search': '🔔' };

const when = (d) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function Chips({ label, items, format = (v) => v }) {
  if (!items?.length) return null;
  return (
    <div className="activity-prefs__row">
      <span className="muted small">{label}</span>
      <span>{items.map((i) => `${format(i.value)} (${i.count})`).join(' · ')}</span>
    </div>
  );
}

/**
 * Last-30-days activity: counts, what they seem to want, saved searches and a timeline.
 * Used for a lister looking at a buyer (forLister) and for the buyer's own profile.
 */
export default function ActivityView({ data, forLister = false }) {
  const s = data.summary || {};
  const p = data.preferences || {};
  const stats = [
    ['Properties viewed', s.propertiesViewed],
    ['Saved', s.saves],
    ['Enquiries', s.enquiries],
    ['Site visits', s.siteVisits],
    ['Compared', s.compares],
    ['Searches', s.searches],
  ];
  return (
    <div className="activity">
      <dl className="activity-stats">
        {stats.map(([label, n]) => (
          <div key={label}><dt>{label}</dt><dd>{n ?? 0}</dd></div>
        ))}
      </dl>
      {forLister && <p className="small">{data.onYourListings || 0} of these actions were on your listings.</p>}

      <h3 className="report__h">What they seem to be looking for</h3>
      <div className="activity-prefs">
        {p.lookingTo && <div className="activity-prefs__row"><span className="muted small">Looking to</span><span>{p.lookingTo}</span></div>}
        <Chips label="Cities" items={p.cities} />
        <Chips label="Localities" items={p.localities} />
        <Chips label="Property types" items={p.propertyTypes} format={labelize} />
        <Chips label="Bedrooms" items={p.bedrooms} format={(v) => `${v} BHK`} />
        {p.budget && (
          <div className="activity-prefs__row">
            <span className="muted small">Typical price viewed</span>
            <span>{formatINR(p.budget.low)} – {formatINR(p.budget.high)} <span className="muted small">(middle half of {p.budget.basedOn} properties)</span></span>
          </div>
        )}
        {!p.cities?.length && !p.propertyTypes?.length && <p className="small muted">Not enough activity yet.</p>}
      </div>

      {data.savedSearches?.length > 0 && (
        <>
          <h3 className="report__h">Saved searches</h3>
          <ul className="small">{data.savedSearches.map((x, i) => <li key={i}>{x.text}</li>)}</ul>
        </>
      )}

      <h3 className="report__h">Timeline</h3>
      {data.timeline?.length ? (
        <ol className="activity-timeline">
          {data.timeline.map((e, i) => (
            <li key={i} className={e.yourListing ? 'is-yours' : undefined}>
              <span aria-hidden="true">{ICON[e.type] || '•'}</span>
              <span>
                {e.property?.slug ? <Link to={`/property/${e.property.slug}`}>{e.text}</Link> : e.text}
              </span>
              <time className="tiny muted" dateTime={e.at}>{when(e.at)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="small muted">No activity in the last {data.windowDays || 30} days.</p>
      )}
      {forLister && (
        <p className="tiny muted">
          Shared by the buyer with their consent{data.since ? ` (since ${new Date(data.since).toLocaleDateString('en-IN')})` : ''}. Activity on other listers&apos; properties is described in general terms only. Kept for 30 days.
        </p>
      )}
    </div>
  );
}
