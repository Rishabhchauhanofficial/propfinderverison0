import { useEffect, useState } from 'react';
import { formatINR } from '../utils/format.js';
import { AMENITIES, BHK_OPTIONS, COMMERCIAL_TYPES, FURNISHING_OPTIONS, PROPERTY_TYPES, RENT_PRICE_STEPS, SALE_PRICE_STEPS } from '../utils/constants.js';

const list = (s) => String(s || '').split(',').filter(Boolean);
const toggleIn = (csv, value) => {
  const set = new Set(list(csv));
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set].join(',');
};

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`sidebar__section${open ? '' : ' is-collapsed'}`}>
      <button type="button" className="sidebar__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="sidebar__label">{title}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <div className="sidebar__content">{children}</div>
    </div>
  );
}

/**
 * Controlled filter panel. Every change is reported as a partial patch,
 * e.g. onChange({ bedrooms: '2' }). The parent owns the URL.
 */
export default function FilterSidebar({ filters, facets, onChange, onReset, onNearMe, onClearNear, nearStatus, nearError, open = false, onClose, mode = 'all' }) {
  const isRent = filters.listingType === 'rent';
  const priceSteps = isRent ? RENT_PRICE_STEPS : SALE_PRICE_STEPS;
  const cities = facets?.cities ?? [];
  const types = mode === 'commercial' ? PROPERTY_TYPES.filter((t) => COMMERCIAL_TYPES.includes(t.value)) : PROPERTY_TYPES;

  const [keyword, setKeyword] = useState(filters.q);
  const [cityDraft, setCityDraft] = useState(filters.city);
  const [area, setArea] = useState({ min: filters.minArea, max: filters.maxArea });
  const [ppsf, setPpsf] = useState({ min: filters.minPpsf, max: filters.maxPpsf });

  useEffect(() => setKeyword(filters.q), [filters.q]);
  useEffect(() => setCityDraft(filters.city), [filters.city]);
  useEffect(() => setArea({ min: filters.minArea, max: filters.maxArea }), [filters.minArea, filters.maxArea]);
  useEffect(() => setPpsf({ min: filters.minPpsf, max: filters.maxPpsf }), [filters.minPpsf, filters.maxPpsf]);

  const priceOptions = (steps, emptyLabel) =>
    steps.map((v) => (
      <option key={v} value={v || ''}>
        {v ? formatINR(v, filters.listingType) : emptyLabel}
      </option>
    ));

  const selectedTypes = list(filters.propertyType);
  const selectedBeds = list(filters.bedrooms);

  return (
    <>
      <div className={`sidebar-backdrop${open ? ' is-visible' : ''}`} onClick={onClose} aria-hidden="true" />

      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Filters">
        <div className="sidebar__head">
          <h2>Filters</h2>
          <div className="sidebar__head-actions">
            <button type="button" className="link-btn" onClick={onReset}>Reset</button>
            <button type="button" className="sidebar__close" onClick={onClose} aria-label="Close filters">×</button>
          </div>
        </div>

        <div className="sidebar__section">
          <span className="sidebar__label" id="f-listing">I want to</span>
          <div className="seg seg--block" role="group" aria-labelledby="f-listing">
            {[
              { value: 'sale', label: 'Buy' },
              { value: 'rent', label: 'Rent' },
            ].map((opt) => (
              <button key={opt.value} type="button" className={`seg__btn${filters.listingType === opt.value ? ' is-active' : ''}`} aria-pressed={filters.listingType === opt.value} onClick={() => onChange({ listingType: opt.value, minPrice: '', maxPrice: '' })}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar__section">
          <form onSubmit={(e) => { e.preventDefault(); onChange({ q: keyword.trim() }); }}>
            <label className="sidebar__label" htmlFor="f-keyword">Keyword, PIN code or developer</label>
            <input id="f-keyword" className="input" type="search" placeholder="e.g. 560034, corner, park facing" value={keyword} onChange={(e) => setKeyword(e.target.value)} onBlur={() => keyword.trim() !== filters.q && onChange({ q: keyword.trim() })} />
          </form>
        </div>

        <div className="sidebar__section">
          <form onSubmit={(e) => { e.preventDefault(); onChange({ city: cityDraft.trim(), locality: '' }); }}>
            <label className="sidebar__label" htmlFor="f-city">City</label>
            <input id="f-city" className="input" list="f-city-options" placeholder="Any city" value={cityDraft} onChange={(e) => setCityDraft(e.target.value)} onBlur={() => cityDraft.trim() !== filters.city && onChange({ city: cityDraft.trim(), locality: '' })} />
            <datalist id="f-city-options">
              {cities.map((c) => <option key={c.city} value={c.city}>{`${c.count} listings`}</option>)}
            </datalist>
          </form>
          {filters.city && facets?.localities?.length > 0 && (
            <select className="select" style={{ marginTop: 8 }} aria-label="Locality" value={filters.locality} onChange={(e) => onChange({ locality: e.target.value })}>
              <option value="">All localities</option>
              {facets.localities.map((l) => <option key={l.locality} value={l.locality}>{l.locality} ({l.count})</option>)}
            </select>
          )}
        </div>

        <Section title="Property type">
          <div className="chip-row">
            {types.map((t) => {
              const on = selectedTypes.includes(t.value);
              return (
                <button key={t.value} type="button" className={`chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => onChange({ propertyType: toggleIn(filters.propertyType, t.value) })}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Budget">
          <div className="sidebar__row">
            <select className="select" aria-label="Minimum price" value={filters.minPrice} onChange={(e) => onChange({ minPrice: e.target.value })}>{priceOptions(priceSteps, 'Min')}</select>
            <select className="select" aria-label="Maximum price" value={filters.maxPrice} onChange={(e) => onChange({ maxPrice: e.target.value })}>{priceOptions(priceSteps, 'Max')}</select>
          </div>
          {!isRent && (
            <form className="sidebar__row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); onChange({ minPpsf: ppsf.min, maxPpsf: ppsf.max }); }}>
              <input className="input" type="number" min="0" placeholder="Min ₹/sq ft" aria-label="Minimum price per sq ft" value={ppsf.min} onChange={(e) => setPpsf({ ...ppsf, min: e.target.value })} onBlur={() => onChange({ minPpsf: ppsf.min, maxPpsf: ppsf.max })} />
              <input className="input" type="number" min="0" placeholder="Max ₹/sq ft" aria-label="Maximum price per sq ft" value={ppsf.max} onChange={(e) => setPpsf({ ...ppsf, max: e.target.value })} onBlur={() => onChange({ minPpsf: ppsf.min, maxPpsf: ppsf.max })} />
            </form>
          )}
        </Section>

        {mode !== 'commercial' && (
          <Section title="Bedrooms">
            <div className="chip-row">
              <button type="button" className={`chip${!filters.bedrooms ? ' is-active' : ''}`} onClick={() => onChange({ bedrooms: '' })}>Any</button>
              {BHK_OPTIONS.map((n) => {
                const on = selectedBeds.includes(String(n));
                return (
                  <button key={n} type="button" className={`chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => onChange({ bedrooms: toggleIn(filters.bedrooms, String(n)) })}>
                    {n === BHK_OPTIONS.at(-1) ? `${n}+ BHK` : `${n} BHK`}
                  </button>
                );
              })}
            </div>
            <p className="tiny muted">One choice = that many or more; several = exactly those.</p>
          </Section>
        )}

        <Section title="Area (sq ft)" defaultOpen={false}>
          <select className="select" aria-label="Area type" value={filters.areaType} onChange={(e) => onChange({ areaType: e.target.value })}>
            <option value="">Built-up area</option>
            <option value="carpet">Carpet area</option>
            <option value="plot">Plot area</option>
          </select>
          <form className="sidebar__row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); onChange({ minArea: area.min, maxArea: area.max }); }}>
            <input className="input" type="number" min="0" placeholder="Min" aria-label="Minimum area" value={area.min} onChange={(e) => setArea({ ...area, min: e.target.value })} onBlur={() => onChange({ minArea: area.min, maxArea: area.max })} />
            <input className="input" type="number" min="0" placeholder="Max" aria-label="Maximum area" value={area.max} onChange={(e) => setArea({ ...area, max: e.target.value })} onBlur={() => onChange({ minArea: area.min, maxArea: area.max })} />
          </form>
        </Section>

        <Section title="Construction & possession" defaultOpen={false}>
          <div className="chip-row">
            {[['', 'Any'], ['ready', 'Ready to move'], ['under-construction', 'Under construction']].map(([v, l]) => (
              <button key={v || 'any'} type="button" className={`chip${filters.constructionStatus === v ? ' is-active' : ''}`} onClick={() => onChange({ constructionStatus: v })}>{l}</button>
            ))}
          </div>
          <label className="sidebar__label" htmlFor="f-poss" style={{ marginTop: 10 }}>Possession by</label>
          <input id="f-poss" className="input" type="month" value={filters.possessionBy ? filters.possessionBy.slice(0, 7) : ''} onChange={(e) => onChange({ possessionBy: e.target.value ? `${e.target.value}-28` : '' })} />
          <label className="sidebar__label" htmlFor="f-age" style={{ marginTop: 10 }}>Max property age</label>
          <select id="f-age" className="select" value={filters.maxAge} onChange={(e) => onChange({ maxAge: e.target.value })}>
            <option value="">Any</option>
            {[1, 5, 10, 15].map((y) => <option key={y} value={y}>Up to {y} years</option>)}
          </select>
        </Section>

        <Section title="Furnishing" defaultOpen={false}>
          <div className="chip-row">
            {FURNISHING_OPTIONS.map((f) => {
              const on = list(filters.furnishing).includes(f.value);
              return <button key={f.value} type="button" className={`chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => onChange({ furnishing: toggleIn(filters.furnishing, f.value) })}>{f.label}</button>;
            })}
          </div>
        </Section>

        <Section title="Trust & verification" defaultOpen={false}>
          <label className="check"><input type="checkbox" checked={filters.reraVerified === '1'} onChange={(e) => onChange({ reraVerified: e.target.checked ? '1' : '' })} /> RERA registration verified</label>
          <label className="check"><input type="checkbox" checked={filters.verified === '1'} onChange={(e) => onChange({ verified: e.target.checked ? '1' : '' })} /> Listing checked by PropFinder</label>
          <label className="check"><input type="checkbox" checked={filters.excludeDemo === '1'} onChange={(e) => onChange({ excludeDemo: e.target.checked ? '1' : '' })} /> Hide demo listings</label>
          <span className="sidebar__label" style={{ marginTop: 10 }}>Posted by</span>
          <div className="chip-row">
            {[['', 'Anyone'], ['owner', 'Owner'], ['agent', 'Agent'], ['builder', 'Builder']].map(([v, l]) => (
              <button key={v || 'any'} type="button" className={`chip${filters.postedBy === v ? ' is-active' : ''}`} onClick={() => onChange({ postedBy: v })}>{l}</button>
            ))}
          </div>
          <label className="sidebar__label" htmlFor="f-dev" style={{ marginTop: 10 }}>Builder / developer</label>
          <input id="f-dev" className="input" defaultValue={filters.developer} placeholder="Developer name" onBlur={(e) => e.target.value.trim() !== filters.developer && onChange({ developer: e.target.value.trim() })} />
        </Section>

        <Section title="Nearby facilities" defaultOpen={false}>
          {[['nearMetroKm', 'Metro station within', [0.5, 1, 2, 3]], ['nearSchoolKm', 'School within', [0.5, 1, 2, 3]], ['nearHospitalKm', 'Hospital within', [1, 2, 3, 5]]].map(([key, label, opts]) => (
            <label key={key} className="form-row">
              <span className="small">{label}</span>
              <select className="select select--sm" value={filters[key]} onChange={(e) => onChange({ [key]: e.target.value })}>
                <option value="">Any</option>
                {opts.map((o) => <option key={o} value={o}>{o} km</option>)}
              </select>
            </label>
          ))}
          <p className="tiny muted">Straight-line distance, using map data for listings whose locality report has been generated.</p>
        </Section>

        <Section title="Amenities" defaultOpen={false}>
          <div className="chip-row">
            {AMENITIES.map((a) => {
              const on = list(filters.amenities).includes(a);
              return <button key={a} type="button" className={`chip chip--sm${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => onChange({ amenities: toggleIn(filters.amenities, a) })}>{a}</button>;
            })}
          </div>
        </Section>

        <div className="sidebar__section">
          <span className="sidebar__label">Near me</span>
          {filters.near ? (
            <div className="near-box is-on">
              <span>Within {filters.radiusKm} km of your location</span>
              <select className="select select--sm" aria-label="Radius" value={filters.radiusKm} onChange={(e) => onChange({ radiusKm: e.target.value })}>
                {[1, 2, 5, 10, 20].map((r) => <option key={r} value={r}>{r} km</option>)}
              </select>
              <button type="button" className="link-btn" onClick={onClearNear}>Clear</button>
            </div>
          ) : (
            <button type="button" className="btn btn--outline btn--block" onClick={onNearMe} disabled={nearStatus === 'locating'}>
              {nearStatus === 'locating' ? 'Locating…' : '📍 Use my location'}
            </button>
          )}
          {nearStatus === 'error' && nearError && <p className="field-error">{nearError}</p>}
        </div>

        <div className="sidebar__apply">
          <button type="button" className="btn btn--primary btn--block" onClick={onClose}>Show results</button>
        </div>
      </aside>
    </>
  );
}
