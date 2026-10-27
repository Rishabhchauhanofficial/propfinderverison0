/*
 * RERA (Real Estate (Regulation and Development) Act, 2016) support.
 *
 * Each state/UT runs its own authority, so a registration is only meaningful
 * against the authority for the project's location. Most portals offer a
 * public search page but no official machine-readable API, so the default
 * verification path is a manual review against the official portal. The
 * `officialAdapters` map is the integration boundary for any state where a
 * permitted official feed becomes available.
 *
 * Portal URLs are the authorities' public home/search pages; confirm them
 * periodically because state portals move.
 */

export const RERA_AUTHORITIES = {
  HR: { state: 'Haryana', authority: 'Haryana Real Estate Regulatory Authority (HRERA Gurugram / Panchkula)', url: 'https://haryanarera.gov.in' },
  DL: { state: 'Delhi', authority: 'Real Estate Regulatory Authority, Delhi', url: 'https://rera.delhi.gov.in' },
  UP: { state: 'Uttar Pradesh', authority: 'Uttar Pradesh Real Estate Regulatory Authority (UP RERA)', url: 'https://www.up-rera.in' },
  MH: { state: 'Maharashtra', authority: 'Maharashtra Real Estate Regulatory Authority (MahaRERA)', url: 'https://maharera.maharashtra.gov.in' },
  KA: { state: 'Karnataka', authority: 'Karnataka Real Estate Regulatory Authority (K-RERA)', url: 'https://rera.karnataka.gov.in' },
  TG: { state: 'Telangana', authority: 'Telangana State Real Estate Regulatory Authority (TG RERA)', url: 'https://rera.telangana.gov.in' },
  TN: { state: 'Tamil Nadu', authority: 'Tamil Nadu Real Estate Regulatory Authority (TNRERA)', url: 'https://www.rera.tn.gov.in' },
  GJ: { state: 'Gujarat', authority: 'Gujarat Real Estate Regulatory Authority (GujRERA)', url: 'https://gujrera.gujarat.gov.in' },
  WB: { state: 'West Bengal', authority: 'West Bengal Real Estate Regulatory Authority (WBRERA)', url: 'https://rera.wb.gov.in' },
  RJ: { state: 'Rajasthan', authority: 'Rajasthan Real Estate Regulatory Authority (RajRERA)', url: 'https://rera.rajasthan.gov.in' },
  PB: { state: 'Punjab', authority: 'Punjab Real Estate Regulatory Authority', url: 'https://rera.punjab.gov.in' },
  MP: { state: 'Madhya Pradesh', authority: 'Madhya Pradesh Real Estate Regulatory Authority (MPRERA)', url: 'https://www.rera.mp.gov.in' },
  KL: { state: 'Kerala', authority: 'Kerala Real Estate Regulatory Authority (K-RERA)', url: 'https://rera.kerala.gov.in' },
  AP: { state: 'Andhra Pradesh', authority: 'Andhra Pradesh Real Estate Regulatory Authority (AP RERA)', url: 'https://rera.ap.gov.in' },
  GA: { state: 'Goa', authority: 'Goa Real Estate Regulatory Authority', url: 'https://rera.goa.gov.in' },
  BR: { state: 'Bihar', authority: 'Bihar Real Estate Regulatory Authority', url: 'https://rera.bihar.gov.in' },
};

// Cities the platform currently covers → state code. Extend as coverage grows.
const CITY_STATE = {
  gurugram: 'HR', gurgaon: 'HR', faridabad: 'HR', panchkula: 'HR',
  delhi: 'DL', 'new delhi': 'DL',
  noida: 'UP', 'greater noida': 'UP', ghaziabad: 'UP', lucknow: 'UP',
  mumbai: 'MH', pune: 'MH', thane: 'MH', 'navi mumbai': 'MH', nagpur: 'MH',
  bengaluru: 'KA', bangalore: 'KA', mysuru: 'KA',
  hyderabad: 'TG', chennai: 'TN', coimbatore: 'TN',
  ahmedabad: 'GJ', surat: 'GJ', vadodara: 'GJ',
  kolkata: 'WB', jaipur: 'RJ', mohali: 'PB', chandigarh: 'PB', indore: 'MP', bhopal: 'MP',
  kochi: 'KL', thiruvananthapuram: 'KL', visakhapatnam: 'AP', vijayawada: 'AP', panaji: 'GA', patna: 'BR',
};

const STATE_NAME_TO_CODE = Object.fromEntries(
  Object.entries(RERA_AUTHORITIES).map(([code, a]) => [a.state.toLowerCase(), code])
);

/** Resolve a state code from an explicit state (code or name) or the city. */
export function stateCodeFor({ state, city } = {}) {
  const s = String(state || '').trim();
  if (s) {
    const upper = s.toUpperCase();
    if (RERA_AUTHORITIES[upper]) return upper;
    const byName = STATE_NAME_TO_CODE[s.toLowerCase()];
    if (byName) return byName;
  }
  return CITY_STATE[String(city || '').trim().toLowerCase()] || null;
}

export function authorityFor(code) {
  return code && RERA_AUTHORITIES[code] ? { code, ...RERA_AUTHORITIES[code] } : null;
}

export const STATUS_LABELS = {
  verified: 'RERA registration verified against official records',
  'found-needs-review': 'Registration found — details need review',
  'not-verified': 'Not yet verified',
  mismatch: 'Details do not match official records',
  'not-found': 'Registration not found in the checked source',
  'not-applicable': 'RERA registration not applicable',
  'not-provided': 'No RERA number provided',
};

/**
 * Plain-language applicability notes. RERA registration requirements depend
 * on the project, not the individual listing, and states can tighten the
 * thresholds. This is general information, not legal advice.
 */
export function applicabilityNotes(property = {}) {
  const notes = [];
  const isNewOrUnderConstruction =
    property.constructionStatus === 'under-construction' || Boolean(property.project);

  if (property.listingType === 'rent') {
    notes.push(
      'Rental listings of completed units generally do not need their own RERA registration; RERA governs the sale of units in registrable projects.'
    );
  }
  if (property.listingType === 'sale' && property.constructionStatus === 'ready' && !property.project) {
    notes.push(
      'For resale of a ready unit, check whether the original project was registered (projects completed before RERA took effect in 2017 were generally not required to register).'
    );
  }
  if (isNewOrUnderConstruction) {
    notes.push(
      'New and under-construction projects being marketed for sale normally must be registered with the state authority before advertising, unless an exemption applies.'
    );
  }
  notes.push(
    'Section 3 of the Act exempts projects where the land is 500 sq m or less, or where 8 or fewer apartments are planned (states may set lower thresholds), and certain renovation/repair works.'
  );
  notes.push(
    'A missing search result does not by itself prove that a project is unlawful — the number may be mistyped, the portal may be incomplete, or an exemption may apply.'
  );
  return notes;
}

export const DUE_DILIGENCE_CHECKLIST = [
  { item: 'RERA registration certificate and the project page on the state portal', who: 'You can check on the official portal' },
  { item: 'Title deed / sale deed chain (ideally 30 years) and mutation records', who: 'Property lawyer' },
  { item: 'Encumbrance certificate from the sub-registrar office', who: 'Property lawyer' },
  { item: 'Approved building plan and sanction from the local development authority', who: 'Lawyer or architect' },
  { item: 'Commencement certificate; occupancy / completion certificate for ready units', who: 'Lawyer' },
  { item: 'Land-use / conversion approval (e.g. agricultural to residential) for plots', who: 'Lawyer' },
  { item: 'No-objection certificates (fire, environment, airport height) where applicable', who: 'Lawyer' },
  { item: 'Builder–buyer agreement in the state RERA format; payment schedule', who: 'Lawyer' },
  { item: 'Society NOC and maintenance dues statement for resale flats', who: 'You, with the society office' },
  { item: 'Property tax receipts and utility bills up to date', who: 'You' },
  { item: 'Loan sanction from your lender (lenders run their own legal check)', who: 'Your bank or NBFC' },
];

export const RERA_SCOPE_DISCLAIMER =
  'A RERA registration check confirms that a project is registered with the state authority. It does not establish clear title, ownership, freedom from encumbrances, construction quality or full legal compliance. Get independent legal advice before paying any booking amount.';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|the|developers?|builders?|infra(structure)?|realty|projects?)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Compare what the lister submitted with the official record. */
export function computeDiscrepancies(submitted = {}, official = {}) {
  const out = [];
  if (official.projectName && submitted.projectName && norm(official.projectName) !== norm(submitted.projectName)) {
    out.push(`Project name differs: listing says "${submitted.projectName}", official record says "${official.projectName}".`);
  }
  if (official.promoterName && submitted.promoterName && norm(official.promoterName) !== norm(submitted.promoterName)) {
    out.push(`Promoter differs: listing says "${submitted.promoterName}", official record says "${official.promoterName}".`);
  }
  if (official.declaredCompletion && submitted.possessionDate) {
    const a = new Date(official.declaredCompletion);
    const b = new Date(submitted.possessionDate);
    if (b < a && (a - b) / 86400000 > 31) {
      out.push(
        `Listing promises possession by ${b.toISOString().slice(0, 10)}, earlier than the completion date declared to the authority (${a.toISOString().slice(0, 10)}).`
      );
    }
  }
  if (official.validUntil && new Date(official.validUntil) < new Date()) {
    out.push(`The registration validity on record ended on ${new Date(official.validUntil).toISOString().slice(0, 10)}; check whether it was extended.`);
  }
  return out;
}

/*
 * Official-feed adapters, keyed by state code. Each receives the number and
 * returns { found: boolean, official: {...}, sourceUrl } or throws.
 * None are bundled: no state portal currently provides a documented public API
 * we are permitted to call. Add adapters here once access is arranged.
 */
const officialAdapters = {};

export function hasOfficialAdapter(code) {
  return Boolean(officialAdapters[code]);
}

export async function checkOfficial(code, registrationNumber) {
  const adapter = officialAdapters[code];
  if (!adapter) return { available: false };
  const result = await adapter(registrationNumber);
  return { available: true, ...result };
}

/** Public, display-ready summary for a property/project. */
export function summarize({ property, record }) {
  const code = record?.state || stateCodeFor(property || {});
  const authority = authorityFor(code);
  const status = record?.status || property?.rera?.status || 'not-provided';
  return {
    status,
    label: STATUS_LABELS[status] || STATUS_LABELS['not-verified'],
    registrationNumber: record?.registrationNumber || property?.rera?.number || '',
    authority,
    officialUrl: record?.official?.sourceUrl || record?.officialUrl || authority?.url || '',
    method: record?.method || 'not-checked',
    lastVerifiedAt: record?.lastVerifiedAt || null,
    statusNote: record?.statusNote || '',
    official: record?.status && record.status !== 'not-verified' ? record.official : null,
    submitted: record?.submitted || null,
    discrepancies: record?.discrepancies || [],
    evidenceCount: record?.evidence?.length || 0,
    automatedCheckAvailable: hasOfficialAdapter(code),
    applicability: applicabilityNotes(property || {}),
    disclaimer: RERA_SCOPE_DISCLAIMER,
  };
}
