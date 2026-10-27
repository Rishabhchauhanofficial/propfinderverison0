import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { getProject, listProjects } from '../api/client.js';
import { useAsync } from '../hooks/useUi.js';
import PropertyCard from '../components/PropertyCard.jsx';
import Reviews from '../components/Reviews.jsx';
import { DemoBadge, EmptyState, ErrorState, GridSkeleton, PanelSkeleton, ReraBadge, Reveal } from '../components/ui.jsx';
import { formatDate, formatINR, labelize } from '../utils/format.js';

const STATUS = [['', 'All'], ['pre-launch', 'Pre-launch'], ['under-construction', 'Under construction'], ['ready', 'Ready'], ['completed', 'Completed']];

export function ProjectsPage() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const params = { q: sp.get('q') || '', city: sp.get('city') || '', status: sp.get('status') || '', reraVerified: sp.get('reraVerified') || '' };
  const res = useAsync(() => listProjects({ ...params, limit: 24 }), [sp.toString()]);
  const set = (patch) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setSp(next);
  };

  return (
    <div className="container section">
      <Helmet>
        <title>New residential projects in India | PropFinder</title>
        <meta name="description" content="New launches and under-construction projects with declared possession dates, configurations and RERA registration status." />
      </Helmet>
      <header className="page-head">
        <h1>New projects</h1>
        <p className="muted">Possession dates and specifications are as declared by developers. RERA status shows what PropFinder has verified.</p>
      </header>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() }); }}>
        <input className="input" placeholder="Search project, developer or locality" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" placeholder="City" defaultValue={params.city} onBlur={(e) => set({ city: e.target.value.trim() })} />
        <div className="chip-row">
          {STATUS.map(([v, l]) => (
            <button key={v || 'all'} type="button" className={`chip${params.status === v ? ' is-active' : ''}`} onClick={() => set({ status: v })}>{l}</button>
          ))}
          <label className="check"><input type="checkbox" checked={params.reraVerified === '1'} onChange={(e) => set({ reraVerified: e.target.checked ? '1' : '' })} /> RERA verified</label>
        </div>
        <button className="btn btn--primary" type="submit">Search</button>
      </form>

      {res.status === 'loading' && <GridSkeleton count={3} />}
      {res.status === 'error' && <ErrorState message={res.error} onRetry={res.reload} />}
      {res.status === 'ready' && res.data.items.length === 0 && <EmptyState icon="🏗️" title="No projects match">Try another city or clear the filters.</EmptyState>}
      <div className="project-grid">
        {res.data?.items.map((p, i) => (
          <Reveal key={p.id} delay={(i % 3) * 60}>
            <Link to={`/projects/${p.slug}`} className="project-card">
              <div className="project-card__img" style={p.images?.[0] ? { backgroundImage: `url("${p.images[0]}")` } : undefined} aria-hidden="true" />
              <div className="project-card__body">
                <div className="project-card__top">
                  <strong>{p.name}</strong>
                  {p.isDemo && <DemoBadge small />}
                </div>
                <span className="muted small">{p.developerName || 'Developer not stated'} · {p.locality}, {p.city}</span>
                <span className="small">{p.priceFrom ? `${formatINR(p.priceFrom)} – ${formatINR(p.priceTo)}` : 'Price on request'}</span>
                <span className="small">{labelize(p.status)} · {p.configurations?.join(', ') || '—'} · {p.listings} unit listing{p.listings === 1 ? '' : 's'}</span>
                <span className="project-card__foot">
                  <ReraBadge status={p.rera?.status} small />
                  <span className="tiny muted">Possession (declared): {p.possessionDate ? formatDate(p.possessionDate) : '—'}</span>
                </span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

export function ProjectDetailPage() {
  const { slug } = useParams();
  const res = useAsync(() => getProject(slug), [slug]);
  if (res.status === 'loading') return <div className="container section"><PanelSkeleton lines={6} /></div>;
  if (res.status === 'error') return <div className="container section"><EmptyState icon="🏗️" title="Project unavailable" action={<Link className="btn btn--primary" to="/projects">All projects</Link>}>{res.error}</EmptyState></div>;
  const { project: p, developer, listings, rera, ratingSummary } = res.data;

  return (
    <div className="container detail-page">
      <Helmet>
        <title>{`${p.name}, ${p.locality} ${p.city} | PropFinder`}</title>
        <meta name="description" content={`${p.name} by ${p.developerName} in ${p.locality}, ${p.city}. Configurations, declared possession date and RERA status.`} />
        {p.isDemo && <meta name="robots" content="noindex" />}
      </Helmet>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link><span aria-hidden="true">/</span><Link to="/projects">Projects</Link><span aria-hidden="true">/</span><span>{p.name}</span>
      </nav>
      {p.isDemo && <div className="alert alert--info"><DemoBadge /> Demo project with fictional data, used to illustrate project pages.</div>}

      <div className="project-hero" style={p.images?.[0] ? { backgroundImage: `linear-gradient(180deg, rgba(8,20,44,.1), rgba(8,20,44,.85)), url("${p.images[0]}")` } : undefined}>
        <div>
          <span className="badge badge--muted">{labelize(p.status)}</span> <ReraBadge status={rera.status} />
          <h1>{p.name}</h1>
          <p>{p.developerName} · {p.locality}, {p.city}</p>
        </div>
        <div className="project-hero__price">
          <strong>{p.priceFrom ? `${formatINR(p.priceFrom)} – ${formatINR(p.priceTo)}` : 'Price on request'}</strong>
          <span className="small">{p.configurations?.join(' · ')}</span>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <h2 className="panel__title">Project facts</h2>
            <dl className="specs">
              <div className="spec"><dt>Status</dt><dd>{labelize(p.status)}</dd></div>
              <div className="spec"><dt>Possession (declared by developer)</dt><dd>{p.possessionDate ? formatDate(p.possessionDate) : '—'}</dd></div>
              <div className="spec"><dt>Launch</dt><dd>{p.launchDate ? formatDate(p.launchDate) : '—'}</dd></div>
              <div className="spec"><dt>Total units</dt><dd>{p.totalUnits ?? '—'}</dd></div>
              <div className="spec"><dt>Land area</dt><dd>{p.landAreaSqm ? `${p.landAreaSqm.toLocaleString('en-IN')} sq m` : '—'}</dd></div>
              <div className="spec"><dt>Average rating</dt><dd>{ratingSummary.avg ? `${ratingSummary.avg}★ (${ratingSummary.count})` : 'No reviews yet'}</dd></div>
            </dl>
            {p.description && <p className="prose" style={{ marginTop: 12 }}>{p.description}</p>}
            {p.amenities?.length > 0 && (
              <>
                <h3 className="report__h">Amenities (as stated by the developer)</h3>
                <ul className="amenities">{p.amenities.map((a) => <li key={a}>{a}</li>)}</ul>
              </>
            )}
          </section>

          <section className="panel" id="rera">
            <header className="panel__head"><h2>RERA registration</h2><ReraBadge status={rera.status} /></header>
            <p><strong>{rera.label}</strong>{rera.registrationNumber ? ` — ${rera.registrationNumber}` : ''}</p>
            {rera.authority && <p className="small">Authority: {rera.authority.authority}. <a href={rera.officialUrl} target="_blank" rel="noopener noreferrer">Check on the official portal ↗</a></p>}
            {rera.discrepancies?.length > 0 && <div className="alert alert--warn"><ul>{rera.discrepancies.map((d) => <li key={d}>{d}</li>)}</ul></div>}
            <details className="report__more"><summary>When is RERA registration required?</summary><ul>{rera.applicability.map((a) => <li key={a}>{a}</li>)}</ul></details>
            <p className="disclaimer">{rera.disclaimer}</p>
          </section>

          {developer && (
            <section className="panel">
              <h2 className="panel__title">Developer: {developer.name}</h2>
              {developer.description && <p className="prose">{developer.description}</p>}
              <p className="tiny muted">Developer information is supplied by the developer and has not been independently verified. PropFinder does not rate builders without credible, attributable evidence.</p>
              {developer.otherProjects?.length > 0 && (
                <>
                  <h3 className="report__h">Other projects on PropFinder</h3>
                  <ul className="link-list">{developer.otherProjects.map((o) => <li key={o._id}><Link to={`/projects/${o.slug}`}>{o.name}</Link> <span className="muted small">— {o.locality}, {o.city} · {labelize(o.status)}</span></li>)}</ul>
                </>
              )}
            </section>
          )}

          <section className="section-tight">
            <h2 className="section__title">Units available ({listings.length})</h2>
            {listings.length ? <div className="results-grid">{listings.map((l) => <PropertyCard key={l.id} property={l} />)}</div> : <p className="muted">No unit listings are live right now.</p>}
          </section>

          <Reviews targetType="project" targetId={p.id} title="Resident & buyer reviews" />
        </div>
        <aside className="detail-aside">
          <div className="price-box">
            <div className="price-box__label">Price range (asking)</div>
            <div className="price-box__amount">{p.priceFrom ? formatINR(p.priceFrom) : '—'}</div>
            <div className="muted small">to {p.priceTo ? formatINR(p.priceTo) : '—'}</div>
            <Link className="btn btn--primary btn--block" to={`/buy?project=${p.id}`}>See all units</Link>
          </div>
          <div className="owner-box">
            <strong>Before you book</strong>
            <ul className="small tight-list">
              <li>Verify the RERA number on the state portal</li>
              <li>Compare the declared completion date with the builder’s promise</li>
              <li>Read the builder–buyer agreement with a lawyer</li>
            </ul>
            <Link to="/rera" className="link-btn small">Full due-diligence checklist →</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
