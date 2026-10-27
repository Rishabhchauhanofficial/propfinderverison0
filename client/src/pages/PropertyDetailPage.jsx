import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { errorMessage, getMarketing, getProperty } from '../api/client.js';
import PropertyCard from '../components/PropertyCard.jsx';
import IntelligenceReport from '../components/report/IntelligenceReport.jsx';
import ReraPanel from '../components/report/ReraPanel.jsx';
import Reviews from '../components/Reviews.jsx';
import ContactPanel from '../components/ContactPanel.jsx';
import ReportDialog from '../components/ReportDialog.jsx';
import { DemoBadge, EmptyState, PanelSkeleton, ReraBadge, Skeleton } from '../components/ui.jsx';
import { SourceTag } from '../components/AiBadge.jsx';
import { useShortlist } from '../context/ShortlistContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { formatArea, formatDate, formatFullINR, formatINR, formatPerSqft, labelize, propertyId } from '../utils/format.js';
import { FURNISHING_OPTIONS } from '../utils/constants.js';

function jsonLd(p, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: p.title,
    description: (p.description || '').slice(0, 300),
    url,
    image: p.images ?? [],
    datePosted: p.createdAt,
    offers: { '@type': 'Offer', price: p.price, priceCurrency: 'INR', availability: p.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' },
    address: { '@type': 'PostalAddress', streetAddress: p.address || undefined, addressLocality: p.locality, addressRegion: p.state || p.city, postalCode: p.pinCode || undefined, addressCountry: 'IN' },
    ...(p.location?.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: p.location.lat, longitude: p.location.lng } } : {}),
  };
}

function Gallery({ images, title, isDemo }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const touch = useRef(null);
  const n = images.length;
  const go = useCallback((d) => setActive((a) => (a + d + n) % n), [n]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'Escape') setLightbox(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, go]);

  if (!n) {
    return (
      <div className="gallery">
        <div className="gallery__main"><div className="prop-card__placeholder">No photos yet</div></div>
      </div>
    );
  }

  return (
    <div className="gallery">
      <div
        className="gallery__main"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touch.current ?? 0);
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
      >
        {images.map((src, i) => (
          <img key={src + i} src={src} alt={`${title}, photo ${i + 1} of ${n}`} className={`gallery__img${i === active ? ' is-active' : ''}`} loading={i === 0 ? 'eager' : 'lazy'} onClick={() => setLightbox(true)} />
        ))}
        {n > 1 && (
          <>
            <button type="button" className="gallery__nav gallery__nav--prev" aria-label="Previous photo" onClick={() => go(-1)}>‹</button>
            <button type="button" className="gallery__nav gallery__nav--next" aria-label="Next photo" onClick={() => go(1)}>›</button>
          </>
        )}
        <span className="gallery__count">{active + 1} / {n}{isDemo ? ' · demo placeholder photos' : ''}</span>
      </div>
      {n > 1 && (
        <div className="gallery__thumbs">
          {images.map((src, i) => (
            <button key={`${src}-${i}`} type="button" className={`gallery__thumb${i === active ? ' is-active' : ''}`} onClick={() => setActive(i)} aria-label={`Show photo ${i + 1}`}>
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {lightbox && (
        <div className="lightbox" role="dialog" aria-label="Photo viewer" onClick={() => setLightbox(false)}>
          <img src={images[active]} alt={`${title}, photo ${active + 1}`} onClick={(e) => e.stopPropagation()} />
          <button type="button" className="lightbox__close" aria-label="Close">×</button>
        </div>
      )}
    </div>
  );
}

function MarketingPanel({ id }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  async function run() {
    setState({ status: 'loading', data: null, error: '' });
    try {
      setState({ status: 'ready', data: await getMarketing(id), error: '' });
    } catch (err) {
      setState({ status: 'error', data: null, error: errorMessage(err) });
    }
  }
  const d = state.data;
  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Listing marketing (only you see this)</h2>
        {d && <SourceTag source={d.source === 'heuristic' ? 'rules' : d.source} />}
      </header>
      <p className="small muted">Generate an SEO title, meta description, keywords and a social caption from your listing facts.</p>
      <button type="button" className="btn btn--outline btn--sm" onClick={run} disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Writing…' : d ? 'Regenerate' : 'Generate copy'}</button>
      {state.error && <p className="field-error">{state.error}</p>}
      {d && (
        <div className="marketing">
          <div className="mk-field"><span className="mk-label">SEO title</span><p>{d.seoTitle}</p></div>
          <div className="mk-field"><span className="mk-label">Meta description</span><p>{d.metaDescription}</p></div>
          <div className="mk-field"><span className="mk-label">Keywords</span><div className="keywords">{d.keywords.map((k) => <span key={k} className="keyword">{k}</span>)}</div></div>
          <div className="mk-field">
            <div className="mk-label-row">
              <span className="mk-label">Social caption</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigator.clipboard?.writeText(d.socialCaption)}>Copy</button>
            </div>
            <p className="mk-caption">{d.socialCaption}</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default function PropertyDetailPage() {
  const { id } = useParams();
  const [state, setState] = useState({ status: 'loading', property: null, related: [], error: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const { isFavorite, toggleFavorite, inCompare, toggleCompare } = useShortlist();
  const { setContextProperty, ask } = useChat();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', property: null, related: [], error: '' });
    getProperty(id)
      .then((data) => !cancelled && setState({ status: 'ready', property: data.property ?? data, related: data.related ?? [], error: '' }))
      .catch((err) => {
        if (cancelled) return;
        const message = err?.response?.status === 404 ? 'This property does not exist or has been removed.' : errorMessage(err, 'Could not load this property.');
        setState({ status: 'error', property: null, related: [], error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const property = state.property;
  const pid = property ? String(propertyId(property)) : null;

  useEffect(() => {
    if (!property) return undefined;
    setContextProperty({ id: pid, title: property.title });
    return () => setContextProperty(null);
  }, [pid, property, setContextProperty]);

  if (state.status === 'loading') {
    return (
      <div className="container detail-page">
        <Skeleton w="40%" h={14} />
        <div className="detail-grid" style={{ marginTop: 16 }}>
          <div className="detail-main">
            <div className="gallery"><div className="gallery__main skeleton" /></div>
            <PanelSkeleton lines={4} />
          </div>
          <aside className="detail-aside"><PanelSkeleton lines={3} /></aside>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="container section">
        <EmptyState icon="🏚️" title="Property unavailable" action={<><button type="button" className="btn btn--outline" onClick={() => setReloadKey((k) => k + 1)}>Try again</button><Link to="/buy" className="btn btn--primary">Browse properties</Link></>}>
          {state.error}
        </EmptyState>
      </div>
    );
  }

  const { related } = state;
  const isRent = property.listingType === 'rent';
  const images = property.images ?? [];
  const amenities = property.amenities ?? [];
  const ppsf = !isRent ? formatPerSqft(property.pricePerSqft) : null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/property/${property.slug || pid}`;
  const metaDescription = (property.description || `${property.title} in ${property.locality}, ${property.city}.`).slice(0, 160);
  const saved = isFavorite(pid);
  const comparing = inCompare(pid);

  const specs = [
    { label: 'Property type', value: labelize(property.propertyType) },
    { label: 'Transaction', value: isRent ? 'Rent' : 'Sale' },
    { label: 'Bedrooms', value: property.bedrooms ? `${property.bedrooms} BHK` : '—' },
    { label: 'Bathrooms', value: property.bathrooms || '—' },
    { label: property.propertyType === 'plot' ? 'Plot area' : 'Built-up area', value: formatArea(property.areaSqft) },
    { label: 'Carpet area', value: property.carpetAreaSqft ? formatArea(property.carpetAreaSqft) : 'Not disclosed' },
    { label: 'Furnishing', value: FURNISHING_OPTIONS.find((f) => f.value === property.furnishing)?.label || '—' },
    { label: 'Floor', value: property.floor != null ? `${property.floor}${property.totalFloors ? ` of ${property.totalFloors}` : ''}` : '—' },
    { label: 'Status', value: property.constructionStatus === 'under-construction' ? `Under construction${property.possessionDate ? ` · possession ${formatDate(property.possessionDate)} (as declared)` : ''}` : property.constructionStatus === 'ready' ? 'Ready to move' : '—' },
    { label: 'Property age', value: property.ageYears != null ? `${property.ageYears} yr${property.ageYears === 1 ? '' : 's'}` : '—' },
    { label: 'Maintenance', value: property.maintenanceMonthly ? `${formatINR(property.maintenanceMonthly)}/month (as stated)` : '—' },
    ...(isRent ? [{ label: 'Security deposit', value: property.securityDeposit ? formatINR(property.securityDeposit) : '—' }] : []),
    { label: 'Posted', value: formatDate(property.createdAt) || '—' },
    { label: 'Views', value: (property.views ?? 0).toLocaleString('en-IN') },
  ];

  return (
    <div className="container detail-page">
      <Helmet>
        <title>{`${property.title} | PropFinder`}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={property.title} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="website" />
        {images[0] && <meta property="og:image" content={images[0]} />}
        {property.isDemo && <meta name="robots" content="noindex" />}
        <script type="application/ld+json">{JSON.stringify(jsonLd(property, url))}</script>
      </Helmet>

      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/${isRent ? 'rent' : 'buy'}?city=${encodeURIComponent(property.city)}`}>{property.city}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/locality/${encodeURIComponent(property.city)}/${encodeURIComponent(property.locality)}`}>{property.locality}</Link>
      </nav>

      {property.isDemo && (
        <div className="alert alert--info demo-banner">
          <DemoBadge /> This is a <strong>demo listing</strong> with illustrative data and placeholder photos. It is not a real property for {isRent ? 'rent' : 'sale'}.
        </div>
      )}
      {property.isOwner && property.status !== 'active' && (
        <div className="alert alert--warn">This listing is <strong>{property.status}</strong> and not visible to the public. <Link to={`/property/${pid}/edit`}>Edit</Link> or publish it from your dashboard.</div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <Gallery key={pid} images={images} title={property.title} isDemo={property.isDemo} />

          <header className="detail__head">
            <div className="detail__tags">
              <span className={`prop-card__tag ${isRent ? 'tag--rent' : 'tag--sale'}`}>{isRent ? 'For Rent' : 'For Sale'}</span>
              {property.status && property.status !== 'active' && <span className="status-pill">{labelize(property.status)}</span>}
              {property.listingVerified && <span className="badge badge--good">Checked by PropFinder</span>}
              <ReraBadge status={property.rera?.status} />
            </div>
            <h1 className="detail__title">{property.title}</h1>
            <p className="detail__loc">{[...new Set([property.address, property.locality, property.city, property.pinCode].filter(Boolean).flatMap((x) => String(x).split(',').map((t) => t.trim())))].join(', ')}</p>
            {property.project && (
              <p className="small">Part of <Link to={`/projects/${property.project.slug}`}>{property.project.name}</Link>{property.developerName ? ` by ${property.developerName}` : ''}</p>
            )}
            <div className="detail__actions">
              <button type="button" className={`btn btn--outline btn--sm${saved ? ' is-on' : ''}`} aria-pressed={saved} onClick={() => toggleFavorite(pid)}>{saved ? '♥ Saved' : '♡ Save'}</button>
              <button type="button" className={`btn btn--outline btn--sm${comparing ? ' is-on' : ''}`} aria-pressed={comparing} onClick={() => toggleCompare(property)}>{comparing ? '⇄ In compare' : '⇄ Compare'}</button>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => ask('Summarise the pros and cons of this property')}>💬 Ask AI about this</button>
              {property.isOwner && <Link className="btn btn--outline btn--sm" to={`/property/${pid}/edit`}>Edit listing</Link>}
              {!property.isOwner && <button type="button" className="link-btn small" onClick={() => setReportOpen(true)}>Report listing</button>}
            </div>
          </header>

          <section className="panel" aria-labelledby="overview-title">
            <h2 id="overview-title" className="panel__title">Overview</h2>
            <dl className="specs">
              {specs.map((s) => (
                <div key={s.label} className="spec"><dt>{s.label}</dt><dd>{s.value}</dd></div>
              ))}
            </dl>
          </section>

          <section className="panel" aria-labelledby="desc-title">
            <h2 id="desc-title" className="panel__title">About this property</h2>
            <p className="prose">{property.description || 'No description provided.'}</p>
            <p className="tiny muted">Description provided by the lister — not verified by PropFinder.</p>
          </section>

          {amenities.length > 0 && (
            <section className="panel" aria-labelledby="amenity-title">
              <h2 id="amenity-title" className="panel__title">Amenities (as listed)</h2>
              <ul className="amenities">{amenities.map((a) => <li key={a}>{a}</li>)}</ul>
            </section>
          )}

          <IntelligenceReport propertyId={pid} property={property} />

          <ReraPanel propertyId={pid} isOwner={property.isOwner} />

          <Reviews targetType="property" targetId={pid} canReply={property.isOwner} />

          {property.isOwner && <MarketingPanel id={pid} />}

          {related.length > 0 && (
            <section className="section-tight" aria-labelledby="related-title">
              <h2 id="related-title" className="section__title">Similar properties</h2>
              <div className="results-grid">{related.map((p) => <PropertyCard key={propertyId(p)} property={p} />)}</div>
            </section>
          )}
        </div>

        <aside className="detail-aside">
          <div className="price-box">
            <div className="price-box__label">{isRent ? 'Monthly rent' : 'Asking price'}</div>
            <div className="price-box__amount" title={formatFullINR(property.price)}>{formatINR(property.price, property.listingType)}</div>
            {ppsf && <div className="muted">{ppsf}</div>}
            <a href="#ai-report" className="link-btn small">See price analysis ↓</a>
          </div>
          <ContactPanel property={property} />
        </aside>
      </div>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} targetType="property" targetId={pid} />
    </div>
  );
}
