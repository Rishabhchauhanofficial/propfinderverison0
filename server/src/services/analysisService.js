/*
 * AI Property Intelligence Report.
 *
 * Deterministic evidence first (nearby places, comparables, RERA records,
 * listing completeness), then — only if an LLM is configured — a narrative
 * written strictly from that evidence. Every score carries its method,
 * inputs and confidence; missing data yields null, never a guess.
 */
import crypto from 'node:crypto';
import Property from '../models/Property.js';
import { AnalysisReport, ReraRecord } from '../models/index.js';
import {
  COMPONENTS,
  CONFIDENCE,
  EMPLOYMENT_HUBS,
  PRIORITY_MULTIPLIERS,
  SCORE_DEFS,
  SCORING_VERSION,
  YIELD_BANDS,
  YIELD_FLOOR,
  bandScore,
  COMPARABLES,
} from '../config/scoring.js';
import { CATEGORIES, getNearby, summaryFrom } from './placesService.js';
import { findComparables, pricePosition } from './comparablesService.js';
import { summarize as reraSummary, DUE_DILIGENCE_CHECKLIST } from './reraService.js';
import { complete, llmEnabled, parseJsonObject, asData, UNTRUSTED_RULE } from './llmService.js';
import { haversineKm, isValidCoords } from '../utils/geo.js';
import { formatINR, bhkLabel, propertyTypeLabel } from '../utils/format.js';

export const DISCLAIMER =
  'These scores are automated estimates built from the data listed under each score. They are not guarantees of investment performance, property quality, legal title or future appreciation, and they are not legal or financial advice.';

const round = (n) => Math.round(n);
const pct = (n) => Math.round(n * 10) / 10;

function confidenceFromShare(share) {
  if (share >= CONFIDENCE.high) return 'high';
  if (share >= CONFIDENCE.medium) return 'medium';
  if (share > 0) return 'low';
  return 'none';
}

/* ---------------- locality scores from nearby places ---------------- */

function nearestHub(p) {
  if (!isValidCoords(p.location)) return null;
  let best = null;
  for (const h of EMPLOYMENT_HUBS) {
    const d = haversineKm(p.location, h);
    if (!best || d < best.distanceKm) best = { name: h.name, distanceKm: Math.round(d * 10) / 10 };
  }
  return best && best.distanceKm <= 40 ? best : null;
}

function localityScore(key, nearby, extra = {}) {
  const def = SCORE_DEFS[key];
  if (!nearby?.categories) {
    return {
      key,
      label: def.label,
      value: null,
      confidence: 'none',
      method: 'Distance bands to nearby facilities.',
      explanation:
        nearby?.status === 'no-coordinates'
          ? 'The listing has no map pin, so nearby facilities cannot be measured.'
          : nearby?.message || 'Nearby-facility data is unavailable.',
      inputs: [],
    };
  }
  const comps = COMPONENTS[key];
  let total = 0;
  let weight = 0;
  const inputs = [];
  for (const [comp, w] of Object.entries(comps)) {
    let points;
    let input;
    if (comp === 'schoolCount') {
      const n = nearby.categories.school?.count ?? 0;
      points = Math.min(n, 5) * 20;
      input = { factor: 'Schools within 3 km', value: `${n}`, points };
    } else if (comp === 'hub') {
      const hub = extra.hub;
      if (!hub) continue; // no curated hub nearby: excluded, not penalised
      points = bandScore('hub', hub.distanceKm);
      input = { factor: 'Nearest major employment hub (approximate)', value: `${hub.name} — ${hub.distanceKm} km`, points };
    } else {
      const cat = nearby.categories[comp];
      if (!cat) continue;
      points = bandScore(comp, cat.nearestKm);
      const nearestNamed = cat.nearest?.[0];
      input = {
        factor: `Nearest ${CATEGORIES[comp].label.toLowerCase()}`,
        value:
          cat.nearestKm == null
            ? `none found within ${CATEGORIES[comp].radiusKm} km`
            : `${cat.nearestKm} km${nearestNamed ? ` (${nearestNamed.name})` : ''}`,
        points,
      };
    }
    total += points * w;
    weight += w;
    inputs.push(input);
  }
  const value = weight ? round(total / weight) : null;
  const totalWeight = Object.values(comps).reduce((a, b) => a + b, 0);
  return {
    key,
    label: def.label,
    value,
    // Map data can be incomplete, so locality scores never claim "high" confidence on coverage alone.
    confidence: value === null ? 'none' : confidenceFromShare(weight / totalWeight) === 'high' ? 'medium' : 'low',
    method:
      'Each factor is scored from straight-line distance bands (closer is better) and the factors are averaged with fixed weights. Facilities missing from the map source lower the score, which may understate areas with sparse map coverage.',
    explanation: explainLocality(key, inputs, value),
    inputs,
  };
}

function explainLocality(key, inputs, value) {
  if (value === null) return 'Not enough data.';
  const strong = inputs.filter((i) => i.points >= 80).map((i) => i.factor.replace(/^Nearest /, ''));
  const weak = inputs.filter((i) => i.points <= 30).map((i) => i.factor.replace(/^Nearest /, ''));
  const parts = [];
  if (strong.length) parts.push(`Strong: ${strong.slice(0, 3).join(', ')}.`);
  if (weak.length) parts.push(`Weak or not found nearby: ${weak.slice(0, 3).join(', ')}.`);
  return parts.join(' ') || 'Mixed access across the measured factors.';
}

/* ---------------- price & rental ---------------- */

function priceScore(position, comps) {
  const def = SCORE_DEFS.price;
  if (position.verdict === 'insufficient-data') {
    return {
      key: 'price',
      label: def.label,
      value: null,
      confidence: 'none',
      method: `Needs at least ${COMPARABLES.minSample} comparable active listings.`,
      explanation: `Only ${position.sampleSize} comparable listing(s) found, so no price verdict is given.`,
      inputs: [],
    };
  }
  const value = Math.max(5, Math.min(100, round(60 - position.deltaPct * 1.5)));
  const confidence =
    comps.n >= COMPARABLES.highConfidenceSample ? 'high' : comps.n >= COMPARABLES.mediumConfidenceSample ? 'medium' : 'low';
  return {
    key: 'price',
    label: def.label,
    value,
    confidence,
    method:
      'Compares this listing’s asking price per sq ft with the median of comparable active listings (asking prices, not transactions). At the median the score is 60; each 1% below adds 1.5 points, each 1% above subtracts 1.5.',
    explanation: `Asking ₹${position.thisPerSqft.toLocaleString('en-IN')}/sq ft vs comparable median ₹${position.medianPerSqft.toLocaleString('en-IN')}/sq ft (${position.deltaPct > 0 ? '+' : ''}${position.deltaPct}%, ${comps.n} listings: ${comps.scope.toLowerCase()}).`,
    inputs: [
      { factor: 'This listing', value: `₹${position.thisPerSqft.toLocaleString('en-IN')}/sq ft` },
      { factor: 'Comparable median', value: `₹${position.medianPerSqft.toLocaleString('en-IN')}/sq ft` },
      { factor: 'Middle 50% range', value: `₹${position.p25PerSqft.toLocaleString('en-IN')} – ₹${position.p75PerSqft.toLocaleString('en-IN')}` },
      { factor: 'Sample', value: `${comps.n} listings${comps.demoCount ? ` (${comps.demoCount} demo)` : ''}` },
    ],
  };
}

function rentalAnalysis(p, rentComps) {
  if (p.listingType === 'rent') {
    return { applicable: false, reason: 'This is a rental listing.' };
  }
  if (p.propertyType === 'plot') return { applicable: false, reason: 'Plots do not usually generate rent.' };
  if (!rentComps?.stats || rentComps.n < COMPARABLES.minSample) {
    return {
      applicable: true,
      estimateMonthly: null,
      grossYieldPct: null,
      sampleSize: rentComps?.n || 0,
      note: 'Not enough comparable rental listings to estimate rent.',
    };
  }
  const monthly = rentComps.stats.median * p.areaSqft;
  const low = rentComps.stats.p25 * p.areaSqft;
  const high = rentComps.stats.p75 * p.areaSqft;
  const yieldPct = pct(((monthly * 12) / p.price) * 100);
  return {
    applicable: true,
    estimateMonthly: round(monthly / 500) * 500,
    rangeMonthly: [round(low / 500) * 500, round(high / 500) * 500],
    grossYieldPct: yieldPct,
    sampleSize: rentComps.n,
    scope: rentComps.scope,
    note: 'Gross yield = estimated annual rent ÷ asking price, before maintenance, tax, vacancy and brokerage.',
  };
}

function rentalScore(rental) {
  const def = SCORE_DEFS.rental;
  if (!rental.applicable) {
    return { key: 'rental', label: def.label, value: null, confidence: 'none', notApplicable: true, method: '', explanation: rental.reason, inputs: [] };
  }
  if (rental.grossYieldPct === null) {
    return { key: 'rental', label: def.label, value: null, confidence: 'none', method: 'Gross yield from comparable rental listings.', explanation: rental.note, inputs: [] };
  }
  const band = YIELD_BANDS.find(([min]) => rental.grossYieldPct >= min);
  return {
    key: 'rental',
    label: def.label,
    value: band ? band[1] : YIELD_FLOOR,
    confidence: rental.sampleSize >= COMPARABLES.highConfidenceSample ? 'medium' : 'low',
    method: `Gross yield bands: ${YIELD_BANDS.map(([y, s]) => `≥${y}% → ${s}`).join(', ')}, else ${YIELD_FLOOR}.`,
    explanation: `Estimated gross yield ${rental.grossYieldPct}% from ${rental.sampleSize} comparable rental listings (asking rents).`,
    inputs: [
      { factor: 'Estimated monthly rent', value: formatINR(rental.estimateMonthly) },
      { factor: 'Gross yield', value: `${rental.grossYieldPct}%` },
    ],
  };
}

/* ---------------- documentation ---------------- */

function documentationScore(p, rera) {
  const def = SCORE_DEFS.documentation;
  const reraApplicable = rera.status !== 'not-applicable' && !(p.listingType === 'rent');
  const items = [];
  const add = (factor, ok, w, value) => items.push({ factor, ok, w, value });

  if (reraApplicable) {
    const reraPts = { verified: 1, 'found-needs-review': 0.6, 'not-verified': 0.3, 'not-provided': 0, 'not-found': 0, mismatch: 0 }[rera.status] ?? 0.3;
    add('RERA registration', reraPts, 0.4, rera.label);
  }
  add('Photos (3 or more)', (p.images?.length || 0) >= 3 ? 1 : (p.images?.length || 0) / 3, 0.15, `${p.images?.length || 0} photo(s)`);
  add('Map location pinned', isValidCoords(p.location) ? 1 : 0, 0.1, isValidCoords(p.location) ? 'Yes' : 'No');
  add('Detailed description', (p.description?.length || 0) >= 200 ? 1 : 0.4, 0.1, `${p.description?.length || 0} characters`);
  add('Carpet area disclosed', p.carpetAreaSqft ? 1 : 0, 0.1, p.carpetAreaSqft ? `${p.carpetAreaSqft} sq ft` : 'Not given');
  add('Supporting documents uploaded', (p.documents?.length || 0) > 0 ? 1 : 0, 0.15, `${p.documents?.length || 0}`);
  if (p.listingVerified) add('Listing checked by PropFinder', 1, 0.1, 'Yes');

  const wSum = items.reduce((a, i) => a + i.w, 0);
  const value = round((items.reduce((a, i) => a + i.ok * i.w, 0) / wSum) * 100);
  return {
    key: 'documentation',
    label: def.label,
    value,
    confidence: 'high',
    method:
      'Weighted checklist of disclosure and verification items. RERA carries 40% when applicable and is excluded for rentals or exempt projects. This measures listing transparency, not legal title.',
    explanation: items
      .filter((i) => i.ok < 1)
      .map((i) => i.factor)
      .slice(0, 3)
      .reduce((s, f, idx) => `${s}${idx ? ', ' : 'Missing or incomplete: '}${f.toLowerCase()}`, '') || 'All checklist items present.',
    inputs: items.map((i) => ({ factor: i.factor, value: i.value, points: round(i.ok * 100) })),
  };
}

/* ---------------- overall & personalisation ---------------- */

export function overallFrom(scores, priorities = []) {
  const weights = {};
  for (const [k, def] of Object.entries(SCORE_DEFS)) {
    let w = def.weight;
    for (const pr of priorities) w *= PRIORITY_MULTIPLIERS[pr]?.[k] ?? 1;
    weights[k] = w;
  }
  const applicable = scores.filter((s) => !s.notApplicable);
  const totalW = applicable.reduce((a, s) => a + weights[s.key], 0);
  const avail = applicable.filter((s) => s.value !== null);
  const availW = avail.reduce((a, s) => a + weights[s.key], 0);
  const share = totalW ? availW / totalW : 0;
  if (avail.length < 3 || share < 0.35) {
    return { value: null, confidence: 'none', coverage: pct(share * 100), weights, explanation: 'Too little data for an overall score.' };
  }
  const value = round(avail.reduce((a, s) => a + s.value * weights[s.key], 0) / availW);
  return {
    value,
    label: value >= 80 ? 'Strong' : value >= 65 ? 'Good' : value >= 50 ? 'Mixed' : 'Weak',
    confidence: confidenceFromShare(share),
    coverage: pct(share * 100),
    weights,
    explanation: `Weighted average of ${avail.length} available scores covering ${pct(share * 100)}% of the total weight${priorities.length ? `, weighted for your priorities (${priorities.join(', ')})` : ''}.`,
  };
}

/** Recompute the overall score for a user's priorities, budget and workplace. */
export function personalize(report, { priorities = [], budgetMax = null, workplace = null } = {}) {
  const valid = priorities.filter((p) => PRIORITY_MULTIPLIERS[p]);
  const out = { priorities: valid, overall: overallFrom(report.scores, valid), notes: [] };
  if (budgetMax && report.facts?.price) {
    const over = ((report.facts.price - budgetMax) / budgetMax) * 100;
    out.budget = { budgetMax, fits: over <= 0, overPct: pct(Math.max(0, over)) };
    out.notes.push(over <= 0 ? 'Within your budget.' : `About ${pct(over)}% above your budget.`);
  }
  if (workplace && isValidCoords(workplace) && isValidCoords(report.facts?.location)) {
    const km = Math.round(haversineKm(workplace, report.facts.location) * 10) / 10;
    out.commute = { straightLineKm: km, note: 'Straight-line distance to your workplace; road distance is usually 20–50% longer.' };
    out.notes.push(`${km} km (straight line) from your workplace.`);
  }
  return out;
}

/* ---------------- narrative ---------------- */

function deterministicNarrative(p, { scores, overall, position, rental, rera, nearby }) {
  const typeText = [bhkLabel(p.bedrooms), propertyTypeLabel(p.propertyType)].filter(Boolean).join(' ');
  const priceText = p.listingType === 'rent' ? `${formatINR(p.price)} per month` : formatINR(p.price);
  const pros = [];
  const cons = [];
  const watchouts = [];

  if (position.verdict === 'below-market') pros.push(`Asking price is ${Math.abs(position.deltaPct)}% below the median of ${position.sampleSize} comparable listings.`);
  if (position.verdict === 'above-market') cons.push(`Asking price is ${position.deltaPct}% above the median of ${position.sampleSize} comparable listings.`);
  if (position.verdict === 'insufficient-data') watchouts.push('Too few comparable listings to judge the price — compare with recent registered sale data or a local valuer.');

  for (const s of scores) {
    if (s.value === null || s.notApplicable) continue;
    if (['connectivity', 'education', 'healthcare', 'amenities', 'location'].includes(s.key)) {
      if (s.value >= 75) pros.push(`${s.label}: ${s.explanation}`);
      else if (s.value <= 40) cons.push(`${s.label}: ${s.explanation}`);
    }
  }
  if (rental.applicable && rental.grossYieldPct !== null) {
    (rental.grossYieldPct >= 3.5 ? pros : cons).push(`Estimated gross rental yield ${rental.grossYieldPct}% (from ${rental.sampleSize} rental listings).`);
  }
  if (['not-provided', 'not-verified'].includes(rera.status) && p.listingType === 'sale' && (p.constructionStatus === 'under-construction' || p.project)) {
    watchouts.push('RERA registration is not verified yet — check the number on the state RERA portal before paying anything.');
  }
  if (rera.status === 'mismatch') watchouts.push('Listing details differ from the official RERA record — see the RERA section.');
  if (rera.status === 'verified') pros.push('RERA registration verified against the official record (this does not confirm title).');
  if (!p.carpetAreaSqft && p.propertyType !== 'plot') watchouts.push('Carpet area is not disclosed; ask for it in writing — built-up area includes walls and shafts.');
  if (p.isDemo) watchouts.push('This is a demo listing created for illustration; it is not a real property for sale.');
  if (nearby?.status && !['ok', 'empty'].includes(nearby.status)) watchouts.push('Nearby-facility data was unavailable, so location scores are missing.');

  const summary =
    `${typeText} in ${p.locality}, ${p.city}, listed at ${priceText}. ` +
    (overall.value !== null
      ? `Overall suitability ${overall.value}/100 (${overall.label}, ${overall.confidence} confidence).`
      : 'There is not enough data for an overall score.') +
    (position.verdict !== 'insufficient-data' ? ` The asking price is ${position.verdict.replace('-', ' ')} versus ${position.sampleSize} comparable listings.` : '');

  return { summary, pros: pros.slice(0, 5), cons: cons.slice(0, 5), watchouts: watchouts.slice(0, 5), source: 'rules' };
}

async function llmNarrative(p, evidence, fallback) {
  if (!llmEnabled()) return fallback;
  try {
    const facts = {
      listing: {
        type: propertyTypeLabel(p.propertyType),
        bedrooms: p.bedrooms,
        listingType: p.listingType,
        price: p.price,
        areaSqft: p.areaSqft,
        carpetAreaSqft: p.carpetAreaSqft,
        locality: p.locality,
        city: p.city,
        constructionStatus: p.constructionStatus,
        isDemo: p.isDemo,
      },
      scores: evidence.scores.map((s) => ({ label: s.label, value: s.value, confidence: s.confidence, explanation: s.explanation })),
      overall: evidence.overall,
      price: evidence.position,
      rental: evidence.rental,
      rera: { status: evidence.rera.status, label: evidence.rera.label, discrepancies: evidence.rera.discrepancies },
    };
    const raw = await complete(
      `You write short, neutral property analysis for Indian home buyers. Use ONLY the facts provided. Never add facts, places, prices, ratings, legal conclusions or predictions that are not in the facts. If a score is null, say the data is insufficient. Do not call a property "RERA approved"; say "RERA registration verified" only if the status is verified. ${UNTRUSTED_RULE} Respond with a single JSON object only.`,
      [
        {
          role: 'user',
          content: `Return JSON: {"summary": "2-3 sentences", "pros": [up to 4 strings], "cons": [up to 4 strings], "watchouts": [up to 4 strings]}.\n${asData('analysis-facts', facts)}`,
        },
      ],
      { maxTokens: 1200, json: true }
    );
    const parsed = parseJsonObject(raw);
    const list = (v, fb) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : fb);
    if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) throw new Error('missing summary');
    return {
      summary: parsed.summary.trim(),
      pros: list(parsed.pros, fallback.pros),
      cons: list(parsed.cons, fallback.cons),
      // Rule-based watch-outs are always kept; the model may add to them.
      watchouts: [...new Set([...fallback.watchouts, ...list(parsed.watchouts, [])])].slice(0, 6),
      source: 'llm',
    };
  } catch (err) {
    console.warn('[analysis] LLM narrative unavailable, using rules:', err.message);
    return { ...fallback, llmError: true };
  }
}

/* ---------------- report ---------------- */

async function evidenceFor(p, { refreshNearby = false } = {}) {
  const [nearby, comps, rentComps, record] = await Promise.all([
    getNearby(p.location, { refresh: refreshNearby }),
    findComparables(p),
    p.listingType === 'sale' && p.propertyType !== 'plot' ? findComparables(p, { listingType: 'rent' }) : Promise.resolve(null),
    ReraRecord.findOne({ property: p._id }).sort({ updatedAt: -1 }).lean(),
  ]);
  return { nearby, comps, rentComps, record };
}

function hashInputs(p, ev) {
  const h = crypto.createHash('sha1');
  h.update(
    JSON.stringify([
      SCORING_VERSION,
      llmEnabled(),
      new Date(p.updatedAt).getTime(),
      ev.nearby?.fetchedAt ? new Date(ev.nearby.fetchedAt).getTime() : ev.nearby?.status,
      ev.comps.n,
      ev.comps.stats?.median && Math.round(ev.comps.stats.median),
      ev.rentComps?.n,
      ev.record?.updatedAt ? new Date(ev.record.updatedAt).getTime() : null,
    ])
  );
  return h.digest('hex');
}

export async function buildReport(propertyDoc, { refresh = false } = {}) {
  const started = Date.now();
  const p = typeof propertyDoc.toObject === 'function' ? propertyDoc.toObject() : propertyDoc;
  const ev = await evidenceFor(p, { refreshNearby: refresh });
  const inputHash = hashInputs(p, ev);

  if (!refresh) {
    const cached = await AnalysisReport.findOne({ property: p._id }).lean();
    if (cached && cached.inputHash === inputHash) return { ...cached.report, cached: true };
  }

  const hub = nearestHub(p);
  const rera = reraSummary({ property: p, record: ev.record });
  const position = pricePosition(p, ev.comps);
  const rental = rentalAnalysis(p, ev.rentComps);

  const scores = [
    localityScore('location', ev.nearby, { hub }),
    localityScore('connectivity', ev.nearby),
    localityScore('amenities', ev.nearby),
    localityScore('education', ev.nearby),
    localityScore('healthcare', ev.nearby),
    priceScore(position, ev.comps),
    rentalScore(rental),
    documentationScore(p, rera),
  ];
  const overall = overallFrom(scores);

  const limitations = [];
  if (ev.nearby.status !== 'ok') limitations.push(ev.nearby.message || `Nearby data status: ${ev.nearby.status}.`);
  else {
    limitations.push('Distances are straight-line unless a road distance is shown; actual travel can be much longer.');
    limitations.push(`Facility data comes from ${ev.nearby.attribution?.text || ev.nearby.provider} and may miss recently opened or unmapped places.`);
  }
  limitations.push('Price comparisons use asking prices of active listings on PropFinder, not registered sale prices.');
  if (ev.comps.demoCount) limitations.push(`${ev.comps.demoCount} of ${ev.comps.n} comparables are demo listings, so the benchmark is illustrative only.`);
  limitations.push('No historical price-trend data source is configured, so appreciation is not estimated.');
  limitations.push('School quality, safety and pollution are not scored: no reliable, licensed data source is configured for them.');

  const evidence = { scores, overall, position, rental, rera, nearby: ev.nearby };
  const rules = deterministicNarrative(p, evidence);
  // Wait for locality data before spending an LLM call on the narrative.
  const narrative = ev.nearby.status === 'pending' ? rules : await llmNarrative(p, evidence, rules);

  const report = {
    propertyId: String(p._id),
    generatedAt: new Date(),
    scoringVersion: SCORING_VERSION,
    facts: { price: p.price, listingType: p.listingType, areaSqft: p.areaSqft, location: p.location, isDemo: Boolean(p.isDemo) },
    overall,
    scores,
    narrative,
    price: { position, comparables: { n: ev.comps.n, scope: ev.comps.scope, period: ev.comps.period, demoCount: ev.comps.demoCount || 0, items: ev.comps.items }, basis: 'asking-prices' },
    rental,
    nearby: {
      status: ev.nearby.status,
      provider: ev.nearby.provider,
      fetchedAt: ev.nearby.fetchedAt || null,
      attribution: ev.nearby.attribution || null,
      distanceMethod: ev.nearby.distanceMethod || 'straight-line',
      routed: Boolean(ev.nearby.routed),
      message: ev.nearby.message || '',
      categories: ev.nearby.categories,
      meta: ev.nearby.meta || CATEGORIES,
    },
    employmentHub: hub,
    rera,
    checklist: DUE_DILIGENCE_CHECKLIST,
    limitations,
    disclaimer: DISCLAIMER,
  };

  const status = ev.nearby.status === 'ok' ? 'ok' : 'partial';
  await AnalysisReport.findOneAndUpdate(
    { property: p._id },
    { property: p._id, inputHash, report, status, error: ev.nearby.error || '', durationMs: Date.now() - started },
    { upsert: true }
  );
  // Denormalise nearest distances for search filters.
  const summary = summaryFrom(ev.nearby);
  if (summary) await Property.updateOne({ _id: p._id }, { $set: { nearbySummary: summary } }, { timestamps: false });

  return { ...report, cached: false };
}

/** Lightweight analysis used by cards/compare when a full report is not needed. */
export async function quickFacts(p) {
  const comps = await findComparables(p);
  return { position: pricePosition(p, comps), comps: { n: comps.n, scope: comps.scope } };
}
