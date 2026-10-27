import Property from '../models/Property.js';
import { buildReport, personalize } from '../services/analysisService.js';
import { marketingContent, draftDescription } from '../services/aiService.js';
import { complete, llmEnabled, asData, UNTRUSTED_RULE } from '../services/llmService.js';
import { PRIORITY_MULTIPLIERS, SCORE_DEFS } from '../config/scoring.js';
import { badRequest, forbidden, isId, notFound, str, toNum, wrap } from '../utils/http.js';
import { formatINR } from '../utils/format.js';
import { gateMedia } from '../services/mediaService.js';

async function loadProperty(idOrSlug, req) {
  const p = isId(idOrSlug) ? await Property.findById(idOrSlug) : await Property.findOne({ slug: idOrSlug }).sort({ createdAt: -1 });
  if (!p) throw notFound('Property not found');
  const privileged = req.role === 'admin' || (req.userId && String(p.owner) === req.userId);
  if (['draft', 'paused', 'archived'].includes(p.status) && !privileged) throw notFound('Property not found');
  return { p, privileged };
}

const parsePrefs = (q) => ({
  priorities: str(q.priorities).split(',').map((s) => s.trim()).filter((s) => PRIORITY_MULTIPLIERS[s]),
  budgetMax: toNum(q.budgetMax),
  workplace: q.workLat && q.workLng ? { lat: toNum(q.workLat), lng: toNum(q.workLng) } : null,
});

// GET /api/ai/properties/:id/report?refresh=1&priorities=family,commute&budgetMax=...
export const getReport = wrap(async (req, res) => {
  const { p, privileged } = await loadProperty(req.params.id, req);
  // Forcing a refresh hits external providers, so only the lister/admin may do it.
  const refresh = str(req.query.refresh) === '1';
  if (refresh && !privileged) throw forbidden('Only the lister or an admin can refresh the analysis.');
  const report = await buildReport(p, { refresh });
  res.json({ ...report, personalized: personalize(report, parsePrefs(req.query)) });
});

// Legacy v1 endpoint, kept for compatibility: summary fields from the full report.
export const getAnalysis = wrap(async (req, res) => {
  const { p } = await loadProperty(req.params.id, req);
  const r = await buildReport(p);
  res.json({
    propertyId: r.propertyId,
    score: r.overall.value,
    scoreLabel: r.overall.label || 'Insufficient data',
    priceFairness: { verdict: r.price.position.verdict, deltaPct: r.price.position.deltaPct, localityAvgPerSqft: r.price.position.medianPerSqft, thisPerSqft: r.price.position.thisPerSqft },
    rentalYieldPct: r.rental?.grossYieldPct ?? null,
    pros: r.narrative.pros,
    cons: r.narrative.cons,
    summary: r.narrative.summary,
    source: r.narrative.source,
  });
});

export const getMarketing = wrap(async (req, res) => {
  const { p } = await loadProperty(req.params.id, req);
  res.json({ propertyId: String(p._id), ...(await marketingContent(p)) });
});

// POST /api/ai/draft-description  { listing fields }  (listers only)
export const draft = wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.city || !b.locality || !b.propertyType) throw badRequest('Add the property type, city and locality first.');
  res.json(await draftDescription(b));
});

// POST /api/ai/compare  { ids: [..], priorities: [..] }
export const compare = wrap(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isId).slice(0, 4);
  if (ids.length < 2) throw badRequest('Choose at least two properties to compare.');
  const priorities = (Array.isArray(req.body?.priorities) ? req.body.priorities : []).filter((x) => PRIORITY_MULTIPLIERS[x]);

  const docs = await Property.find({ _id: { $in: ids }, status: { $in: ['active', 'sold', 'rented'] } }).populate('owner', 'name role company');
  if (docs.length < 2) throw notFound('Some of these properties are no longer available.');

  const ordered = ids.map((id) => docs.find((x) => x.id === id)).filter(Boolean);
  const reports = await Promise.all(ordered.map((d) => buildReport(d)));
  const items = ordered.map((d, i) => ({ property: gateMedia(d.toJSON({ virtuals: true }), { userId: req.userId }), report: reports[i], personalized: personalize(reports[i], { priorities }) }));

  // Per-dimension leaders (only where at least two have data).
  const leaders = {};
  for (const key of Object.keys(SCORE_DEFS)) {
    const vals = items.map((it) => ({ id: String(it.property._id), v: it.report.scores.find((s) => s.key === key)?.value })).filter((x) => x.v != null);
    if (vals.length >= 2) {
      const top = Math.max(...vals.map((x) => x.v));
      leaders[key] = { ids: vals.filter((x) => x.v === top).map((x) => x.id), value: top, compared: vals.length };
    }
  }

  const summary = await comparisonText(items, priorities, leaders);
  res.json({ items, leaders, priorities, summary });
});

function ruleComparison(items, priorities, leaders) {
  const name = (id) => items.find((it) => String(it.property._id) === id)?.property.title || 'one listing';
  const lines = [];
  for (const [key, l] of Object.entries(leaders)) {
    if (l.ids.length === items.length) continue;
    lines.push(`${SCORE_DEFS[key].label}: ${l.ids.map(name).join(' and ')} scores highest (${l.value}/100, ${l.compared} compared).`);
  }
  const ranked = items
    .filter((it) => it.personalized.overall.value != null)
    .sort((a, b) => b.personalized.overall.value - a.personalized.overall.value);
  let verdict = '';
  if (ranked.length >= 2) {
    const [a, b] = ranked;
    const gap = a.personalized.overall.value - b.personalized.overall.value;
    verdict =
      gap < 5
        ? `With ${priorities.length ? `your priorities (${priorities.join(', ')})` : 'default weights'}, the overall scores are within ${gap} points — effectively a tie on the available data.`
        : `With ${priorities.length ? `your priorities (${priorities.join(', ')})` : 'default weights'}, ${a.property.title} leads overall (${a.personalized.overall.value} vs ${b.personalized.overall.value}), at ${a.personalized.overall.confidence} confidence.`;
  } else {
    verdict = 'There is not enough data to rank these overall.';
  }
  const prices = items.map((it) => `${it.property.title}: ${formatINR(it.property.price)}${it.property.listingType === 'rent' ? '/month' : ''}`).join('; ');
  return { text: [verdict, ...lines, `Prices — ${prices}.`, 'Scores are estimates from the listed data, not a recommendation for everyone.'].join('\n'), source: 'rules' };
}

async function comparisonText(items, priorities, leaders) {
  const base = ruleComparison(items, priorities, leaders);
  if (!llmEnabled()) return base;
  try {
    const facts = items.map((it) => ({
      title: it.property.title,
      price: it.property.price,
      listingType: it.property.listingType,
      areaSqft: it.property.areaSqft,
      bedrooms: it.property.bedrooms,
      locality: it.property.locality,
      isDemo: it.property.isDemo,
      overallForUser: it.personalized.overall,
      scores: it.report.scores.map((s) => ({ label: s.label, value: s.value, confidence: s.confidence, explanation: s.explanation })),
      price_position: it.report.price.position,
      rera: it.report.rera.label,
    }));
    const text = await complete(
      `You compare Indian properties for a buyer. Use ONLY the facts given. Explain the main trade-offs in 4-7 short bullet points, then one conditional recommendation tied to the user's priorities (${priorities.join(', ') || 'none stated'}). Never declare one property best for everyone, never invent facts, mention data gaps and low confidence. ${UNTRUSTED_RULE}`,
      [{ role: 'user', content: asData('comparison-facts', facts) }],
      { maxTokens: 900 }
    );
    return text.trim() ? { text: text.trim(), source: 'llm' } : base;
  } catch {
    return base;
  }
}
