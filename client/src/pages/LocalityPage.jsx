import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { errorMessage, getLocalityInsights, listProperties } from '../api/client.js';
import PropertyCard from '../components/PropertyCard.jsx';
import Reviews from '../components/Reviews.jsx';
import NearbyMap from '../components/NearbyMap.jsx';
import { EmptyState, ErrorState, GridSkeleton, PanelSkeleton } from '../components/ui.jsx';
import { formatINR, labelize, propertyId } from '../utils/format.js';

const SHOW = ['metro', 'school', 'hospital', 'supermarket', 'park', 'railway'];

/** Locality landing page: listings, asking-price benchmarks, nearby facilities and reviews. */
export default function LocalityPage() {
  const { city, locality } = useParams();
  const [listings, setListings] = useState({ status: 'loading', items: [], total: 0, error: '' });
  const [insights, setInsights] = useState({ status: 'loading', data: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    setListings({ status: 'loading', items: [], total: 0, error: '' });
    setInsights({ status: 'loading', data: null, error: '' });
    listProperties({ city, locality, sort: 'newest', limit: 12 })
      .then((d) => !cancelled && setListings({ status: 'ready', items: d.items ?? [], total: d.total ?? 0, error: '' }))
      .catch((err) => !cancelled && setListings({ status: 'error', items: [], total: 0, error: errorMessage(err) }));

    let timer;
    let polls = 0;
    const load = () =>
      getLocalityInsights(city, locality)
        .then((d) => {
          if (cancelled) return;
          setInsights({ status: 'ready', data: d, error: '' });
          if (d.nearby?.status === 'pending' && polls < 10) {
            polls += 1;
            timer = setTimeout(load, 8000);
          }
        })
        .catch((err) => !cancelled && setInsights({ status: 'error', data: null, error: errorMessage(err) }));
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [city, locality]);

  const d = insights.data;
  const sale = d?.segments.filter((s) => s.listingType === 'sale') || [];
  const rent = d?.segments.filter((s) => s.listingType === 'rent') || [];
  const intro = `Explore ${listings.total} active ${listings.total === 1 ? 'listing' : 'listings'} in ${locality}, ${city}, with asking-price benchmarks, nearby schools, hospitals and transport from map data, and resident reviews.`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="container section">
      <Helmet>
        <title>{`Property in ${locality}, ${city} — prices, amenities & reviews | PropFinder`}</title>
        <meta name="description" content={intro.slice(0, 160)} />
        <link rel="canonical" href={`${origin}/locality/${encodeURIComponent(city)}/${encodeURIComponent(locality)}`} />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
              { '@type': 'ListItem', position: 2, name: city, item: `${origin}/buy?city=${encodeURIComponent(city)}` },
              { '@type': 'ListItem', position: 3, name: locality },
            ],
          })}
        </script>
      </Helmet>

      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/buy?city=${encodeURIComponent(city)}`}>{city}</Link>
        <span aria-hidden="true">/</span>
        <span>{locality}</span>
      </nav>

      <header className="page-head page-head--row">
        <div>
          <h1>{locality}, {city}</h1>
          <p className="intro">{intro}</p>
        </div>
        <div className="btn-row">
          <Link to={`/buy?city=${encodeURIComponent(city)}&locality=${encodeURIComponent(locality)}`} className="btn btn--primary">Buy here</Link>
          <Link to={`/rent?city=${encodeURIComponent(city)}&locality=${encodeURIComponent(locality)}`} className="btn btn--outline">Rent here</Link>
        </div>
      </header>

      {insights.status === 'loading' && <PanelSkeleton lines={4} />}
      {insights.status === 'error' && <ErrorState message={insights.error} />}
      {d && (
        <div className="two-col">
          <section className="panel">
            <h2 className="panel__title">Asking-price benchmarks</h2>
            {!d.segments.length ? (
              <p className="muted">No active listings to benchmark yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Segment</th><th>Listings</th><th>Median</th><th>Range</th></tr></thead>
                  <tbody>
                    {[...sale, ...rent].map((s) => (
                      <tr key={`${s.listingType}-${s.propertyType}`}>
                        <td>{labelize(s.propertyType)} · {s.listingType === 'rent' ? 'rent' : 'sale'}{s.demoCount ? <span className="tiny muted"> ({s.demoCount} demo)</span> : null}</td>
                        <td>{s.count}</td>
                        <td>{s.medianPerSqft != null ? `₹${s.medianPerSqft.toLocaleString('en-IN')}/sq ft${s.listingType === 'rent' ? '/mo' : ''}` : <span className="muted small">needs 3+</span>}</td>
                        <td className="small">{formatINR(s.minPrice, s.listingType)} – {formatINR(s.maxPrice, s.listingType)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="tiny muted">{d.benchmarkNote}</p>
            {d.reviewSummary.count > 0 && <p className="small">Resident rating: <strong>{d.reviewSummary.avg}★</strong> from {d.reviewSummary.count} reviews.</p>}
          </section>

          <section className="panel">
            <h2 className="panel__title">Around {locality}</h2>
            {d.nearby.status === 'pending' && (
              <div className="nearby-loading" role="status"><span className="radar" aria-hidden="true" /><p className="small">{d.nearby.message}</p></div>
            )}
            {!d.nearby.categories && d.nearby.status !== 'pending' && <p className="muted small">{d.nearby.message || 'Nearby data unavailable.'}</p>}
            {d.nearby.categories && (
              <>
                <ul className="tight-list small">
                  {SHOW.map((k) => {
                    const c = d.nearby.categories[k];
                    const m = d.nearby.meta[k];
                    return (
                      <li key={k}>
                        <strong>{m.label}:</strong>{' '}
                        {c.count ? `${c.count} within ${m.radiusKm} km — nearest ${c.nearest[0]?.name || 'unnamed'} (${c.nearestKm} km)` : `none found within ${m.radiusKm} km`}
                      </li>
                    );
                  })}
                </ul>
                {d.center && <NearbyMap center={d.center} categories={d.nearby.categories} meta={d.nearby.meta} enabled={new Set(SHOW)} height={260} />}
                <p className="tiny muted">{d.centerNote} Straight-line distances. {d.nearby.attribution?.text}</p>
              </>
            )}
          </section>
        </div>
      )}

      <section className="section-tight">
        <h2 className="section__title">Latest listings</h2>
        {listings.status === 'loading' && <GridSkeleton count={3} />}
        {listings.status === 'error' && <ErrorState message={listings.error} />}
        {listings.status === 'ready' && !listings.items.length && (
          <EmptyState title={`No listings in ${locality} yet`}>Check nearby localities or <Link to="/post">post a property</Link> here.</EmptyState>
        )}
        <div className="results-grid">{listings.items.map((p) => <PropertyCard key={propertyId(p)} property={p} />)}</div>
      </section>

      <Reviews targetType="locality" targetId={`${city}|${locality}`} title={`Living in ${locality}: reviews`} />
    </div>
  );
}
