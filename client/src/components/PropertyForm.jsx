import { useEffect, useRef, useState } from 'react';
import { AMENITIES, FURNISHING_OPTIONS, PROPERTY_TYPES, RERA_STATE_OPTIONS } from '../utils/constants.js';
import { draftDescription, errorMessage, geocode, myProjects, openPrivateFile, uploadDocuments, uploadImages } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatINR } from '../utils/format.js';
import MapView from './MapView.jsx';
import Loader from './Loader.jsx';

const STEPS = ['Basics', 'Price & area', 'Location', 'Photos & amenities', 'RERA & documents'];
const DRAFT_KEY = 'pf_listing_draft';

const EMPTY = {
  listingType: 'sale',
  propertyType: 'apartment',
  status: 'active',
  title: '',
  description: '',
  price: '',
  areaSqft: '',
  carpetAreaSqft: '',
  plotAreaSqft: '',
  bedrooms: '',
  bathrooms: '',
  balconies: '',
  furnishing: 'unfurnished',
  floor: '',
  totalFloors: '',
  facing: '',
  ageYears: '',
  constructionStatus: 'ready',
  possessionDate: '',
  maintenanceMonthly: '',
  securityDeposit: '',
  city: '',
  locality: '',
  state: '',
  pinCode: '',
  address: '',
  lat: '',
  lng: '',
  amenities: [],
  images: [],
  videoUrl: '',
  developerName: '',
  project: '',
  reraNumber: '',
  reraState: '',
  reraProjectName: '',
  reraNotApplicable: false,
  contactPreference: 'both',
  documents: [],
};

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Convert an API property into form values. */
export function toFormValues(p) {
  if (!p) return { ...EMPTY };
  return {
    ...EMPTY,
    listingType: p.listingType || 'sale',
    propertyType: p.propertyType || 'apartment',
    status: p.status || 'active',
    title: str(p.title),
    description: str(p.description),
    price: str(p.price),
    areaSqft: str(p.areaSqft),
    carpetAreaSqft: str(p.carpetAreaSqft),
    plotAreaSqft: str(p.plotAreaSqft),
    bedrooms: str(p.bedrooms),
    bathrooms: str(p.bathrooms),
    balconies: str(p.balconies),
    furnishing: p.furnishing || 'unfurnished',
    floor: str(p.floor),
    totalFloors: str(p.totalFloors),
    facing: str(p.facing),
    ageYears: str(p.ageYears),
    constructionStatus: p.constructionStatus || '',
    possessionDate: p.possessionDate ? String(p.possessionDate).slice(0, 10) : '',
    maintenanceMonthly: str(p.maintenanceMonthly),
    securityDeposit: str(p.securityDeposit),
    city: str(p.city),
    locality: str(p.locality),
    state: str(p.state),
    pinCode: str(p.pinCode),
    address: str(p.address),
    lat: str(p.location?.lat),
    lng: str(p.location?.lng),
    amenities: Array.isArray(p.amenities) ? p.amenities : [],
    images: Array.isArray(p.images) ? p.images : [],
    videoUrl: str(p.videoUrl),
    developerName: str(p.developerName),
    project: str(p.project?._id || p.project),
    reraNumber: str(p.rera?.number),
    reraState: str(p.rera?.state),
    reraNotApplicable: p.rera?.status === 'not-applicable',
    contactPreference: p.contactPreference || 'both',
    documents: Array.isArray(p.documents) ? p.documents : [],
  };
}

/** Convert form values into the API payload. */
export function toPayload(v) {
  const num = (s) => (s === '' || s === null || s === undefined ? null : Number(s));
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    listingType: v.listingType,
    propertyType: v.propertyType,
    status: v.status,
    price: num(v.price),
    areaSqft: num(v.areaSqft),
    carpetAreaSqft: num(v.carpetAreaSqft),
    plotAreaSqft: v.propertyType === 'plot' ? num(v.areaSqft) : num(v.plotAreaSqft),
    bedrooms: num(v.bedrooms) ?? 0,
    bathrooms: num(v.bathrooms) ?? 0,
    balconies: num(v.balconies),
    furnishing: v.furnishing,
    floor: num(v.floor),
    totalFloors: num(v.totalFloors),
    facing: v.facing,
    ageYears: num(v.ageYears),
    constructionStatus: v.propertyType === 'plot' ? '' : v.constructionStatus,
    possessionDate: v.constructionStatus === 'under-construction' && v.possessionDate ? v.possessionDate : null,
    maintenanceMonthly: num(v.maintenanceMonthly),
    securityDeposit: v.listingType === 'rent' ? num(v.securityDeposit) : null,
    city: v.city.trim(),
    locality: v.locality.trim(),
    state: v.state.trim(),
    pinCode: v.pinCode.trim(),
    address: v.address.trim(),
    location: { lat: num(v.lat), lng: num(v.lng) },
    amenities: v.amenities,
    images: v.images,
    videoUrl: v.videoUrl.trim(),
    developerName: v.developerName.trim(),
    project: v.project || null,
    rera: { number: v.reraNumber.trim(), state: v.reraState, projectName: v.reraProjectName.trim(), notApplicable: v.reraNotApplicable },
    contactPreference: v.contactPreference,
    documents: v.documents,
  };
}

const isNum = (s) => s !== '' && !Number.isNaN(Number(s));

function validateStep(step, v) {
  const e = {};
  if (step === 0) {
    if (v.title.trim().length < 5) e.title = 'Title should be at least 5 characters.';
  }
  if (step === 1) {
    if (!isNum(v.price) || Number(v.price) <= 0) e.price = 'Enter a valid price in rupees.';
    else if (v.listingType === 'sale' && Number(v.price) < 100000) e.price = 'Enter the full amount in rupees, e.g. 7500000 for ₹75 lakh.';
    if (!isNum(v.areaSqft) || Number(v.areaSqft) <= 0) e.areaSqft = 'Enter the area in sq ft.';
    if (v.carpetAreaSqft && Number(v.carpetAreaSqft) > Number(v.areaSqft) * 1.05) e.carpetAreaSqft = 'Carpet area cannot exceed the built-up area.';
    if (v.floor && v.totalFloors && Number(v.floor) > Number(v.totalFloors)) e.floor = 'Floor cannot be above the total floors.';
  }
  if (step === 2) {
    if (!v.city.trim()) e.city = 'City is required.';
    if (!v.locality.trim()) e.locality = 'Locality is required.';
    if (v.pinCode && !/^\d{6}$/.test(v.pinCode.trim())) e.pinCode = 'PIN code must have 6 digits.';
    const hasLat = v.lat !== '';
    if (hasLat !== (v.lng !== '')) e.lat = 'Provide both latitude and longitude, or leave both empty.';
    else if (hasLat && (Math.abs(Number(v.lat)) > 90 || Math.abs(Number(v.lng)) > 180)) e.lat = 'Coordinates are out of range.';
  }
  return e;
}

function Field({ label, error, hint, full = false, children }) {
  return (
    <label className={`form-field${full ? ' form-field--full' : ''}${error ? ' has-error' : ''}`}>
      <span className="form-field__label">{label}</span>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

/**
 * Guided listing form shared by "Post" and "Edit".
 * Props: initialValues, submitLabel, busy, error, onSubmit(payload), showStatus, allowDraft
 */
export default function PropertyForm({ initialValues, submitLabel = 'Publish listing', busy = false, error = '', onSubmit, showStatus = false, allowDraft = true, persistDraft = false }) {
  const { user } = useAuth();
  const [values, setValues] = useState(() => {
    if (persistDraft) {
      try {
        const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
        if (saved) return { ...EMPTY, ...saved };
      } catch {
        /* ignore */
      }
    }
    return { ...EMPTY, ...(initialValues || {}) };
  });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [geo, setGeo] = useState({ q: '', status: 'idle', items: [], message: '' });
  const [ai, setAi] = useState({ busy: false, msg: '' });
  const [projects, setProjects] = useState([]);
  const [upload, setUpload] = useState({ busy: false, error: '', dragging: false });
  const [docUpload, setDocUpload] = useState({ busy: false, error: '' });
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);

  const isRent = values.listingType === 'rent';
  const isPlot = values.propertyType === 'plot';
  const isCommercial = ['commercial', 'office', 'retail-shop'].includes(values.propertyType);

  useEffect(() => {
    if (user?.role === 'builder' || user?.role === 'admin') myProjects().then((d) => setProjects(d.items || [])).catch(() => {});
  }, [user]);

  // Local draft backup for new listings (survives refresh).
  useEffect(() => {
    if (!persistDraft) return undefined;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [values, persistDraft]);

  function set(name, value) {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setUpload((u) => ({ ...u, busy: true, error: '' }));
    try {
      const { urls } = await uploadImages(files);
      setValues((prev) => ({ ...prev, images: [...prev.images, ...urls].slice(0, 20) }));
      setUpload({ busy: false, error: '', dragging: false });
    } catch (err) {
      setUpload({ busy: false, error: errorMessage(err, 'Upload failed. Try smaller images.'), dragging: false });
    }
  }

  async function handleDocs(fileList) {
    if (!fileList?.length) return;
    setDocUpload({ busy: true, error: '' });
    try {
      const { files } = await uploadDocuments(fileList);
      setValues((prev) => ({ ...prev, documents: [...prev.documents, ...files.map((f) => ({ ...f, kind: 'other' }))].slice(0, 10) }));
      setDocUpload({ busy: false, error: '' });
    } catch (err) {
      setDocUpload({ busy: false, error: errorMessage(err, 'Upload failed.') });
    }
  }

  function moveImage(i, d) {
    setValues((prev) => {
      const imgs = [...prev.images];
      const j = i + d;
      if (j < 0 || j >= imgs.length) return prev;
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      return { ...prev, images: imgs };
    });
  }

  function next() {
    const stepErrors = validateStep(step, values);
    setErrors(stepErrors);
    if (!Object.keys(stepErrors).length) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit(status) {
    if (status !== 'draft') {
      for (let i = 0; i < STEPS.length; i += 1) {
        const stepErrors = validateStep(i, values);
        if (Object.keys(stepErrors).length) {
          setErrors(stepErrors);
          setStep(i);
          return;
        }
      }
    } else if (values.title.trim().length < 5) {
      setErrors({ title: 'Add a title (5+ characters) to save a draft.' });
      setStep(0);
      return;
    }
    if (persistDraft) {
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
    onSubmit({ ...toPayload(values), status: status || values.status });
  }

  async function searchAddress(e) {
    e?.preventDefault();
    const q = geo.q.trim() || [values.address, values.locality, values.city].filter(Boolean).join(', ');
    if (q.length < 3) return setGeo((g) => ({ ...g, status: 'error', message: 'Type an address or landmark.' }));
    setGeo((g) => ({ ...g, status: 'loading', message: '' }));
    try {
      const r = await geocode(q);
      setGeo((g) => ({ ...g, status: r.status, items: r.items, message: r.message || (r.items.length ? '' : 'No matches. Try a nearby landmark.') }));
    } catch (err) {
      setGeo((g) => ({ ...g, status: 'error', items: [], message: errorMessage(err) }));
    }
  }

  function pickPlace(p) {
    setValues((prev) => ({
      ...prev,
      lat: p.lat.toFixed(6),
      lng: p.lng.toFixed(6),
      city: prev.city || p.city,
      locality: prev.locality || p.locality,
      state: prev.state || p.state,
      pinCode: prev.pinCode || (/^\d{6}$/.test(p.pinCode) ? p.pinCode : ''),
    }));
    setGeo((g) => ({ ...g, items: [], message: 'Location set. Check the pin on the map below.' }));
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setGeo((g) => ({ ...g, status: 'error', message: 'Geolocation is not supported in this browser.' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValues((prev) => ({ ...prev, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        setGeo((g) => ({ ...g, message: 'Location captured. Make sure you are at the property.' }));
      },
      () => setGeo((g) => ({ ...g, status: 'error', message: 'Could not read your location.' })),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function aiDraft() {
    setAi({ busy: true, msg: '' });
    try {
      const r = await draftDescription(toPayload(values));
      set('description', r.description);
      setAi({ busy: false, msg: r.source === 'llm' ? 'Drafted with AI from your details — review and edit before publishing.' : 'Drafted from your details (AI provider not configured) — review and edit.' });
    } catch (err) {
      setAi({ busy: false, msg: errorMessage(err) });
    }
  }

  const hasPin = values.lat !== '' && values.lng !== '' && isNum(values.lat) && isNum(values.lng);
  const ppsf = !isRent && isNum(values.price) && isNum(values.areaSqft) && Number(values.areaSqft) > 0 ? Math.round(Number(values.price) / Number(values.areaSqft)) : null;

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <ol className="stepper" aria-label="Form steps">
        {STEPS.map((label, i) => (
          <li key={label} className={`step${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`} aria-current={i === step ? 'step' : undefined}>
            <button type="button" className="step__btn" onClick={() => i < step && setStep(i)}>
              <span className="step__num">{i < step ? '✓' : i + 1}</span>
              <span className="step__label">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="form-grid">
          <div className="form-field form-field--full">
            <span className="form-field__label">Transaction</span>
            <div className="seg" role="group" aria-label="Listing type">
              {[{ value: 'sale', label: 'Sell' }, { value: 'rent', label: 'Rent out' }].map((opt) => (
                <button key={opt.value} type="button" className={`seg__btn${values.listingType === opt.value ? ' is-active' : ''}`} aria-pressed={values.listingType === opt.value} onClick={() => set('listingType', opt.value)}>{opt.label}</button>
              ))}
            </div>
          </div>
          <Field label="Property type">
            <select className="select" value={values.propertyType} onChange={(e) => set('propertyType', e.target.value)}>
              {PROPERTY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          {showStatus && (
            <Field label="Listing status">
              <select className="select" value={values.status} onChange={(e) => set('status', e.target.value)}>
                {['draft', 'active', 'paused', 'archived', isRent ? 'rented' : 'sold'].map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </Field>
          )}
          <Field label="Listing title" error={errors.title} full hint="Example: 3 BHK with balcony in Sector 56, Gurugram">
            <input className="input" value={values.title} maxLength={140} onChange={(e) => set('title', e.target.value)} placeholder="A short, factual headline" />
          </Field>
          <div className="form-field form-field--full">
            <div className="mk-label-row">
              <span className="form-field__label">Description</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={aiDraft} disabled={ai.busy}>{ai.busy ? 'Drafting…' : '✨ Draft with AI'}</button>
            </div>
            <textarea className="input textarea" rows={6} maxLength={5000} value={values.description} onChange={(e) => set('description', e.target.value)} placeholder="Describe the home honestly: layout, light, condition, parking, what's included." />
            <span className="hint">{ai.msg || 'The AI draft uses only the details you enter — fill in price, area and location first for a better draft.'}</span>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="form-grid">
          <Field label={isRent ? 'Monthly rent (₹)' : 'Expected price (₹)'} error={errors.price} hint={values.price && isNum(values.price) ? `${formatINR(values.price)}${ppsf ? ` · ₹${ppsf.toLocaleString('en-IN')}/sq ft` : ''}` : ''}>
            <input className="input" type="number" min="0" inputMode="numeric" value={values.price} onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field label={isPlot ? 'Plot area (sq ft)' : 'Built-up area (sq ft)'} error={errors.areaSqft}>
            <input className="input" type="number" min="0" inputMode="numeric" value={values.areaSqft} onChange={(e) => set('areaSqft', e.target.value)} />
          </Field>
          {!isPlot && (
            <Field label="Carpet area (sq ft)" error={errors.carpetAreaSqft} hint="Usable area inside the walls. Buyers trust listings that disclose it.">
              <input className="input" type="number" min="0" inputMode="numeric" value={values.carpetAreaSqft} onChange={(e) => set('carpetAreaSqft', e.target.value)} />
            </Field>
          )}
          {!isPlot && !isCommercial && (
            <>
              <Field label="Bedrooms"><input className="input" type="number" min="0" max="20" value={values.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} /></Field>
              <Field label="Bathrooms"><input className="input" type="number" min="0" max="20" value={values.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} /></Field>
              <Field label="Balconies"><input className="input" type="number" min="0" max="20" value={values.balconies} onChange={(e) => set('balconies', e.target.value)} /></Field>
            </>
          )}
          {!isPlot && (
            <>
              <Field label="Furnishing">
                <select className="select" value={values.furnishing} onChange={(e) => set('furnishing', e.target.value)}>
                  {FURNISHING_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
              <Field label="Floor" error={errors.floor}><input className="input" type="number" min="-3" max="200" value={values.floor} onChange={(e) => set('floor', e.target.value)} /></Field>
              <Field label="Total floors"><input className="input" type="number" min="1" max="200" value={values.totalFloors} onChange={(e) => set('totalFloors', e.target.value)} /></Field>
              <Field label="Facing">
                <select className="select" value={values.facing} onChange={(e) => set('facing', e.target.value)}>
                  <option value="">—</option>
                  {['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West'].map((f) => <option key={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Construction status">
                <select className="select" value={values.constructionStatus} onChange={(e) => set('constructionStatus', e.target.value)}>
                  <option value="ready">Ready to move</option>
                  <option value="under-construction">Under construction</option>
                </select>
              </Field>
              {values.constructionStatus === 'under-construction' ? (
                <Field label="Expected possession"><input className="input" type="date" value={values.possessionDate} onChange={(e) => set('possessionDate', e.target.value)} /></Field>
              ) : (
                <Field label="Property age (years)"><input className="input" type="number" min="0" max="150" value={values.ageYears} onChange={(e) => set('ageYears', e.target.value)} /></Field>
              )}
            </>
          )}
          <Field label="Maintenance (₹/month)"><input className="input" type="number" min="0" value={values.maintenanceMonthly} onChange={(e) => set('maintenanceMonthly', e.target.value)} /></Field>
          {isRent && <Field label="Security deposit (₹)"><input className="input" type="number" min="0" value={values.securityDeposit} onChange={(e) => set('securityDeposit', e.target.value)} /></Field>}
        </section>
      )}

      {step === 2 && (
        <section className="form-grid">
          <Field label="City" error={errors.city}><input className="input" value={values.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Gurugram" /></Field>
          <Field label="Locality / sector" error={errors.locality}><input className="input" value={values.locality} onChange={(e) => set('locality', e.target.value)} placeholder="e.g. Sector 56" /></Field>
          <Field label="State"><input className="input" value={values.state} onChange={(e) => set('state', e.target.value)} placeholder="e.g. Haryana" /></Field>
          <Field label="PIN code" error={errors.pinCode}><input className="input" inputMode="numeric" maxLength={6} value={values.pinCode} onChange={(e) => set('pinCode', e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Full address (shown publicly)" full hint="Leave out the flat number if you prefer — share it with serious buyers.">
            <input className="input" value={values.address} onChange={(e) => set('address', e.target.value)} />
          </Field>

          <div className="form-field form-field--full">
            <span className="form-field__label">Map location</span>
            <div className="geo-row">
              <input className="input" placeholder="Search address or landmark" value={geo.q} onChange={(e) => setGeo((g) => ({ ...g, q: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && searchAddress(e)} />
              <button type="button" className="btn btn--outline" onClick={searchAddress} disabled={geo.status === 'loading'}>{geo.status === 'loading' ? 'Searching…' : 'Find on map'}</button>
              <button type="button" className="btn btn--ghost" onClick={useMyLocation}>📍 I'm here</button>
            </div>
            {geo.items.length > 0 && (
              <ul className="geo-results">
                {geo.items.map((p) => (
                  <li key={`${p.lat},${p.lng}`}><button type="button" onClick={() => pickPlace(p)}>{p.label}</button></li>
                ))}
              </ul>
            )}
            {geo.message && <span className={geo.status === 'error' ? 'field-error' : 'hint'}>{geo.message}</span>}
            <div className="geo-row" style={{ marginTop: 8 }}>
              <input className="input" type="number" step="any" aria-label="Latitude" placeholder="Latitude" value={values.lat} onChange={(e) => set('lat', e.target.value)} />
              <input className="input" type="number" step="any" aria-label="Longitude" placeholder="Longitude" value={values.lng} onChange={(e) => set('lng', e.target.value)} />
            </div>
            {errors.lat && <span className="field-error">{errors.lat}</span>}
            <span className="hint">An accurate pin powers the nearby schools, metro and hospital analysis. Address search uses OpenStreetMap Nominatim.</span>
            {hasPin && <div style={{ marginTop: 10 }}><MapView properties={[{ id: 'pin', title: values.title || 'Your property', price: Number(values.price) || 0, listingType: values.listingType, location: { lat: Number(values.lat), lng: Number(values.lng) } }]} height={240} zoom={15} /></div>}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="form-grid">
          <div className="form-field form-field--full">
            <span className="form-field__label">Amenities</span>
            <div className="chip-row">
              {AMENITIES.map((a) => {
                const on = values.amenities.includes(a);
                return <button key={a} type="button" className={`chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => set('amenities', on ? values.amenities.filter((x) => x !== a) : [...values.amenities, a])}>{a}</button>;
              })}
            </div>
          </div>

          <div className="form-field form-field--full">
            <span className="form-field__label">Photos</span>
            <div
              className={`dropzone${upload.dragging ? ' is-drag' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setUpload((u) => ({ ...u, dragging: true })); }}
              onDragLeave={() => setUpload((u) => ({ ...u, dragging: false }))}
              onDrop={(e) => { e.preventDefault(); setUpload((u) => ({ ...u, dragging: false })); handleFiles(e.dataTransfer.files); }}
            >
              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
              <div className="dropzone__icon" aria-hidden="true">⬆</div>
              <p className="dropzone__text"><strong>Click to upload</strong> or drag &amp; drop</p>
              <p className="dropzone__hint">JPG, PNG or WEBP · up to 5MB each · first photo is the cover</p>
              {upload.busy && <p className="dropzone__busy">Uploading…</p>}
            </div>
            {upload.error && <span className="field-error">{upload.error}</span>}
            {values.images.length > 0 && (
              <div className="uploads-grid">
                {values.images.map((url, i) => (
                  <div className="uploads-grid__item" key={url}>
                    <img src={url} alt={`Photo ${i + 1}`} loading="lazy" onError={(e) => (e.currentTarget.style.opacity = 0.3)} />
                    {i === 0 && <span className="uploads-grid__badge">Cover</span>}
                    <div className="uploads-grid__tools">
                      <button type="button" aria-label="Move left" onClick={() => moveImage(i, -1)} disabled={i === 0}>‹</button>
                      <button type="button" aria-label="Move right" onClick={() => moveImage(i, 1)} disabled={i === values.images.length - 1}>›</button>
                    </div>
                    <button type="button" className="uploads-grid__remove" aria-label="Remove photo" onClick={() => set('images', values.images.filter((u) => u !== url))}>×</button>
                  </div>
                ))}
              </div>
            )}
            <details className="url-add">
              <summary>Or add a photo by URL</summary>
              <div className="geo-row">
                <input className="input" id="img-url" placeholder="https://…" />
                <button type="button" className="btn btn--outline" onClick={() => { const el = document.getElementById('img-url'); const u = el.value.trim(); if (/^https:\/\//.test(u)) { set('images', [...values.images, u]); el.value = ''; } }}>Add</button>
              </div>
              <span className="hint">Only use photos you own or have permission to use.</span>
            </details>
          </div>
          <Field label="Video tour URL (optional)" full><input className="input" value={values.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} placeholder="https://youtube.com/…" /></Field>
        </section>
      )}

      {step === 4 && (
        <section className="form-grid">
          {(user?.role === 'builder' || values.constructionStatus === 'under-construction' || values.developerName) && (
            <>
              <Field label="Developer / builder"><input className="input" value={values.developerName} onChange={(e) => set('developerName', e.target.value)} /></Field>
              {projects.length > 0 && (
                <Field label="Project">
                  <select className="select" value={values.project} onChange={(e) => set('project', e.target.value)}>
                    <option value="">Not part of a project</option>
                    {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          <div className="form-field form-field--full callout">
            <strong>RERA registration</strong>
            <p className="small muted">Required for most new projects being sold. PropFinder verifies the number against the official state portal — entering it does <em>not</em> make the listing “verified”.</p>
          </div>
          <Field label="RERA registration number">
            <input className="input" value={values.reraNumber} disabled={values.reraNotApplicable} onChange={(e) => set('reraNumber', e.target.value)} placeholder="As shown on the registration certificate" />
          </Field>
          <Field label="RERA state">
            <select className="select" value={values.reraState} disabled={values.reraNotApplicable} onChange={(e) => set('reraState', e.target.value)}>
              <option value="">Detect from city</option>
              {RERA_STATE_OPTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </Field>
          <Field label="Project name as registered" full><input className="input" value={values.reraProjectName} disabled={values.reraNotApplicable} onChange={(e) => set('reraProjectName', e.target.value)} /></Field>
          <label className="check form-field--full">
            <input type="checkbox" checked={values.reraNotApplicable} onChange={(e) => setValues((p) => ({ ...p, reraNotApplicable: e.target.checked, reraNumber: e.target.checked ? '' : p.reraNumber }))} />
            RERA registration does not apply (e.g. rental, resale in a pre-2017 project, or an exempt small project)
          </label>

          <div className="form-field form-field--full">
            <span className="form-field__label">Supporting documents (private)</span>
            <p className="hint">Registration certificate, approved plan, occupancy certificate… Only you and PropFinder reviewers can open them.</p>
            <input ref={docInputRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => { handleDocs(e.target.files); e.target.value = ''; }} />
            <button type="button" className="btn btn--outline btn--sm" onClick={() => docInputRef.current?.click()} disabled={docUpload.busy}>{docUpload.busy ? 'Uploading…' : 'Upload documents'}</button>
            {docUpload.error && <span className="field-error">{docUpload.error}</span>}
            {values.documents.length > 0 && (
              <ul className="evidence">
                {values.documents.map((d) => (
                  <li key={d.url}>
                    <button type="button" className="link-btn" onClick={() => openPrivateFile(d.url).catch(() => {})}>{d.name || 'Document'}</button>
                    <button type="button" className="link-btn small" onClick={() => set('documents', values.documents.filter((x) => x.url !== d.url))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Field label="How should buyers contact you?">
            <select className="select" value={values.contactPreference} onChange={(e) => set('contactPreference', e.target.value)}>
              <option value="both">Phone and messages</option>
              <option value="phone">Phone</option>
              <option value="chat">Messages only (hide my number)</option>
            </select>
          </Field>
        </section>
      )}

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <div className="form-actions">
        <button type="button" className="btn btn--ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0 || busy}>Back</button>
        <div className="btn-row">
          {allowDraft && <button type="button" className="btn btn--outline" onClick={() => submit('draft')} disabled={busy}>Save draft</button>}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn--primary" onClick={next} disabled={busy}>Next</button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => submit(showStatus ? values.status === 'draft' ? 'active' : values.status : 'active')} disabled={busy}>
              {busy ? <Loader label="Saving…" inline /> : submitLabel}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
