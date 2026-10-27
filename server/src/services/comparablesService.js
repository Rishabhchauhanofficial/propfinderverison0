/*
 * Comparable listings for price benchmarking. Uses ASKING prices of active
 * listings on this platform — never presented as transaction prices.
 */
import Property, { COMMERCIAL_TYPES } from '../models/Property.js';
import { COMPARABLES } from '../config/scoring.js';
import { escapeRegex } from '../utils/http.js';
import { haversineKm, isValidCoords } from '../utils/geo.js';

const ci = (v) => new RegExp(`^${escapeRegex(String(v).trim())}$`, 'i');
const typeGroup = (t) => (COMMERCIAL_TYPES.includes(t) ? COMMERCIAL_TYPES : t === 'plot' ? ['plot'] : ['apartment', 'villa', 'independent-house', 'builder-floor']);

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

/**
 * Finds comparable listings in widening tiers and returns the first tier with
 * enough samples. listingType decides sale-price or rent comparables.
 */
export async function findComparables(subject, { listingType = subject.listingType } = {}) {
  const base = {
    _id: { $ne: subject._id },
    status: 'active',
    listingType,
    price: { $gt: 0 },
    areaSqft: { $gt: 0 },
  };
  const area = Number(subject.areaSqft) || 0;
  const areaRange = area
    ? { $gte: area * (1 - COMPARABLES.areaTolerance), $lte: area * (1 + COMPARABLES.areaTolerance) }
    : undefined;

  const tiers = [
    {
      scope: 'Same locality, same property type, similar size',
      filter: { ...base, city: ci(subject.city), locality: ci(subject.locality), propertyType: subject.propertyType, ...(areaRange ? { areaSqft: areaRange } : {}) },
    },
    {
      scope: 'Same locality, similar property types',
      filter: { ...base, city: ci(subject.city), locality: ci(subject.locality), propertyType: { $in: typeGroup(subject.propertyType) } },
    },
    {
      scope: `Within ${COMPARABLES.cityRadiusKm} km, same property type`,
      geo: true,
      filter: { ...base, city: ci(subject.city), propertyType: subject.propertyType },
    },
    {
      scope: 'Same city, same property type',
      filter: { ...base, city: ci(subject.city), propertyType: subject.propertyType },
    },
  ];

  const hasGeo = isValidCoords(subject.location);
  for (const tier of tiers) {
    if (tier.geo && !hasGeo) continue;
    let docs = await Property.find(tier.filter)
      .select('title slug price areaSqft propertyType bedrooms locality city location createdAt isDemo listingType')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    if (tier.geo) {
      docs = docs
        .filter((d) => isValidCoords(d.location))
        .map((d) => ({ ...d, distanceKm: haversineKm(subject.location, d.location) }))
        .filter((d) => d.distanceKm <= COMPARABLES.cityRadiusKm);
    } else if (hasGeo) {
      docs = docs.map((d) => ({ ...d, distanceKm: isValidCoords(d.location) ? haversineKm(subject.location, d.location) : null }));
    }
    docs = docs.slice(0, COMPARABLES.maxSample);
    if (docs.length >= COMPARABLES.minSample) return summarize(docs, tier.scope);
  }
  return { n: 0, scope: null, items: [], stats: null };
}

function summarize(docs, scope) {
  const perSqft = docs.map((d) => d.price / d.areaSqft);
  const dates = docs.map((d) => new Date(d.createdAt).getTime());
  return {
    n: docs.length,
    scope,
    stats: stats(perSqft),
    period: { from: new Date(Math.min(...dates)), to: new Date(Math.max(...dates)) },
    demoCount: docs.filter((d) => d.isDemo).length,
    items: docs.slice(0, 6).map((d) => ({
      id: String(d._id),
      slug: d.slug,
      title: d.title,
      price: d.price,
      areaSqft: d.areaSqft,
      perSqft: Math.round(d.price / d.areaSqft),
      bedrooms: d.bedrooms,
      locality: d.locality,
      distanceKm: d.distanceKm != null ? Math.round(d.distanceKm * 10) / 10 : null,
      isDemo: Boolean(d.isDemo),
    })),
  };
}

/** Price position of the subject vs. its comparables. */
export function pricePosition(subject, comps) {
  if (!comps?.stats || comps.n < COMPARABLES.minSample || !(subject.areaSqft > 0)) {
    return {
      verdict: 'insufficient-data',
      deltaPct: null,
      thisPerSqft: subject.areaSqft > 0 ? Math.round(subject.price / subject.areaSqft) : null,
      medianPerSqft: comps?.stats ? Math.round(comps.stats.median) : null,
      sampleSize: comps?.n || 0,
    };
  }
  const thisPerSqft = subject.price / subject.areaSqft;
  const deltaPct = Math.round(((thisPerSqft - comps.stats.median) / comps.stats.median) * 1000) / 10;
  const band = COMPARABLES.fairBandPct;
  return {
    verdict: deltaPct < -band ? 'below-market' : deltaPct > band ? 'above-market' : 'near-market',
    deltaPct,
    thisPerSqft: Math.round(thisPerSqft),
    medianPerSqft: Math.round(comps.stats.median),
    p25PerSqft: Math.round(comps.stats.p25),
    p75PerSqft: Math.round(comps.stats.p75),
    sampleSize: comps.n,
  };
}
