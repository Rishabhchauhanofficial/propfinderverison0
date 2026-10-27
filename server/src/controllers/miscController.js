import Property from '../models/Property.js';
import User from '../models/User.js';
import { ContactMessage, IntegrationEvent, Project, ReraRecord, Review } from '../models/index.js';
import { getNearby } from '../services/placesService.js';
import { findComparables } from '../services/comparablesService.js';
import { SCORE_DEFS, DISTANCE_BANDS, COMPONENTS, PRIORITY_MULTIPLIERS, COMPARABLES, YIELD_BANDS, SCORING_VERSION, EMPLOYMENT_HUBS } from '../config/scoring.js';
import { badRequest, cleanText, escapeRegex, str, wrap } from '../utils/http.js';

// GET /api/stats — real counts for the home page.
export const publicStats = wrap(async (req, res) => {
  const [listings, cities, localities, verifiedRera, demo, projects, reviews] = await Promise.all([
    Property.countDocuments({ status: 'active' }),
    Property.distinct('city', { status: 'active' }),
    Property.aggregate([{ $match: { status: 'active' } }, { $group: { _id: { c: '$city', l: '$locality' } } }, { $count: 'n' }]),
    Property.countDocuments({ status: 'active', 'rera.status': 'verified' }),
    Property.countDocuments({ status: 'active', isDemo: true }),
    Project.countDocuments(),
    Review.countDocuments({ status: 'published' }),
  ]);
  res.json({ listings, cities: cities.length, localities: localities[0]?.n || 0, verifiedRera, demoListings: demo, projects, reviews });
});

export const contact = wrap(async (req, res) => {
  const b = req.body || {};
  const name = cleanText(b.name, 120);
  const email = cleanText(b.email, 160).toLowerCase();
  const message = cleanText(b.message, 4000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw badRequest('Enter your name and a valid email.');
  if (message.length < 10) throw badRequest('Please write a little more about how we can help.');
  await ContactMessage.create({ name, email, message, topic: b.topic, user: req.userId || null });
  res.status(201).json({ ok: true, message: 'Thanks — our support team will reply by email.' });
});

/* ---------------- geocoding (Nominatim proxy, cached, ≤1 req/s) ---------------- */

const geoCache = new Map();
let lastGeocodeAt = 0;

export const geocode = wrap(async (req, res) => {
  const q = cleanText(req.query.q, 200);
  if (q.length < 3) throw badRequest('Type at least 3 characters.');
  if ((process.env.GEOCODER || 'nominatim') === 'none') return res.json({ status: 'not-configured', items: [] });
  const key = q.toLowerCase();
  if (geoCache.has(key)) return res.json({ status: 'ok', items: geoCache.get(key), cached: true });

  const wait = Math.max(0, lastGeocodeAt + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastGeocodeAt = Date.now();
  const started = Date.now();
  try {
    const base = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
    const url = `${base}/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=in&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'PropFinder/2.0 (listing geocoder)', 'accept-language': 'en' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
    const rows = await r.json();
    const items = rows.map((x) => ({
      label: x.display_name,
      lat: Number(x.lat),
      lng: Number(x.lon),
      city: x.address?.city || x.address?.town || x.address?.state_district || '',
      locality: x.address?.suburb || x.address?.neighbourhood || x.address?.city_district || '',
      state: x.address?.state || '',
      pinCode: x.address?.postcode || '',
    }));
    geoCache.set(key, items);
    if (geoCache.size > 500) geoCache.delete(geoCache.keys().next().value);
    IntegrationEvent.create({ service: 'geocoder:nominatim', ok: true, message: `${items.length} results`, latencyMs: Date.now() - started }).catch(() => {});
    res.json({ status: items.length ? 'ok' : 'empty', items, attribution: '© OpenStreetMap contributors' });
  } catch (err) {
    IntegrationEvent.create({ service: 'geocoder:nominatim', ok: false, message: err.message, latencyMs: Date.now() - started }).catch(() => {});
    res.json({ status: 'error', items: [], message: 'Address search is unavailable right now. Enter coordinates or drop a pin instead.' });
  }
});

/* ---------------- locality insights ---------------- */

export const localityInsights = wrap(async (req, res) => {
  const city = str(req.params.city);
  const locality = str(req.params.locality);
  const ci = (v) => new RegExp(`^${escapeRegex(v)}$`, 'i');
  const match = { status: 'active', city: ci(city), locality: ci(locality) };
  const [byType, coords, ratings] = await Promise.all([
    Property.aggregate([
      { $match: { ...match, areaSqft: { $gt: 0 } } },
      {
        $group: {
          _id: { listingType: '$listingType', propertyType: '$propertyType' },
          n: { $sum: 1 },
          perSqft: { $push: { $divide: ['$price', '$areaSqft'] } },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          demo: { $sum: { $cond: ['$isDemo', 1, 0] } },
        },
      },
    ]),
    Property.find({ ...match, 'location.lat': { $ne: null } }).select('location').lean(),
    Review.find({ targetKey: `${city.toLowerCase()}|${locality.toLowerCase()}`, status: 'published' }).select('ratings').lean(),
  ]);
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
  };
  const segments = byType.map((g) => ({
    listingType: g._id.listingType,
    propertyType: g._id.propertyType,
    count: g.n,
    medianPerSqft: g.n >= 3 ? Math.round(median(g.perSqft) * (g._id.listingType === 'rent' ? 100 : 1)) / (g._id.listingType === 'rent' ? 100 : 1) : null,
    minPrice: g.minPrice,
    maxPrice: g.maxPrice,
    demoCount: g.demo,
  }));

  let center = null;
  let nearby = { status: 'no-coordinates', categories: null, message: 'No listings here have map coordinates yet.' };
  if (coords.length) {
    center = {
      lat: coords.reduce((a, c) => a + c.location.lat, 0) / coords.length,
      lng: coords.reduce((a, c) => a + c.location.lng, 0) / coords.length,
    };
    nearby = await getNearby(center);
  }
  res.json({
    city,
    locality,
    center,
    centerNote: 'Centre is the average position of listings here, used for nearby-facility lookups.',
    segments,
    benchmarkNote: 'Median asking price per sq ft from active PropFinder listings (shown when at least 3 listings exist). These are not transaction prices.',
    nearby,
    reviewSummary: { count: ratings.length, avg: ratings.length ? Math.round((ratings.reduce((a, r) => a + r.ratings.overall, 0) / ratings.length) * 10) / 10 : null },
  });
});

// GET /api/methodology — the live scoring configuration for the methodology page.
export const methodology = wrap(async (req, res) => {
  res.json({ version: SCORING_VERSION, scores: SCORE_DEFS, distanceBands: DISTANCE_BANDS, components: COMPONENTS, priorities: PRIORITY_MULTIPLIERS, comparables: COMPARABLES, yieldBands: YIELD_BANDS, hubs: EMPLOYMENT_HUBS.map((h) => h.name) });
});

// GET /api/market/benchmark?city&locality&propertyType&listingType — quick comparable stats.
export const benchmark = wrap(async (req, res) => {
  const subject = { _id: null, city: str(req.query.city), locality: str(req.query.locality), propertyType: str(req.query.propertyType) || 'apartment', listingType: str(req.query.listingType) || 'sale', areaSqft: Number(req.query.areaSqft) || 0, location: null };
  if (!subject.city) throw badRequest('City is required');
  const comps = await findComparables(subject);
  res.json({ n: comps.n, scope: comps.scope, stats: comps.stats, demoCount: comps.demoCount || 0, basis: 'asking-prices' });
});

export const health = wrap(async (req, res) => {
  const [users, rera] = await Promise.all([User.estimatedDocumentCount(), ReraRecord.estimatedDocumentCount()]);
  res.json({ ok: true, service: 'propfinder-api', users, reraRecords: rera });
});
