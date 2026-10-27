import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { clearRecentlyViewed, deleteSavedSearch, errorMessage, listFavorites, listSavedSearches, myEnquiries, recentlyViewed, touchSavedSearch, updateVisit } from '../api/client.js';
import { useAsync } from '../hooks/useUi.js';
import { useToast } from '../context/ToastContext.jsx';
import PropertyCard from '../components/PropertyCard.jsx';
import { EmptyState, ErrorState, GridSkeleton } from '../components/ui.jsx';
import { formatDate, formatINR, labelize } from '../utils/format.js';

const TABS = [
  ['favorites', 'Shortlist'],
  ['searches', 'Saved searches'],
  ['recent', 'Recently viewed'],
  ['enquiries', 'Enquiries & visits'],
];

function searchHref(params) {
  const p = { ...params };
  const base = p.commercial ? '/commercial' : p.listingType === 'rent' ? '/rent' : '/buy';
  delete p.commercial;
  return `${base}?${new URLSearchParams(p)}`;
}

function describe(params) {
  return Object.entries(params)
    .map(([k, v]) => {
      if (k === 'minPrice') return `from ${formatINR(v)}`;
      if (k === 'maxPrice') return `up to ${formatINR(v)}`;
      if (k === 'bedrooms') return `${v} BHK`;
      if (k === 'listingType') return v === 'rent' ? 'Rent' : 'Buy';
      if (k === 'commercial') return 'Commercial';
      if (['reraVerified', 'verified', 'excludeDemo'].includes(k)) return labelize(k);
      return `${labelize(k)}: ${labelize(v)}`;
    })
    .join(' · ');
}

function Favorites() {
  const res = useAsync(listFavorites, []);
  if (res.status === 'loading') return <GridSkeleton count={3} />;
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data.items.length) return <EmptyState icon="♡" title="No saved properties yet" action={<Link className="btn btn--primary" to="/buy">Start browsing</Link>}>Tap ♡ on any listing to keep it here.</EmptyState>;
  return <div className="results-grid">{res.data.items.map((p) => <PropertyCard key={p.id} property={p} />)}</div>;
}

function Searches() {
  const res = useAsync(listSavedSearches, []);
  const toast = useToast();
  if (res.status === 'loading') return <p className="muted">Loading…</p>;
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data.items.length) return <EmptyState icon="☆" title="No saved searches" action={<Link className="btn btn--primary" to="/buy">Search properties</Link>}>Use “Save search” on any results page to get alerts for new matches.</EmptyState>;
  return (
    <ul className="listing-list">
      {res.data.items.map((s) => (
        <li key={s.id} className="listing-row listing-row--simple">
          <div className="listing-row__info">
            <Link to={searchHref(s.params)} className="listing-row__title" onClick={() => touchSavedSearch(s.id).catch(() => {})}>{s.name}</Link>
            <div className="muted small">{describe(s.params)}</div>
            <div className="listing-row__meta">
              <span>{s.total} matching</span>
              {s.newCount > 0 && <span className="badge badge--good badge--sm">{s.newCount} new since you last looked</span>}
              <span className="muted small">Saved {formatDate(s.createdAt)}</span>
            </div>
          </div>
          <div className="listing-row__actions">
            <label className="check small">
              <input type="checkbox" defaultChecked={s.notify} onChange={(e) => touchSavedSearch(s.id, { notify: e.target.checked }).catch(() => {})} /> Alerts
            </label>
            <button type="button" className="btn btn--danger btn--sm" onClick={async () => { try { await deleteSavedSearch(s.id); res.reload(); } catch (err) { toast.show(errorMessage(err), 'error'); } }}>Delete</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Recent() {
  const res = useAsync(recentlyViewed, []);
  if (res.status === 'loading') return <GridSkeleton count={3} />;
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data.items.length) return <EmptyState icon="🕒" title="Nothing viewed yet">Properties you open while signed in appear here.</EmptyState>;
  return (
    <>
      <div className="btn-row"><button type="button" className="link-btn" onClick={async () => { await clearRecentlyViewed(); res.reload(); }}>Clear history</button></div>
      <div className="results-grid">{res.data.items.map((p) => <PropertyCard key={p.id} property={p} />)}</div>
    </>
  );
}

function Enquiries() {
  const res = useAsync(myEnquiries, []);
  const toast = useToast();
  if (res.status === 'loading') return <p className="muted">Loading…</p>;
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  const { leads, visits } = res.data;
  return (
    <div className="two-col">
      <section className="panel">
        <h2 className="panel__title">My enquiries</h2>
        {!leads.length && <p className="muted">You haven’t contacted any lister yet.</p>}
        <ul className="link-list">
          {leads.map((l) => (
            <li key={l._id}>
              {l.property ? <Link to={`/property/${l.property.slug || l.property._id}`}>{l.property.title}</Link> : 'Listing removed'}
              <span className="small muted"> · {formatDate(l.createdAt)} · {labelize(l.status)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2 className="panel__title">Site visits</h2>
        {!visits.length && <p className="muted">No visits requested.</p>}
        <ul className="link-list">
          {visits.map((v) => (
            <li key={v._id}>
              {v.property ? <Link to={`/property/${v.property.slug || v.property._id}`}>{v.property.title}</Link> : 'Listing removed'}
              <span className="small muted"> · {new Date(v.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span className={`status-pill status-pill--${v.status}`}>{labelize(v.status)}</span>
              {['requested', 'confirmed'].includes(v.status) && (
                <button type="button" className="link-btn small" onClick={async () => { try { await updateVisit(v._id, { status: 'cancelled' }); res.reload(); } catch (err) { toast.show(errorMessage(err), 'error'); } }}>Cancel</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function SavedPage() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'favorites';
  return (
    <div className="container section">
      <Helmet><title>Saved | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
      <header className="page-head"><h1>Saved</h1></header>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' is-active' : ''}`} onClick={() => setSp({ tab: k })}>{l}</button>
        ))}
      </div>
      <div className="tab-panel">
        {tab === 'favorites' && <Favorites />}
        {tab === 'searches' && <Searches />}
        {tab === 'recent' && <Recent />}
        {tab === 'enquiries' && <Enquiries />}
      </div>
    </div>
  );
}
