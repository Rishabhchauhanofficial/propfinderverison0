/*
 * Nearby facilities around a coordinate.
 *
 * Providers (NEARBY_PROVIDER):
 *   overpass (default) — OpenStreetMap data via the Overpass API. Free, no key,
 *                        ODbL licence: attribution "© OpenStreetMap contributors"
 *                        is required. Public instances are rate-limited, so
 *                        results are cached (NEARBY_CACHE_DAYS, default 30).
 *   google            — Google Places API (New) Nearby Search. Needs
 *                        GOOGLE_MAPS_API_KEY; provides ratings with attribution.
 *   none              — disabled; reports "not configured".
 *   fixture           — deterministic test data, ONLY for automated tests.
 *
 * Distances are straight-line (haversine). Road distance and travel time are
 * added only when a routing provider is configured (ROUTING_PROVIDER=osrm +
 * OSRM_URL). Nothing here invents places: an empty or failed lookup is
 * reported as such.
 */
import { NearbyCache, IntegrationEvent } from '../models/index.js';
import { haversineKm, isValidCoords } from '../utils/geo.js';

export const CATEGORIES = {
  school: { label: 'Schools', group: 'education', radiusKm: 3 },
  college: { label: 'Colleges & universities', group: 'education', radiusKm: 5 },
  hospital: { label: 'Hospitals', group: 'healthcare', radiusKm: 5 },
  clinic: { label: 'Clinics', group: 'healthcare', radiusKm: 2 },
  pharmacy: { label: 'Pharmacies', group: 'healthcare', radiusKm: 2 },
  supermarket: { label: 'Supermarkets', group: 'daily', radiusKm: 2 },
  mall: { label: 'Shopping malls', group: 'shopping', radiusKm: 5 },
  market: { label: 'Local markets', group: 'daily', radiusKm: 3 },
  metro: { label: 'Metro stations', group: 'transport', radiusKm: 5 },
  railway: { label: 'Railway stations', group: 'transport', radiusKm: 10 },
  bus_stop: { label: 'Bus stops', group: 'transport', radiusKm: 1.5 },
  airport: { label: 'Airports', group: 'transport', radiusKm: 40 },
  major_road: { label: 'Highways & major roads', group: 'transport', radiusKm: 3 },
  park: { label: 'Parks', group: 'lifestyle', radiusKm: 2 },
  gym: { label: 'Gyms', group: 'lifestyle', radiusKm: 2 },
  restaurant: { label: 'Restaurants', group: 'lifestyle', radiusKm: 1.5 },
  bank: { label: 'Banks', group: 'daily', radiusKm: 2 },
  atm: { label: 'ATMs', group: 'daily', radiusKm: 1.5 },
  fuel: { label: 'Petrol pumps', group: 'daily', radiusKm: 3 },
  ev_charging: { label: 'EV charging', group: 'daily', radiusKm: 5 },
};

const MAX_PER_CATEGORY = 6;
const TIMEOUT_MS = Number(process.env.NEARBY_TIMEOUT_MS) || 60000;
// Keep this short: some Overpass front-ends reject long agent strings (HTTP 406).
const UA = process.env.PLACES_USER_AGENT || 'PropFinder/2.0';
const OVERPASS_MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

export const providerName = () => String(process.env.NEARBY_PROVIDER || 'overpass').toLowerCase();
export const routingEnabled = () =>
  String(process.env.ROUTING_PROVIDER || '').toLowerCase() === 'osrm' && Boolean(process.env.OSRM_URL);

const cacheDays = () => Number(process.env.NEARBY_CACHE_DAYS) || 30;

export const ATTRIBUTION = {
  overpass: { text: '© OpenStreetMap contributors (ODbL)', url: 'https://www.openstreetmap.org/copyright' },
  google: { text: 'Places data © Google', url: 'https://maps.google.com' },
  fixture: { text: 'Test fixture data — not real places', url: '' },
};

async function logIntegration(service, ok, message, latencyMs) {
  try {
    await IntegrationEvent.create({ service, ok, message: String(message || '').slice(0, 300), latencyMs });
  } catch {
    /* non-critical */
  }
}

/* ---------------- Overpass ---------------- */

function overpassQuery(lat, lng) {
  const a = (cat) => Math.round(CATEGORIES[cat].radiusKm * 1000);
  const around = (cat) => `(around:${a(cat)},${lat},${lng})`;
  const nw = (cat, filter) => `nwr${filter}${around(cat)};`;
  return `[out:json][timeout:60];
(
  ${nw('school', '["amenity"="school"]')}
  ${nw('college', '["amenity"~"^(college|university)$"]')}
  ${nw('hospital', '["amenity"="hospital"]')}
  ${nw('clinic', '["amenity"~"^(clinic|doctors)$"]')}
  ${nw('pharmacy', '["amenity"="pharmacy"]')}
  ${nw('supermarket', '["shop"="supermarket"]')}
  ${nw('mall', '["shop"="mall"]')}
  ${nw('market', '["amenity"="marketplace"]')}
  ${nw('metro', '["railway"="station"]["station"~"^(subway|light_rail|monorail)$"]')}
  ${nw('metro', '["railway"="station"]["subway"="yes"]')}
  ${nw('railway', '["railway"="station"]["station"!~"^(subway|light_rail|monorail)$"]["subway"!="yes"]')}
  ${nw('bus_stop', '["highway"="bus_stop"]')}
  ${nw('airport', '["aeroway"="aerodrome"]["iata"]')}
  ${nw('park', '["leisure"="park"]')}
  ${nw('gym', '["leisure"="fitness_centre"]')}
  ${nw('restaurant', '["amenity"="restaurant"]')}
  ${nw('bank', '["amenity"="bank"]')}
  ${nw('atm', '["amenity"="atm"]')}
  ${nw('fuel', '["amenity"="fuel"]')}
  ${nw('ev_charging', '["amenity"="charging_station"]')}
);
out center tags qt 600;
way["highway"~"^(motorway|trunk)$"]${around('major_road')};
out geom tags qt 40;`;
}

function categorize(tags = {}) {
  const t = tags;
  if (t.amenity === 'school') return 'school';
  if (t.amenity === 'college' || t.amenity === 'university') return 'college';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'clinic' || t.amenity === 'doctors') return 'clinic';
  if (t.amenity === 'pharmacy') return 'pharmacy';
  if (t.shop === 'supermarket') return 'supermarket';
  if (t.shop === 'mall') return 'mall';
  if (t.amenity === 'marketplace') return 'market';
  if (t.railway === 'station') {
    return ['subway', 'light_rail', 'monorail'].includes(t.station) || t.subway === 'yes' ? 'metro' : 'railway';
  }
  if (t.highway === 'bus_stop') return 'bus_stop';
  if (t.aeroway === 'aerodrome') return 'airport';
  if (t.highway === 'motorway' || t.highway === 'trunk') return 'major_road';
  if (t.leisure === 'park') return 'park';
  if (t.leisure === 'fitness_centre') return 'gym';
  if (t.amenity === 'restaurant') return 'restaurant';
  if (t.amenity === 'bank') return 'bank';
  if (t.amenity === 'atm') return 'atm';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.amenity === 'charging_station') return 'ev_charging';
  return null;
}

async function overpassRequest(query) {
  // OVERPASS_URL may list several endpoints (comma-separated); busy servers (429/5xx) fall through to the next.
  const urls = process.env.OVERPASS_URL
    ? process.env.OVERPASS_URL.split(',').map((u) => u.trim()).filter(Boolean)
    : OVERPASS_MIRRORS;
  let lastError;
  for (const [i, url] of urls.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500 * i));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return res.json();
      lastError = new Error(`Overpass HTTP ${res.status} (${new URL(url).host})`);
      if (![429, 502, 503, 504].includes(res.status)) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Overpass unavailable');
}

async function fetchOverpass(origin) {
  const data = await overpassRequest(overpassQuery(origin.lat, origin.lng));

  const places = [];
  for (const el of data.elements || []) {
    const category = categorize(el.tags);
    if (!category) continue;
    let point = null;
    let distanceKm;
    if (Array.isArray(el.geometry) && el.geometry.length) {
      // Roads: nearest vertex of the way.
      let best = Infinity;
      for (const g of el.geometry) {
        const d = haversineKm(origin, { lat: g.lat, lng: g.lon });
        if (d < best) {
          best = d;
          point = { lat: g.lat, lng: g.lon };
        }
      }
      distanceKm = best;
    } else {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      point = { lat, lng };
      distanceKm = haversineKm(origin, point);
    }
    const name = el.tags?.name || el.tags?.['name:en'] || el.tags?.ref || '';
    places.push({
      id: `osm:${el.type}/${el.id}`,
      category,
      name,
      lat: point.lat,
      lng: point.lng,
      distanceKm: Math.round(distanceKm * 100) / 100,
      tags: pickTags(el.tags),
    });
  }
  return places;
}

function pickTags(tags = {}) {
  const out = {};
  for (const k of ['operator', 'isced:level', 'school:type', 'healthcare', 'emergency', 'iata', 'network', 'ref']) {
    if (tags[k]) out[k] = tags[k];
  }
  return out;
}

/* ---------------- Google Places (New) ---------------- */

const GOOGLE_TYPES = {
  school: ['school', 'primary_school', 'secondary_school'],
  college: ['university'],
  hospital: ['hospital'],
  clinic: ['doctor', 'medical_clinic'],
  pharmacy: ['pharmacy'],
  supermarket: ['supermarket', 'grocery_store'],
  mall: ['shopping_mall'],
  market: ['market'],
  metro: ['subway_station', 'light_rail_station'],
  railway: ['train_station'],
  bus_stop: ['bus_stop', 'bus_station'],
  airport: ['international_airport', 'airport'],
  park: ['park'],
  gym: ['gym'],
  restaurant: ['restaurant'],
  bank: ['bank'],
  atm: ['atm'],
  fuel: ['gas_station'],
  ev_charging: ['electric_vehicle_charging_station'],
};

async function fetchGoogle(origin) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const places = [];
  for (const [category, types] of Object.entries(GOOGLE_TYPES)) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount',
      },
      body: JSON.stringify({
        includedTypes: types,
        maxResultCount: MAX_PER_CATEGORY,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: CATEGORIES[category].radiusKm * 1000 },
        },
      }),
    });
    if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);
    const data = await res.json();
    for (const p of data.places || []) {
      const point = { lat: p.location.latitude, lng: p.location.longitude };
      places.push({
        id: `google:${p.id}`,
        category,
        name: p.displayName?.text || '',
        ...point,
        distanceKm: Math.round(haversineKm(origin, point) * 100) / 100,
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? null,
        ratingSource: p.rating ? 'Google' : null,
      });
    }
  }
  return places;
}

/* ---------------- fixture (tests only) ---------------- */

function fixturePlaces(origin) {
  const mk = (category, name, dLat, dLng) => {
    const point = { lat: origin.lat + dLat, lng: origin.lng + dLng };
    return { id: `fixture:${category}:${name}`, category, name, ...point, distanceKm: Math.round(haversineKm(origin, point) * 100) / 100 };
  };
  return [
    mk('school', 'Fixture Public School', 0.004, 0.002),
    mk('school', 'Fixture High School', 0.012, -0.004),
    mk('hospital', 'Fixture General Hospital', -0.01, 0.006),
    mk('metro', 'Fixture Metro Station', 0.006, 0.006),
    mk('supermarket', 'Fixture Mart', 0.002, -0.002),
    mk('park', 'Fixture Park', -0.003, 0.001),
    mk('pharmacy', 'Fixture Pharmacy', 0.001, 0.001),
  ];
}

/* ---------------- routing (optional) ---------------- */

async function addRouting(origin, places) {
  if (!routingEnabled() || places.length === 0) return { routed: false };
  const targets = places.slice(0, 25);
  const coords = [origin, ...targets].map((p) => `${p.lng},${p.lat}`).join(';');
  const base = process.env.OSRM_URL.replace(/\/+$/, '');
  const started = Date.now();
  try {
    const res = await fetch(`${base}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();
    const durations = data.durations?.[0] || [];
    const distances = data.distances?.[0] || [];
    targets.forEach((p, i) => {
      const dur = durations[i + 1];
      const dist = distances[i + 1];
      if (Number.isFinite(dur)) p.driveMinutes = Math.round(dur / 60);
      if (Number.isFinite(dist)) p.roadDistanceKm = Math.round(dist / 100) / 10;
    });
    await logIntegration('routing', true, 'ok', Date.now() - started);
    return { routed: true };
  } catch (err) {
    await logIntegration('routing', false, err.message, Date.now() - started);
    return { routed: false, error: err.message };
  }
}

/* ---------------- public API ---------------- */

function groupPlaces(places) {
  const byCategory = {};
  for (const key of Object.keys(CATEGORIES)) byCategory[key] = { count: 0, nearest: [] };
  const sorted = [...places].sort((a, b) => a.distanceKm - b.distanceKm);
  for (const p of sorted) {
    const bucket = byCategory[p.category];
    if (!bucket) continue;
    bucket.count += 1;
    // Show named places first; unnamed ones still count.
    if (p.name && bucket.nearest.length < MAX_PER_CATEGORY) bucket.nearest.push(p);
  }
  for (const [key, bucket] of Object.entries(byCategory)) {
    const nearestAny = sorted.find((p) => p.category === key);
    bucket.nearestKm = nearestAny ? nearestAny.distanceKm : null;
  }
  return byCategory;
}

/**
 * Returns { status: 'ok'|'empty'|'error'|'not-configured'|'no-coordinates', provider,
 *           fetchedAt, attribution, distanceMethod, routed, categories, error? }
 */
export async function getNearby(location, { refresh = false } = {}) {
  const provider = providerName();
  if (!isValidCoords(location)) {
    return { status: 'no-coordinates', provider, categories: null, message: 'The listing has no map coordinates.' };
  }
  if (provider === 'none') {
    return {
      status: 'not-configured',
      provider,
      categories: null,
      message: 'Nearby-facility lookups are disabled (NEARBY_PROVIDER=none).',
    };
  }

  const origin = { lat: Number(location.lat), lng: Number(location.lng) };
  const key = `${provider}|${origin.lat.toFixed(4)}|${origin.lng.toFixed(4)}`;
  const maxAge = cacheDays() * 86400000;

  const cached = await NearbyCache.findOne({ key }).lean();
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
  const usable = cached && cached.status !== 'error';
  // Failed lookups are retried after 10 minutes rather than cached for weeks.
  const needsFetch = refresh || !cached || (usable ? age >= maxAge : age >= ERROR_RETRY_MS);

  if (!needsFetch) return usable ? present(cached, provider) : errorResult(provider, cached.error);

  const job = startFetch(key, provider, origin);
  if (usable) {
    // Serve the stale copy while the refresh runs in the background.
    job.catch(() => {});
    return present({ ...cached, stale: true }, provider);
  }
  const result = await Promise.race([job, new Promise((r) => setTimeout(() => r(PENDING), waitMs()))]);
  if (result === PENDING) {
    job.catch(() => {});
    return {
      status: 'pending',
      provider,
      categories: null,
      message: 'Nearby-facility data is being fetched from the map service. This can take up to a minute the first time.',
    };
  }
  return result;
}

const PENDING = Symbol('pending');
const ERROR_RETRY_MS = 10 * 60000;
// How long a request waits for a fresh lookup before answering "pending".
const waitMs = () => Number(process.env.NEARBY_WAIT_MS) || 3000;
const inflight = new Map();

function errorResult(provider, error) {
  return {
    status: 'error',
    provider,
    categories: null,
    message: 'The nearby-places service could not be reached. Try again later.',
    error,
  };
}

function present(doc, provider) {
  return {
    status: doc.status,
    provider,
    fetchedAt: doc.fetchedAt,
    stale: Boolean(doc.stale),
    attribution: ATTRIBUTION[provider] || null,
    distanceMethod: 'straight-line',
    routed: doc.places.some((p) => Number.isFinite(p.driveMinutes)),
    categories: groupPlaces(doc.places),
    meta: CATEGORIES,
  };
}

/** One lookup per location at a time; resolves to a presented result (never rejects for provider errors). */
function startFetch(key, provider, origin) {
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const started = Date.now();
    try {
      let places;
      if (provider === 'google') places = await fetchGoogle(origin);
      else if (provider === 'fixture') places = fixturePlaces(origin);
      else places = await fetchOverpass(origin);
      await addRouting(origin, places.filter((p) => ['metro', 'railway', 'airport', 'hospital', 'school'].includes(p.category) && p.name).slice(0, 25));
      const doc = await NearbyCache.findOneAndUpdate(
        { key },
        { key, provider, status: places.length ? 'ok' : 'empty', places, error: '', fetchedAt: new Date() },
        { upsert: true, new: true }
      ).lean();
      await logIntegration(`places:${provider}`, true, `${places.length} places`, Date.now() - started);
      return present(doc, provider);
    } catch (err) {
      await logIntegration(`places:${provider}`, false, err.message, Date.now() - started);
      const prev = await NearbyCache.findOne({ key }).lean();
      // Never overwrite good (stale) data with an error.
      if (prev && prev.status !== 'error') return present({ ...prev, stale: true }, provider);
      await NearbyCache.findOneAndUpdate(
        { key },
        { key, provider, status: 'error', places: [], error: err.message, fetchedAt: new Date() },
        { upsert: true }
      );
      return errorResult(provider, err.message);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/** Compact nearest-distance summary stored on Property for filtering. */
export function summaryFrom(nearby) {
  if (!nearby?.categories) return null;
  const out = {};
  for (const [k, v] of Object.entries(nearby.categories)) out[k] = v.nearestKm;
  out.fetchedAt = nearby.fetchedAt;
  return out;
}
