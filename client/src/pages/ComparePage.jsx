import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { compareProperties, errorMessage } from '../api/client.js';
import { useShortlist } from '../context/ShortlistContext.jsx';
import { Markdown } from '../components/chat/ChatPanel.jsx';
import { ConfidencePill, DemoBadge, EmptyState, PanelSkeleton, ReraBadge } from '../components/ui.jsx';
import { SourceTag } from '../components/AiBadge.jsx';
import { formatArea, formatINR, labelize } from '../utils/format.js';
import { PRIORITIES } from '../utils/constants.js';

const nearest = (r, key) => {
  const c = r.nearby?.categories?.[key];
  if (!c) return r.nearby?.status === 'pending' ? 'Fetching…' : 'No data';
  return c.nearestKm != null ? `${c.nearestKm} km${c.nearest[0]?.name ? ` (${c.nearest[0].name})` : ''}` : `None within ${r.nearby.meta?.[key]?.radiusKm} km`;
};

export default function ComparePage() {
  const [sp, setSp] = useSearchParams();
  const { compare, toggleCompare } = useShortlist();
  const ids = useMemo(() => (sp.get('ids') || compare.map((c) => c.id).join(',')).split(',').filter(Boolean).slice(0, 4), [sp, compare]);
  const [priorities, setPriorities] = useState([]);
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });

  useEffect(() => {
    if (ids.length < 2) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    compareProperties(ids, priorities)
      .then((data) => !cancelled && setState({ status: 'ready', data, error: '' }))
      .catch((err) => !cancelled && setState({ status: 'error', data: null, error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [ids.join(','), priorities.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ids.length < 2) {
    return (
      <div className="container section">
        <Helmet><title>Compare properties | PropFinder</title></Helmet>
        <EmptyState icon="⇄" title="Pick at least two properties to compare" action={<Link className="btn btn--primary" to="/buy">Browse listings</Link>}>
          Use the ⇄ button on any listing to add it to your compare list (up to 4).
        </EmptyState>
      </div>
    );
  }

  const items = state.data?.items || [];
  const leaders = state.data?.leaders || {};
  const isLeader = (key, id) => leaders[key]?.ids.includes(id) && leaders[key].ids.length < items.length;

  const rows = [
    ['Price', (it) => formatINR(it.property.price, it.property.listingType)],
    ['Price per sq ft', (it) => (it.property.pricePerSqft ? `₹${it.property.pricePerSqft.toLocaleString('en-IN')}` : '—')],
    ['vs comparable listings', (it) => { const p = it.report.price.position; return p.verdict === 'insufficient-data' ? `Too few comparables (${p.sampleSize})` : `${p.deltaPct > 0 ? '+' : ''}${p.deltaPct}% (${p.sampleSize} comps)`; }],
    ['Built-up area', (it) => formatArea(it.property.areaSqft)],
    ['Carpet area', (it) => (it.property.carpetAreaSqft ? formatArea(it.property.carpetAreaSqft) : 'Not disclosed')],
    ['Bedrooms / baths', (it) => `${it.property.bedrooms || '—'} / ${it.property.bathrooms || '—'}`],
    ['Floor', (it) => (it.property.floor != null ? `${it.property.floor} of ${it.property.totalFloors || '?'}` : '—')],
    ['Furnishing', (it) => labelize(it.property.furnishing)],
    ['Age', (it) => (it.property.ageYears != null ? `${it.property.ageYears} yrs` : '—')],
    ['Status', (it) => (it.property.constructionStatus === 'under-construction' ? 'Under construction' : it.property.constructionStatus === 'ready' ? 'Ready to move' : '—')],
    ['RERA', (it) => <ReraBadge status={it.report.rera.status} small />],
    ['Nearest metro', (it) => nearest(it.report, 'metro')],
    ['Nearest school', (it) => nearest(it.report, 'school')],
    ['Nearest hospital', (it) => nearest(it.report, 'hospital')],
    ['Nearest supermarket', (it) => nearest(it.report, 'supermarket')],
    ['Maintenance', (it) => (it.property.maintenanceMonthly ? `${formatINR(it.property.maintenanceMonthly)}/mo` : '—')],
    ['Rental estimate', (it) => (it.report.rental?.grossYieldPct != null ? `${formatINR(it.report.rental.estimateMonthly)}/mo · ${it.report.rental.grossYieldPct}% gross` : it.report.rental?.applicable === false ? 'N/A' : 'Insufficient data')],
    ['Amenities', (it) => `${it.property.amenities?.length || 0} listed`],
  ];

  return (
    <div className="container section">
      <Helmet><title>Compare properties | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
      <header className="page-head page-head--row">
        <div>
          <h1>Compare properties</h1>
          <p className="muted">Pick what matters to you — the overall score re-weights. Leaders are highlighted only where at least two properties have data.</p>
        </div>
      </header>
      <div className="prio">
        <span className="small">My priorities:</span>
        {PRIORITIES.map((p) => {
          const on = priorities.includes(p.value);
          return <button key={p.value} type="button" title={p.hint} className={`chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => setPriorities((prev) => (on ? prev.filter((x) => x !== p.value) : [...prev, p.value]))}>{p.label}</button>;
        })}
      </div>

      {state.status === 'loading' && !items.length && <PanelSkeleton lines={8} />}
      {state.status === 'error' && <p className="alert alert--error">{state.error}</p>}

      {items.length > 0 && (
        <>
          <section className="panel compare-summary">
            <header className="panel__head"><h2>AI comparison</h2><SourceTag source={state.data.summary.source} /></header>
            <Markdown text={state.data.summary.text} />
          </section>

          <div className="table-wrap compare-table-wrap">
            <table className="table compare-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Attribute</span></th>
                  {items.map((it) => (
                    <th key={it.property._id} scope="col">
                      <Link to={`/property/${it.property.slug || it.property._id}`} className="compare-head">
                        {it.property.images?.[0] && <img src={it.property.images[0]} alt="" loading="lazy" />}
                        <span>{it.property.title}</span>
                      </Link>
                      {it.property.isDemo && <DemoBadge small />}
                      <button type="button" className="link-btn tiny" onClick={() => { toggleCompare({ ...it.property, id: it.property._id }); setSp(new URLSearchParams({ ids: ids.filter((x) => x !== it.property._id).join(',') })); }}>Remove</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="compare-overall">
                  <th scope="row">Overall for you</th>
                  {items.map((it) => (
                    <td key={it.property._id}>
                      <strong className="big">{it.personalized.overall.value ?? '—'}</strong>
                      <ConfidencePill level={it.personalized.overall.confidence} />
                    </td>
                  ))}
                </tr>
                {items[0].report.scores.map((s0) => (
                  <tr key={s0.key}>
                    <th scope="row">{s0.label}</th>
                    {items.map((it) => {
                      const s = it.report.scores.find((x) => x.key === s0.key);
                      return (
                        <td key={it.property._id} className={isLeader(s0.key, String(it.property._id)) ? 'is-leader' : ''}>
                          {s.notApplicable ? 'N/A' : s.value ?? '—'} <ConfidencePill level={s.notApplicable ? null : s.confidence} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.map(([label, fn]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {items.map((it) => <td key={it.property._id}>{fn(it)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="disclaimer">Scores are estimates built from listed data, map data and comparable asking prices. They are not a recommendation for everyone and do not assess legal title or construction quality.</p>
        </>
      )}
    </div>
  );
}
