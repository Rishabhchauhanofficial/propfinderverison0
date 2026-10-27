import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { errorMessage, getLocalities, getStats, listProjects, listProperties } from '../api/client.js';
import PropertyCard from '../components/PropertyCard.jsx';
import SearchBox from '../components/SearchBox.jsx';
import { DemoBadge, ErrorState, GridSkeleton, Reveal } from '../components/ui.jsx';
import { useCountUp, useParallax } from '../hooks/useUi.js';
import { useChat } from '../context/ChatContext.jsx';
import { PROPERTY_TYPES } from '../utils/constants.js';
import { formatDate, formatINR, formatPerSqft } from '../utils/format.js';

const TABS = [
  { key: 'buy', label: 'Buy', path: '/buy' },
  { key: 'rent', label: 'Rent', path: '/rent' },
  { key: 'commercial', label: 'Commercial', path: '/commercial' },
  { key: 'projects', label: 'New projects', path: '/projects' },
];

const TYPE_TILES = [
  { value: 'apartment', label: 'Apartments', icon: '🏢' },
  { value: 'independent-house', label: 'Houses', icon: '🏠' },
  { value: 'villa', label: 'Villas', icon: '🏡' },
  { value: 'builder-floor', label: 'Builder floors', icon: '🏘️' },
  { value: 'plot', label: 'Plots / Land', icon: '📐' },
  { value: 'office', label: 'Offices', icon: '💼', path: '/commercial' },
  { value: 'retail-shop', label: 'Shops', icon: '🏬', path: '/commercial' },
  { value: 'commercial', label: 'Commercial', icon: '🏗️', path: '/commercial' },
];

const toList = (data) => (Array.isArray(data) ? data : data?.items ?? []);

function Counter({ value, label, suffix = '' }) {
  const [n, ref] = useCountUp(value);
  return (
    <div className="stat" ref={ref}>
      <strong>{value == null ? '—' : `${n.toLocaleString('en-IN')}${suffix}`}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { ask } = useChat();
  const parallax = useParallax(0.3);
  const [tab, setTab] = useState('buy');
  const [propertyType, setPropertyType] = useState('');
  const [query, setQuery] = useState('');

  const [stats, setStats] = useState(null);
  const [localities, setLocalities] = useState({ status: 'loading', items: [], error: '' });
  const [featured, setFeatured] = useState({ status: 'loading', items: [], error: '' });
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getStats().then((s) => !cancelled && setStats(s)).catch(() => {});
    getLocalities()
      .then((data) => !cancelled && setLocalities({ status: 'ready', items: toList(data).slice(0, 8), error: '' }))
      .catch((err) => !cancelled && setLocalities({ status: 'error', items: [], error: errorMessage(err) }));
    listProperties({ sort: 'newest', limit: 8 })
      .then((data) => !cancelled && setFeatured({ status: 'ready', items: toList(data), error: '' }))
      .catch((err) => !cancelled && setFeatured({ status: 'error', items: [], error: errorMessage(err) }));
    listProjects({ limit: 3 }).then((d) => !cancelled && setProjects(d.items || [])).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const base = TABS.find((t) => t.key === tab);

  function go(extra = {}) {
    const params = new URLSearchParams();
    if (propertyType && tab !== 'projects') params.set('propertyType', propertyType);
    for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
    navigate(`${base.path}${params.toString() ? `?${params}` : ''}`);
  }

  function handleSearch(e) {
    e?.preventDefault();
    if (tab === 'projects') return navigate(`/projects${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
    go({ q: query.trim() });
  }

  return (
    <>
      <Helmet>
        <title>PropFinder — Buy, Rent & Verify Property in India with AI Insights</title>
        <meta name="description" content="Search homes, plots, offices and new projects across India. Every listing gets an AI property report with nearby schools, metro, hospitals, price vs comparable listings and RERA status." />
      </Helmet>

      <section className="hero hero--v2">
        <div className="hero__bg" style={{ transform: `translate3d(0, ${parallax}px, 0)` }} aria-hidden="true" />
        <div className="container hero__inner">
          <p className="hero__eyebrow">AI-powered property intelligence for India</p>
          <h1 className="hero__title">
            Find a home you can <span>trust</span>
          </h1>
          <p className="hero__sub">Search listings, then see the evidence: nearby facilities from map data, price vs comparable listings, RERA registration status and moderated reviews.</p>

          <form className="search-box" onSubmit={handleSearch} role="search">
            <div className="seg seg--tabs" role="tablist" aria-label="Search type">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`seg__btn${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="search-box__fields">
              <div className="search-box__field search-box__field--grow">
                <span className="sr-only">City, locality, PIN code or project</span>
                <SearchBox
                  value={query}
                  onChange={setQuery}
                  placeholder="City, locality, PIN code or project — e.g. Whitefield, 560034"
                  onPick={(it) => (it.href ? navigate(it.href) : go(it.params))}
                  onSubmit={() => handleSearch()}
                />
              </div>
              {tab !== 'projects' && (
                <label className="search-box__field">
                  <span className="sr-only">Property type</span>
                  <select className="select select--lg" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                    <option value="">All property types</option>
                    {PROPERTY_TYPES.filter((t) => (tab === 'commercial' ? ['commercial', 'office', 'retail-shop'].includes(t.value) : true)).map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="submit" className="btn btn--accent btn--lg">Search</button>
            </div>
          </form>

          <div className="hero__ai">
            <span>Or just ask:</span>
            {['3 BHK in Gurgaon under ₹4 crore', 'What should I check before paying a booking amount?'].map((q) => (
              <button key={q} type="button" className="hero__ai-chip" onClick={() => ask(q)}>
                “{q}”
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="stats-strip">
        <div className="container stats-strip__inner">
          <Counter value={stats?.listings} label="Active listings" />
          <Counter value={stats?.localities} label="Localities covered" />
          <Counter value={stats?.projects} label="New projects" />
          <Counter value={stats?.verifiedRera} label="RERA-verified listings" />
        </div>
        {stats?.demoListings > 0 && (
          <p className="container tiny muted stats-strip__note">
            <DemoBadge small /> {stats.demoListings} of {stats.listings} listings are demo data used to illustrate the platform.
          </p>
        )}
      </div>

      <section className="container section">
        <Reveal className="section__head">
          <h2 className="section__title">Explore by property type</h2>
        </Reveal>
        <div className="type-grid">
          {TYPE_TILES.map((t, i) => (
            <Reveal key={t.value} delay={i * 40}>
              <Link to={`${t.path || '/buy'}?propertyType=${t.value}`} className="type-tile">
                <span className="type-tile__icon" aria-hidden="true">{t.icon}</span>
                <span className="type-tile__label">{t.label}</span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="how">
        <div className="container">
          <Reveal className="section__head section__head--center">
            <h2 className="section__title">Evidence, not hype</h2>
            <p className="muted">Every listing gets a transparent AI Property Intelligence Report.</p>
          </Reveal>
          <div className="how__grid">
            {[
              ['🗺️', 'Real nearby data', 'Schools, hospitals, metro, markets and more from OpenStreetMap, with distances — clearly marked as straight-line.'],
              ['📊', 'Price vs comparables', 'Asking price per sq ft against similar active listings, with sample size. No fake valuations when data is thin.'],
              ['🛡️', 'RERA transparency', 'Registration numbers checked against the right state authority, with evidence, dates and any mismatches.'],
              ['⭐', 'Moderated reviews', 'Ratings for maintenance, construction and connectivity. Listers can reply but never delete reviews.'],
            ].map(([icon, h, p], i) => (
              <Reveal key={h} className="how__card" delay={i * 80}>
                <span className="how__icon" aria-hidden="true">{icon}</span>
                <h3>{h}</h3>
                <p className="muted">{p}</p>
              </Reveal>
            ))}
          </div>
          <p className="center small"><Link to="/methodology">How the scores are calculated →</Link></p>
        </div>
      </section>

      <section className="container section">
        <Reveal className="section__head">
          <h2 className="section__title">Fresh listings</h2>
          <Link to="/buy" className="link-btn">View all</Link>
        </Reveal>
        {featured.status === 'loading' && <GridSkeleton count={4} />}
        {featured.status === 'error' && <ErrorState message={featured.error} />}
        {featured.status === 'ready' && featured.items.length === 0 && <p className="muted">No listings yet. Be the first to <Link to="/post">post a property</Link>.</p>}
        <div className="results-grid">
          {featured.items.map((p, i) => (
            <Reveal key={p.id || p._id} delay={(i % 4) * 60}>
              <PropertyCard property={p} />
            </Reveal>
          ))}
        </div>
      </section>

      {projects.length > 0 && (
        <section className="container section">
          <Reveal className="section__head">
            <h2 className="section__title">New projects</h2>
            <Link to="/projects" className="link-btn">All projects</Link>
          </Reveal>
          <div className="project-grid">
            {projects.map((p, i) => (
              <Reveal key={p.id} delay={i * 80}>
                <Link to={`/projects/${p.slug}`} className="project-card">
                  <div className="project-card__img" style={p.images?.[0] ? { backgroundImage: `url("${p.images[0]}")` } : undefined} aria-hidden="true" />
                  <div className="project-card__body">
                    <div className="project-card__top">
                      <strong>{p.name}</strong>
                      {p.isDemo && <DemoBadge small />}
                    </div>
                    <span className="muted small">{p.developerName} · {p.locality}, {p.city}</span>
                    <span className="small">{p.priceFrom ? `${formatINR(p.priceFrom)} – ${formatINR(p.priceTo)}` : 'Price on request'} · {p.configurations?.join(', ')}</span>
                    <span className="tiny muted">Possession (declared): {p.possessionDate ? formatDate(p.possessionDate) : '—'}</span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <section className="container section">
        <Reveal className="section__head">
          <h2 className="section__title">Popular localities</h2>
        </Reveal>
        {localities.status === 'error' && <ErrorState message={localities.error} />}
        <div className="locality-grid">
          {localities.items.map((l, i) => {
            const href = `/locality/${encodeURIComponent(l.city)}/${encodeURIComponent(l.locality)}`;
            const avg = formatPerSqft(l.avgPricePerSqft);
            return (
              <Reveal key={`${l.city}-${l.locality}`} delay={(i % 4) * 50}>
                <Link to={href} className="locality-card">
                  <div className="locality-card__img" style={l.sampleImage ? { backgroundImage: `url("${l.sampleImage}")` } : undefined} aria-hidden="true" />
                  <div className="locality-card__body">
                    <strong>{l.locality}</strong>
                    <span className="muted">{l.city}</span>
                    <span className="locality-card__meta">{l.count} listings{avg ? ` · avg asking ${avg}` : ''}</span>
                  </div>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="cta-band">
        <div className="container cta-band__inner">
          <div>
            <h2>Owner, agent or builder?</h2>
            <p>List for free, add your RERA details for verification, and manage leads and site visits from one dashboard.</p>
          </div>
          <Link to="/post" className="btn btn--accent btn--lg">Post property — it's free</Link>
        </div>
      </section>
    </>
  );
}
