import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { errorMessage, listProperties, saveSearch } from '../api/client.js';
import FilterSidebar from '../components/FilterSidebar.jsx';
import PropertyCard from '../components/PropertyCard.jsx';
import MapView from '../components/MapView.jsx';
import SearchBox from '../components/SearchBox.jsx';
import { EmptyState, ErrorState, GridSkeleton } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SORT_OPTIONS } from '../utils/constants.js';
import { formatINR, labelize, propertyId } from '../utils/format.js';

const PAGE_SIZE = 12;
const FILTER_KEYS = [
  'propertyType', 'minPrice', 'maxPrice', 'bedrooms', 'city', 'locality', 'q', 'pinCode', 'near', 'radiusKm', 'sort', 'minArea', 'maxArea', 'areaType',
  'furnishing', 'constructionStatus', 'possessionBy', 'maxAge', 'reraVerified', 'verified', 'postedBy', 'developer', 'amenities', 'minPpsf', 'maxPpsf',
  'nearMetroKm', 'nearSchoolKm', 'nearHospitalKm', 'excludeDemo', 'project',
];

const PRESETS = {
  buy: { title: 'Properties for sale', listingType: 'sale' },
  rent: { title: 'Properties for rent', listingType: 'rent' },
  commercial: { title: 'Commercial properties', commercial: '1' },
  all: { title: 'Properties' },
};

function parseFilters(sp, preset) {
  const page = parseInt(sp.get('page') || '1', 10);
  const out = { listingType: sp.get('listingType') === 'rent' ? 'rent' : sp.get('listingType') === 'sale' ? 'sale' : preset.listingType || 'sale' };
  for (const k of FILTER_KEYS) out[k] = sp.get(k) || '';
  out.radiusKm = out.radiusKm || '5';
  out.sort = out.sort || (out.q ? 'relevance' : 'newest');
  out.page = page > 0 ? page : 1;
  return out;
}

function pageWindow(page, pages) {
  const keep = [1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages);
  const sorted = [...new Set(keep)].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

function Pager({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <button type="button" className="pager__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      {pageWindow(page, pages).map((n, i) =>
        n === '…' ? <span key={`gap-${i}`} className="pager__gap">…</span> : (
          <button key={n} type="button" className={`pager__btn${n === page ? ' is-active' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onChange(n)}>{n}</button>
        )
      )}
      <button type="button" className="pager__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </nav>
  );
}

export default function SearchPage({ mode = 'all' }) {
  const preset = PRESETS[mode] || PRESETS.all;
  const [searchParams, setSearchParams] = useSearchParams();
  const queryKey = searchParams.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(queryKey), preset), [queryKey, preset]);
  const { user } = useAuth();
  const toast = useToast();

  const [result, setResult] = useState({ status: 'loading', items: [], total: 0, pages: 1, facets: null, error: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState('list');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [nearState, setNearState] = useState({ status: 'idle', error: '' });
  const [quick, setQuick] = useState(filters.q);

  useEffect(() => setQuick(filters.q), [filters.q]);

  useEffect(() => {
    let cancelled = false;
    const f = parseFilters(new URLSearchParams(queryKey), preset);
    setResult((r) => ({ ...r, status: 'loading', error: '' }));
    const params = { ...f, radiusKm: f.near ? f.radiusKm : '', limit: PAGE_SIZE };
    if (preset.commercial) params.commercial = '1';
    if (mode === 'commercial' && !new URLSearchParams(queryKey).get('listingType')) delete params.listingType;
    listProperties(params)
      .then((data) => !cancelled && setResult({ status: 'ready', items: data.items ?? [], total: data.total ?? 0, pages: data.pages ?? 1, facets: data.facets ?? null, error: '' }))
      .catch((err) => !cancelled && setResult((r) => ({ ...r, status: 'error', items: [], error: errorMessage(err) })));
    return () => {
      cancelled = true;
    };
  }, [queryKey, reloadKey, preset, mode]);

  const updateParams = useCallback(
    (patch, { keepPage = false } = {}) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([key, value]) => {
          if (value === '' || value === null || value === undefined) next.delete(key);
          else next.set(key, String(value));
        });
        if (!keepPage) next.delete('page');
        return next;
      });
    },
    [setSearchParams]
  );

  function resetAll() {
    setNearState({ status: 'idle', error: '' });
    setSearchParams(new URLSearchParams(mode === 'commercial' ? {} : { listingType: filters.listingType }));
  }

  function handleNearMe() {
    if (!navigator.geolocation) return setNearState({ status: 'error', error: 'Location is not supported in this browser.' });
    setNearState({ status: 'locating', error: '' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearState({ status: 'idle', error: '' });
        updateParams({ near: `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`, radiusKm: '5', sort: '' });
      },
      () => setNearState({ status: 'error', error: 'Location permission was denied or unavailable.' }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function handleSave() {
    if (!user) {
      toast.show('Sign in to save searches and get notified about new matches.', 'info');
      return;
    }
    const params = Object.fromEntries([...new URLSearchParams(queryKey)].filter(([k]) => !['page', 'sort', 'near', 'radiusKm'].includes(k)));
    if (mode === 'commercial') params.commercial = '1';
    if (!params.listingType && mode !== 'commercial') params.listingType = filters.listingType;
    try {
      await saveSearch({ params });
      toast.show('Search saved. Find it under Saved.', 'success');
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    }
  }

  const isRent = filters.listingType === 'rent';
  const title = `${mode === 'commercial' ? 'Commercial properties' : isRent ? 'Properties for rent' : 'Properties for sale'}${filters.locality ? ` in ${filters.locality}` : ''}${filters.city ? `${filters.locality ? ',' : ' in'} ${filters.city}` : ''}`;
  const cities = result.facets?.cities ?? [];

  const activeChips = [
    filters.city && { key: 'city', label: `City: ${filters.city}`, clear: { city: '', locality: '' } },
    filters.locality && { key: 'locality', label: filters.locality, clear: { locality: '' } },
    filters.propertyType && { key: 'type', label: filters.propertyType.split(',').map(labelize).join(', '), clear: { propertyType: '' } },
    filters.bedrooms && { key: 'bhk', label: `${filters.bedrooms.split(',').join('/')} BHK`, clear: { bedrooms: '' } },
    (filters.minPrice || filters.maxPrice) && { key: 'price', label: `${filters.minPrice ? formatINR(filters.minPrice) : 'Any'} – ${filters.maxPrice ? formatINR(filters.maxPrice) : 'Any'}`, clear: { minPrice: '', maxPrice: '' } },
    filters.q && { key: 'q', label: `"${filters.q}"`, clear: { q: '' } },
    filters.constructionStatus && { key: 'cs', label: labelize(filters.constructionStatus), clear: { constructionStatus: '' } },
    filters.furnishing && { key: 'furn', label: filters.furnishing.split(',').map(labelize).join(', '), clear: { furnishing: '' } },
    filters.reraVerified && { key: 'rera', label: 'RERA verified', clear: { reraVerified: '' } },
    filters.verified && { key: 'ver', label: 'Checked listings', clear: { verified: '' } },
    filters.postedBy && { key: 'pb', label: `By ${filters.postedBy}`, clear: { postedBy: '' } },
    filters.developer && { key: 'dev', label: filters.developer, clear: { developer: '' } },
    filters.amenities && { key: 'am', label: `${filters.amenities.split(',').length} amenities`, clear: { amenities: '' } },
    (filters.minArea || filters.maxArea) && { key: 'area', label: `${filters.minArea || 0}–${filters.maxArea || '∞'} sq ft`, clear: { minArea: '', maxArea: '' } },
    (filters.minPpsf || filters.maxPpsf) && { key: 'ppsf', label: `₹${filters.minPpsf || 0}–${filters.maxPpsf || '∞'}/sq ft`, clear: { minPpsf: '', maxPpsf: '' } },
    filters.nearMetroKm && { key: 'metro', label: `Metro ≤ ${filters.nearMetroKm} km`, clear: { nearMetroKm: '' } },
    filters.nearSchoolKm && { key: 'school', label: `School ≤ ${filters.nearSchoolKm} km`, clear: { nearSchoolKm: '' } },
    filters.nearHospitalKm && { key: 'hosp', label: `Hospital ≤ ${filters.nearHospitalKm} km`, clear: { nearHospitalKm: '' } },
    filters.excludeDemo && { key: 'demo', label: 'No demo', clear: { excludeDemo: '' } },
    filters.near && { key: 'near', label: `Near you (${filters.radiusKm} km)`, clear: { near: '', radiusKm: '' } },
  ].filter(Boolean);

  const loading = result.status === 'loading';
  const failed = result.status === 'error';
  const empty = !loading && !failed && result.items.length === 0;

  return (
    <div className="search-page">
      <Helmet>
        <title>{`${title} | PropFinder`}</title>
        <meta name="description" content={`Browse ${result.total} ${title.toLowerCase()} on PropFinder with AI price analysis, RERA status and locality insights.`} />
      </Helmet>

      <div className="search-top">
        <div className="container">
          <form className="search-top__form" role="search" onSubmit={(e) => { e.preventDefault(); updateParams({ q: quick.trim() }); }}>
            <SearchBox
              value={quick}
              onChange={setQuick}
              className="input"
              placeholder="Search city, locality, PIN code, project or developer"
              onPick={(it) => {
                if (it.href) window.location.assign(it.href);
                else updateParams({ q: '', city: '', locality: '', pinCode: '', developer: '', ...it.params });
                setQuick('');
              }}
              onSubmit={(v) => updateParams({ q: v.trim() })}
            />
            <button type="submit" className="btn btn--accent">Search</button>
          </form>
        </div>
      </div>

      <div className="container search-layout">
        <FilterSidebar
          filters={filters}
          facets={result.facets}
          onChange={(patch) => updateParams(patch)}
          onReset={resetAll}
          onNearMe={handleNearMe}
          onClearNear={() => { setNearState({ status: 'idle', error: '' }); updateParams({ near: '', radiusKm: '' }); }}
          nearStatus={nearState.status}
          nearError={nearState.error}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          mode={mode}
        />

        <section className="results" aria-live="polite">
          <div className="results__head">
            <div>
              <h1 className="results__title">{title}</h1>
              <p className="results__count">{loading && result.items.length === 0 ? 'Searching…' : `${result.total.toLocaleString('en-IN')} properties found`}</p>
            </div>

            <div className="results__controls">
              <button type="button" className="btn btn--outline btn--sm filters-toggle" onClick={() => setSidebarOpen(true)}>
                Filters{activeChips.length ? ` (${activeChips.length})` : ''}
              </button>
              <button type="button" className="btn btn--outline btn--sm" onClick={handleSave}>☆ Save search</button>
              <label className="sr-only" htmlFor="sort-select">Sort results</label>
              <select id="sort-select" className="select select--sm" value={filters.sort} onChange={(e) => updateParams({ sort: e.target.value })}>
                {filters.near && <option value="">Nearest first</option>}
                {SORT_OPTIONS.filter((s) => s.value !== 'relevance' || filters.q).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <div className="seg seg--sm" role="group" aria-label="Result view">
                <button type="button" className={`seg__btn${view === 'list' ? ' is-active' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
                <button type="button" className={`seg__btn${view === 'map' ? ' is-active' : ''}`} aria-pressed={view === 'map'} onClick={() => setView('map')}>Map</button>
              </div>
            </div>
          </div>

          {cities.length > 1 && !filters.city && (
            <div className="chip-row chip-row--scroll" aria-label="Filter by city">
              {cities.map((c) => (
                <button key={c.city} type="button" className="chip" onClick={() => updateParams({ city: c.city })}>
                  {c.city} <span className="chip__count">{c.count}</span>
                </button>
              ))}
            </div>
          )}

          {activeChips.length > 0 && (
            <div className="active-chips">
              {activeChips.map((chip) => (
                <button key={chip.key} type="button" className="active-chip" onClick={() => updateParams(chip.clear)}>
                  {chip.label} <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove filter</span>
                </button>
              ))}
              <button type="button" className="link-btn" onClick={resetAll}>Clear all</button>
            </div>
          )}

          {loading && result.items.length === 0 && <GridSkeleton count={6} />}
          {failed && <ErrorState message={result.error} onRetry={() => setReloadKey((k) => k + 1)} />}

          {empty && (
            <EmptyState title="No properties match these filters" action={<><button type="button" className="btn btn--primary" onClick={resetAll}>Reset filters</button><button type="button" className="btn btn--outline" onClick={handleSave}>Save search & get alerts</button></>}>
              Try a higher budget, remove a filter or search a nearby locality.
            </EmptyState>
          )}

          {view === 'map' ? (
            result.items.length > 0 && (
              <>
                <MapView properties={result.items} height={600} />
                <p className="muted small">The map shows listings on this page of results.</p>
              </>
            )
          ) : (
            result.items.length > 0 && (
              <div className={`results-grid${loading ? ' is-stale' : ''}`}>
                {result.items.map((p) => <PropertyCard key={propertyId(p)} property={p} />)}
              </div>
            )
          )}

          <Pager page={filters.page} pages={result.pages} onChange={(n) => { updateParams({ page: n }, { keepPage: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />

          {mode === 'buy' && (
            <p className="small muted" style={{ marginTop: 16 }}>Looking for new launches? See <Link to="/projects">new projects</Link> with RERA details.</p>
          )}
        </section>
      </div>
    </div>
  );
}
