/*
 * Real-estate assistant: retrieve, then answer.
 *
 * 1. Parse the message into an intent + search filters (deterministic).
 * 2. Retrieve real records: listings (searchService), intelligence reports
 *    for referenced properties, RERA summaries, knowledge-base articles, and
 *    — for listers — their own listings and leads.
 * 3. Answer. With an LLM configured, the model writes the reply from the
 *    retrieved data only (wrapped as untrusted data). Without one, templated
 *    answers are built from the same data. Either way the cards, citations
 *    and suggestions come from the retrieval step, not from the model.
 */
import Property from '../models/Property.js';
import { Lead } from '../models/index.js';
import { LISTER_ROLES } from '../models/User.js';
import { search, toCard, CARD_PROJECTION } from './searchService.js';
import { buildReport } from './analysisService.js';
import { searchKnowledge } from '../data/knowledge.js';
import { llmEnabled, stream as llmStream, asData, UNTRUSTED_RULE } from './llmService.js';
import { formatINR, propertyTypeLabel } from '../utils/format.js';
import { isId } from '../utils/http.js';

const CITY_ALIASES = { gurgaon: 'Gurugram', bangalore: 'Bengaluru', bombay: 'Mumbai', 'new delhi': 'Delhi', poona: 'Pune' };

const TYPE_WORDS = [
  [/\bbuilder[\s-]?floor/, 'builder-floor'],
  [/\bvilla/, 'villa'],
  [/\b(independent house|house|kothi|bungalow)\b/, 'independent-house'],
  [/\b(plot|land)\b/, 'plot'],
  [/\b(office|co-?working)\b/, 'office'],
  [/\b(shop|showroom|retail)\b/, 'retail-shop'],
  [/\b(commercial)\b/, 'commercial'],
  [/\b(flat|apartment)s?\b/, 'apartment'],
];

/* ---------------- parsing ---------------- */

export function parseMoney(text) {
  const out = [];
  const rx = /(₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l|k|thousand)\b/gi;
  let m;
  while ((m = rx.exec(text))) {
    const n = Number(m[2]);
    const unit = m[3].toLowerCase();
    const mult = unit.startsWith('cr') ? 1e7 : unit.startsWith('l') ? 1e5 : 1e3;
    out.push({ value: Math.round(n * mult), index: m.index, raw: m[0] });
  }
  return out;
}

function parseBudget(text) {
  const t = text.toLowerCase();
  const amounts = parseMoney(t);
  if (!amounts.length) return {};
  if (amounts.length >= 2 && /\b(between|from)\b|\d\s*(-|to)\s*₹?\s*\d/.test(t)) {
    const [a, b] = amounts.map((x) => x.value).sort((x, y) => x - y);
    return { minPrice: a, maxPrice: b };
  }
  const first = amounts[0];
  const before = t.slice(Math.max(0, first.index - 20), first.index);
  if (/(above|over|more than|minimum|min|at least|starting)\s*$/.test(before)) return { minPrice: first.value };
  return { maxPrice: first.value };
}

export function parseQuery(message, { cities = [], localities = [] } = {}) {
  const t = ` ${String(message || '').toLowerCase()} `;
  const params = {};

  if (/\b(rent|rental|lease|tenant|pg|on rent|to let)\b/.test(t) && !/\brental yield|rental income|rent out\b/.test(t)) params.listingType = 'rent';
  else if (/\b(buy|purchase|sale|for sale|invest)\b/.test(t)) params.listingType = 'sale';

  const bhk = t.match(/(\d)\s*-?\s*(bhk|bed|bedroom)/);
  if (bhk) params.bedrooms = bhk[1];

  for (const [rx, type] of TYPE_WORDS) {
    if (rx.test(t)) {
      params.propertyType = type;
      break;
    }
  }

  for (const [alias, city] of Object.entries(CITY_ALIASES)) if (t.includes(` ${alias}`)) params.city = city;
  if (!params.city) {
    const hit = cities.find((c) => t.includes(` ${c.toLowerCase()}`));
    if (hit) params.city = hit;
  }
  const loc = [...localities]
    .sort((a, b) => b.locality.length - a.locality.length)
    .find((l) => t.includes(l.locality.toLowerCase()) && (!params.city || l.city === params.city));
  if (loc) {
    params.locality = loc.locality;
    params.city = params.city || loc.city;
  }

  Object.assign(params, parseBudget(t));
  if (/\bready[\s-]to[\s-]move|ready possession\b/.test(t)) params.constructionStatus = 'ready';
  if (/\bunder[\s-]construction\b/.test(t)) params.constructionStatus = 'under-construction';
  if (/\bfurnished\b/.test(t) && !/\b(semi|un)[\s-]?furnished\b/.test(t)) params.furnishing = 'furnished';
  if (/\bnear (a |the )?metro\b|metro connectivity|close to metro/.test(t)) params.nearMetroKm = 1.5;
  if (/\brera\b.*\bverified\b/.test(t)) params.reraVerified = '1';
  return params;
}

export function detectIntent(message, role) {
  const t = String(message || '').toLowerCase();
  const lister = LISTER_ROLES.includes(role);
  if (lister && /\bmy (leads?|enquir|inquir)/.test(t)) return 'my-leads';
  if (lister && /\bmatching buyers?|buyers? (for|matching)/.test(t)) return 'matching-buyers';
  if (lister && /\bmy (listings?|properties)\b/.test(t)) return 'my-listings';
  if (/\b(help me )?(list|post|sell|rent out|advertise) (my|a) (property|flat|house|home|plot|shop|office)/.test(t) || /\blist my\b/.test(t)) return 'list-property';
  if (/\b(site visit|arrange (a )?visit|schedule (a )?visit|book (a )?visit|see the (property|flat)|contact (the )?(agent|owner))\b/.test(t)) return 'site-visit';
  if (/\bcompare|which (of these|one) (is|has)|better (for|metro|connect)|vs\.?\b/.test(t)) return 'compare';
  if (/\brera\b/.test(t) && /\b(this|project|verified|registered|status|registration)\b/.test(t)) return 'rera';
  if (/\b(school|college|education)s?\b/.test(t)) return 'schools';
  if (/\b(hospital|clinic|healthcare|doctor)s?\b/.test(t)) return 'healthcare';
  if (/\b(metro|commute|connectivity|station|airport|transport)\b/.test(t) && !/\b(find|show|search)\b/.test(t)) return 'connectivity';
  if (/\b(over ?priced|priced (higher|lower|fairly)|fair price|price (fair|compar)|similar (nearby )?listings|market price|worth)\b/.test(t)) return 'price';
  if (/\b(emi|yield|rental income|return on|roi)\b/.test(t)) return 'finance';
  if (/\breviews?|ratings?\b/.test(t)) return 'reviews';
  if (/\b(find|show|search|looking for|want|need|suggest|recommend|options?|available)\b/.test(t) || /\d\s*bhk/.test(t)) return 'search';
  return 'general';
}

/* ---------------- retrieval helpers ---------------- */

async function directory() {
  const [cities, locs] = await Promise.all([
    Property.distinct('city', { status: 'active' }),
    Property.aggregate([{ $match: { status: 'active' } }, { $group: { _id: { city: '$city', locality: '$locality' } } }]),
  ]);
  return { cities, localities: locs.map((l) => ({ city: l._id.city, locality: l._id.locality })) };
}

const cardOf = (p) => ({
  id: String(p._id || p.id),
  slug: p.slug,
  title: p.title,
  price: p.price,
  listingType: p.listingType,
  propertyType: p.propertyType,
  bedrooms: p.bedrooms,
  areaSqft: p.areaSqft,
  city: p.city,
  locality: p.locality,
  image: p.images?.[0] || null,
  isDemo: Boolean(p.isDemo),
  reraStatus: p.rera?.status || 'not-provided',
});

async function loadProperties(ids) {
  const valid = [...new Set(ids.filter(isId))].slice(0, 4);
  if (!valid.length) return [];
  const docs = await Property.find({ _id: { $in: valid }, status: { $in: ['active', 'sold', 'rented'] } }).select(CARD_PROJECTION).lean();
  return valid.map((id) => docs.find((d) => String(d._id) === id)).filter(Boolean);
}

function locationFacts(report, keys) {
  if (!report?.nearby?.categories) return { status: report?.nearby?.status || 'unavailable', message: report?.nearby?.message };
  const out = { status: 'ok', provider: report.nearby.attribution?.text, distanceMethod: report.nearby.distanceMethod, categories: {} };
  for (const k of keys) {
    const c = report.nearby.categories[k];
    if (!c) continue;
    out.categories[k] = {
      label: report.nearby.meta?.[k]?.label || k,
      countWithinRadius: c.count,
      radiusKm: report.nearby.meta?.[k]?.radiusKm,
      nearest: c.nearest.slice(0, 4).map((p) => ({ name: p.name, distanceKm: p.distanceKm, driveMinutes: p.driveMinutes ?? null, rating: p.rating ?? null, ratingSource: p.ratingSource ?? null })),
    };
  }
  return out;
}

const scoreOf = (report, key) => report?.scores?.find((s) => s.key === key);

/* ---------------- answer templates (no LLM) ---------------- */

function money(p) {
  return `${formatINR(p.price)}${p.listingType === 'rent' ? '/month' : ''}`;
}

function templateAnswer(intent, ctx) {
  const { params, results, props, reports, kb, role } = ctx;
  const lines = [];
  const nameOf = (p) => `**${p.title}** (${money(p)})`;

  switch (intent) {
    case 'search': {
      const what = [params.bedrooms && `${params.bedrooms}+ BHK`, params.propertyType && propertyTypeLabel(params.propertyType).toLowerCase(), params.listingType === 'rent' ? 'for rent' : params.listingType === 'sale' ? 'for sale' : '', params.locality || params.city ? `in ${[params.locality, params.city].filter(Boolean).join(', ')}` : '', params.maxPrice ? `under ${formatINR(params.maxPrice)}` : '', params.minPrice ? `above ${formatINR(params.minPrice)}` : ''].filter(Boolean).join(' ');
      if (!results.total) {
        lines.push(`I couldn't find any active listings ${what ? `matching "${what}"` : 'for that search'} on PropFinder right now.`);
        lines.push('Try widening the budget, removing the BHK filter or checking a nearby locality. You can also save this search to be notified when a match is posted.');
      } else {
        lines.push(`I found ${results.total} active listing${results.total === 1 ? '' : 's'} ${what}. Here are the top ${results.items.length}:`);
        for (const p of results.items) lines.push(`- ${nameOf(p)} — ${p.areaSqft} sq ft, ${p.locality}${p.isDemo ? ' _(demo listing)_' : ''}`);
        if (results.items.some((p) => p.isDemo)) lines.push('\nListings marked demo are sample data, not real properties.');
      }
      break;
    }
    case 'compare': {
      if (props.length < 2) {
        lines.push('To compare, add at least two properties to your compare list (the ⇄ button on a listing) or ask from a property page after adding another.');
        break;
      }
      lines.push(`Comparing ${props.length} properties on the data we have:`);
      for (const p of props) {
        const r = reports[String(p._id)];
        const metro = r?.nearby?.categories?.metro;
        const conn = scoreOf(r, 'connectivity');
        const price = r?.price?.position;
        lines.push(
          `- ${nameOf(p)}: ` +
            [
              metro ? (metro.nearestKm != null ? `nearest metro ${metro.nearestKm} km (straight line)` : 'no metro station found within 5 km') : 'metro data unavailable',
              conn?.value != null ? `connectivity score ${conn.value}/100` : null,
              price && price.verdict !== 'insufficient-data' ? `${price.deltaPct > 0 ? '+' : ''}${price.deltaPct}% vs comparable ₹/sq ft` : 'too few comparables for a price verdict',
              r?.overall?.value != null ? `overall ${r.overall.value}/100 (${r.overall.confidence} confidence)` : null,
            ]
              .filter(Boolean)
              .join('; ')
        );
      }
      lines.push('\nWhich one is "better" depends on your priorities — use the Compare page to weight affordability, commute, family needs or rental potential.');
      break;
    }
    case 'rera': {
      if (!props.length) {
        lines.push('Open a property page and ask again, or tell me which listing you mean. In general:');
        if (kb[0]) lines.push(kb[0].body);
        break;
      }
      for (const p of props) {
        const r = reports[String(p._id)]?.rera;
        if (!r) continue;
        lines.push(`${nameOf(p)}: **${r.label}**.`);
        if (r.registrationNumber) lines.push(`Registration number on the listing: ${r.registrationNumber}${r.authority ? ` (${r.authority.authority})` : ''}.`);
        if (r.lastVerifiedAt) lines.push(`Last checked: ${new Date(r.lastVerifiedAt).toISOString().slice(0, 10)} by ${r.method === 'official-api' ? 'an official data feed' : 'manual review against the official portal'}.`);
        if (r.discrepancies?.length) lines.push(`Discrepancies: ${r.discrepancies.join(' ')}`);
        if (r.officialUrl) lines.push(`You can check it yourself on the official portal: ${r.officialUrl}`);
        lines.push(r.disclaimer);
      }
      break;
    }
    case 'schools':
    case 'healthcare':
    case 'connectivity': {
      const keys = { schools: ['school', 'college'], healthcare: ['hospital', 'clinic', 'pharmacy'], connectivity: ['metro', 'railway', 'bus_stop', 'airport', 'major_road'] }[intent];
      if (!props.length) {
        lines.push('Open a property page (or tell me which listing) and I can list the nearby facilities from map data.');
        break;
      }
      for (const p of props) {
        const facts = locationFacts(reports[String(p._id)], keys);
        lines.push(`${nameOf(p)}:`);
        if (facts.status !== 'ok') {
          lines.push(`Nearby-facility data is unavailable (${facts.message || facts.status}).`);
          continue;
        }
        for (const c of Object.values(facts.categories)) {
          if (!c.nearest.length) {
            lines.push(`- ${c.label}: none found within ${c.radiusKm} km in the map data.`);
            continue;
          }
          lines.push(`- ${c.label} (${c.countWithinRadius} within ${c.radiusKm} km): ${c.nearest.slice(0, 3).map((n) => `${n.name} ${n.distanceKm} km${n.driveMinutes != null ? ` (~${n.driveMinutes} min drive)` : ''}`).join('; ')}`);
        }
        lines.push(`Distances are straight-line from ${facts.provider || 'map data'}; actual travel distance is longer.${intent === 'schools' ? ' Map data does not tell us school quality or board — check those directly.' : ''}`);
      }
      break;
    }
    case 'price': {
      if (!props.length) {
        lines.push('Open the property page and ask again so I can compare it with similar listings.');
        break;
      }
      for (const p of props) {
        const pos = reports[String(p._id)]?.price?.position;
        const comps = reports[String(p._id)]?.price?.comparables;
        if (!pos || pos.verdict === 'insufficient-data') {
          lines.push(`${nameOf(p)}: there are only ${pos?.sampleSize ?? 0} comparable active listings, which is too few for a fair comparison.`);
        } else {
          lines.push(`${nameOf(p)} asks ₹${pos.thisPerSqft.toLocaleString('en-IN')}/sq ft. The median of ${pos.sampleSize} comparable listings (${comps.scope.toLowerCase()}) is ₹${pos.medianPerSqft.toLocaleString('en-IN')}/sq ft, so it is **${pos.verdict.replace('-', ' ')}** (${pos.deltaPct > 0 ? '+' : ''}${pos.deltaPct}%).`);
          if (comps.demoCount) lines.push(`${comps.demoCount} of those comparables are demo listings, so treat this as illustrative.`);
        }
      }
      lines.push('These are asking prices on PropFinder, not registered sale prices.');
      break;
    }
    case 'finance': {
      const p = props[0];
      const rateMatch = String(ctx.message).match(/(\d+(?:\.\d+)?)\s*%/);
      const yearsMatch = String(ctx.message).match(/(\d+)\s*(years?|yrs?)/i);
      if (/\bemi\b/i.test(ctx.message)) {
        const principal = p && p.listingType === 'sale' ? p.price * 0.8 : parseMoney(String(ctx.message).toLowerCase())[0]?.value;
        if (!principal || !rateMatch) {
          lines.push('Tell me the loan amount (or open a property) and the interest rate your lender quoted, e.g. "EMI at 8.6% for 20 years", and I will calculate it. I don’t assume current rates because they vary by lender.');
        } else {
          const years = yearsMatch ? Number(yearsMatch[1]) : 20;
          const r = Number(rateMatch[1]) / 1200;
          const n = years * 12;
          const emi = (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
          lines.push(`For a loan of ${formatINR(principal)}${p ? ' (80% of the asking price)' : ''} at ${rateMatch[1]}% for ${years} years, the EMI is about **₹${Math.round(emi).toLocaleString('en-IN')}/month**; total interest ≈ ${formatINR(emi * n - principal)}.`);
        }
      } else if (p) {
        const rental = reports[String(p._id)]?.rental;
        if (rental?.grossYieldPct != null) lines.push(`${nameOf(p)}: estimated rent ${formatINR(rental.estimateMonthly)}/month from ${rental.sampleSize} comparable rental listings, i.e. a gross yield of about ${rental.grossYieldPct}%. ${rental.note}`);
        else lines.push(`${nameOf(p)}: ${rental?.note || rental?.reason || 'not enough rental data to estimate yield.'}`);
      }
      if (kb[0] && !lines.length) lines.push(kb[0].body);
      break;
    }
    case 'reviews': {
      lines.push(props.length ? 'Reviews for this property are shown in the Reviews section of the page, with rating distributions and dates. Reviewer relationships (resident, tenant) are self-declared unless marked verified.' : 'Open a property, project or locality page to see its moderated reviews.');
      break;
    }
    case 'site-visit':
      lines.push(props.length ? `I can send a site-visit request for ${nameOf(props[0])} to the lister. Pick a date and time below.${role ? '' : ' You will need to sign in first.'}` : 'Open the property you are interested in and ask again, and I can send a visit request to the lister.');
      break;
    case 'list-property':
      lines.push(kb[0]?.body || 'Use "Post property" to create a listing.');
      break;
    case 'my-listings':
    case 'my-leads':
    case 'matching-buyers':
      lines.push(ctx.realtorText);
      break;
    default:
      if (kb.length) {
        lines.push(kb[0].body);
      } else {
        lines.push('I can search listings ("2 BHK in Pune under ₹80 lakh"), compare properties, explain RERA status, list nearby schools and hospitals for a property, estimate EMI or rental yield, and help you list a property. What would you like to do?');
      }
  }
  return lines.join('\n');
}

/* ---------------- realtor tools ---------------- */

async function realtorData(intent, userId) {
  if (intent === 'my-listings') {
    const docs = await Property.find({ owner: userId }).select('title status views leadsCount price listingType slug').sort({ updatedAt: -1 }).limit(10).lean();
    const text = docs.length
      ? `You have ${docs.length} listing(s):\n${docs.map((d) => `- **${d.title}** — ${d.status}, ${d.views} views, ${d.leadsCount || 0} leads`).join('\n')}`
      : 'You have no listings yet. Use "Post property" to create one.';
    return { text, data: docs };
  }
  const leads = await Lead.find({ listingOwner: userId }).populate('property', 'title price locality city bedrooms listingType').sort({ createdAt: -1 }).limit(20).lean();
  if (intent === 'my-leads') {
    const open = leads.filter((l) => !['won', 'lost'].includes(l.status));
    return {
      text: leads.length
        ? `You have ${open.length} open lead(s) out of ${leads.length} recent:\n${open.slice(0, 8).map((l) => `- ${l.name} — ${l.property?.title || 'listing'} — status: ${l.status}${l.requirements?.budgetMax ? `, budget ${formatINR(l.requirements.budgetMax)}` : ''}`).join('\n')}\nManage them in Dashboard → Leads.`
        : 'No leads yet. Leads appear here when buyers contact you or request a site visit.',
      data: leads.map((l) => ({ name: l.name, status: l.status, property: l.property?.title, requirements: l.requirements })),
    };
  }
  // matching-buyers: leads whose stated requirements fit another of the lister's active listings.
  const mine = await Property.find({ owner: userId, status: 'active' }).select('title price bedrooms listingType').lean();
  const matches = [];
  for (const l of leads) {
    for (const p of mine) {
      if (String(p._id) === String(l.property?._id)) continue;
      const budgetOk = !l.requirements?.budgetMax || p.price <= l.requirements.budgetMax * 1.05;
      const bedsOk = !l.requirements?.bedrooms || p.bedrooms >= l.requirements.bedrooms;
      const typeOk = !l.property || l.property.listingType === p.listingType;
      if (budgetOk && bedsOk && typeOk && (l.requirements?.budgetMax || l.requirements?.bedrooms)) matches.push({ lead: l.name, listing: p.title });
    }
  }
  return {
    text: matches.length
      ? `These enquirers may also fit your other listings (based only on requirements they shared with you):\n${matches.slice(0, 8).map((m) => `- ${m.lead} → ${m.listing}`).join('\n')}`
      : 'No matches found between your leads’ stated requirements and your other active listings.',
    data: matches,
  };
}

/* ---------------- main entry ---------------- */

const SUGGESTIONS = {
  search: ['Show only RERA-verified listings', 'Which of these has better metro connectivity?', 'What should I verify before paying a booking amount?'],
  compare: ['Which is better for a family?', 'Which has better rental potential?', 'Is either priced above similar listings?'],
  rera: ['What does RERA verification not cover?', 'Which documents should I ask for?', 'Are there good schools within 3 km?'],
  schools: ['Are there hospitals nearby?', 'How is the metro connectivity?', 'Is this priced fairly?'],
  healthcare: ['Are there good schools within 3 km?', 'How far is the nearest metro?', 'Arrange a site visit'],
  connectivity: ['Are there good schools within 3 km?', 'Is this priced higher than similar listings?', 'Arrange a site visit'],
  price: ['What is the rental yield?', 'Calculate EMI at 8.5% for 20 years', 'Is the RERA registration verified?'],
  finance: ['What should I verify before paying a booking amount?', 'Explain stamp duty', 'Is this priced fairly?'],
  general: ['Find a 3 BHK flat in Gurugram under ₹1.2 crore', 'What should I verify before paying a booking amount?', 'Help me list my property'],
};

/**
 * Handles one user turn. `emit(event, data)` streams to the client.
 * Returns { text, cards, actions, citations, suggestions, source }.
 */
export async function answer({ message, history = [], propertyId, compareIds = [], lastCardIds = [], user }, emit) {
  const role = user?.role || null;
  const intent = detectIntent(message, role);
  const dir = await directory();
  const params = parseQuery(message, dir);

  const ctx = { message, intent, params, role, results: { total: 0, items: [] }, props: [], reports: {}, kb: [], realtorText: '' };
  const citations = [];
  let cards = [];
  const actions = [];

  // Which properties does the user mean?
  let refIds = [];
  if (intent === 'compare') refIds = compareIds.length >= 2 ? compareIds : [propertyId, ...compareIds, ...lastCardIds].filter(Boolean);
  else if (['rera', 'schools', 'healthcare', 'connectivity', 'price', 'finance', 'reviews', 'site-visit'].includes(intent)) refIds = propertyId ? [propertyId] : lastCardIds.slice(0, 1);
  ctx.props = await loadProperties(refIds);

  if (intent === 'search' || (intent === 'general' && Object.keys(params).length >= 2)) {
    ctx.intent = 'search';
    ctx.results = await search({ ...params, limit: 5, sort: params.maxPrice ? 'price_desc' : undefined }, { withFacets: false });
    cards = ctx.results.items.map(cardOf);
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    actions.push({ type: 'link', label: `See all ${ctx.results.total} results`, href: `/search?${qs}` });
    citations.push({ type: 'search', label: `PropFinder listings search (${ctx.results.total} matches)`, href: `/search?${qs}` });
  }

  // Intelligence reports for referenced properties (cached; may call map providers once).
  if (ctx.props.length && intent !== 'site-visit') {
    const reports = await Promise.all(ctx.props.map((p) => buildReport(p).catch(() => null)));
    ctx.props.forEach((p, i) => {
      if (reports[i]) ctx.reports[String(p._id)] = reports[i];
    });
    if (reports.some((r) => r?.nearby?.attribution) && ['schools', 'healthcare', 'connectivity', 'compare'].includes(intent)) {
      const attr = reports.find((r) => r?.nearby?.attribution).nearby.attribution;
      citations.push({ type: 'source', label: attr.text, href: attr.url });
    }
  }
  for (const p of ctx.props) {
    cards.push(cardOf(p));
    citations.push({ type: 'property', label: p.title, href: `/property/${p.slug || p._id}` });
  }
  if (intent === 'compare' && ctx.props.length >= 2) actions.push({ type: 'link', label: 'Open side-by-side comparison', href: `/compare?ids=${ctx.props.map((p) => p._id).join(',')}` });
  if (intent === 'site-visit' && ctx.props[0]) actions.push({ type: 'site-visit', propertyId: String(ctx.props[0]._id), requiresAuth: !user });
  if (intent === 'list-property') actions.push({ type: 'link', label: 'Post a property', href: '/post' });
  if (intent === 'rera' && ctx.props[0]) {
    const rr = ctx.reports[String(ctx.props[0]._id)]?.rera;
    if (rr?.officialUrl) citations.push({ type: 'source', label: rr.authority?.authority || 'State RERA portal', href: rr.officialUrl });
  }

  if (['my-listings', 'my-leads', 'matching-buyers'].includes(intent)) {
    const r = await realtorData(intent, user.id || user._id);
    ctx.realtorText = r.text;
    ctx.realtorData = r.data;
    actions.push({ type: 'link', label: 'Open dashboard', href: '/dashboard' });
  }

  ctx.kb = searchKnowledge(message, 2);
  if (intent === 'list-property' && !ctx.kb.length) ctx.kb = searchKnowledge('list my property', 1);
  for (const a of ctx.kb) citations.push({ type: 'kb', label: a.title, id: a.id });

  const suggestions = SUGGESTIONS[ctx.intent] || SUGGESTIONS.general;
  emit('meta', { intent: ctx.intent, cards: cards.slice(0, 6), actions, citations, suggestions });

  const fallbackText = templateAnswer(ctx.intent, ctx);
  if (!llmEnabled()) {
    for (const chunk of fallbackText.match(/[\s\S]{1,60}/g) || []) emit('delta', { text: chunk });
    return { text: fallbackText, cards, actions, citations, suggestions, source: 'rules' };
  }

  const retrieved = {
    intent: ctx.intent,
    searchFilters: ctx.intent === 'search' ? params : undefined,
    searchResults: ctx.intent === 'search' ? { total: ctx.results.total, items: ctx.results.items.map((p) => ({ ...cardOf(p), pricePerSqft: p.pricePerSqft })) } : undefined,
    properties: ctx.props.map((p) => {
      const r = ctx.reports[String(p._id)];
      return {
        ...cardOf(p),
        constructionStatus: p.constructionStatus,
        furnishing: p.furnishing,
        overall: r?.overall ? { value: r.overall.value, confidence: r.overall.confidence } : null,
        scores: r?.scores?.map((s) => ({ label: s.label, value: s.value, confidence: s.confidence, explanation: s.explanation })),
        price: r?.price?.position,
        comparablesBasis: r?.price ? `${r.price.comparables.n} active listings (asking prices); ${r.price.comparables.demoCount} demo` : null,
        rental: r?.rental,
        rera: r?.rera ? { status: r.rera.status, label: r.rera.label, number: r.rera.registrationNumber, authority: r.rera.authority?.authority, officialUrl: r.rera.officialUrl, discrepancies: r.rera.discrepancies, lastVerifiedAt: r.rera.lastVerifiedAt } : null,
        nearby: r ? locationFacts(r, ['school', 'college', 'hospital', 'clinic', 'metro', 'railway', 'bus_stop', 'airport', 'supermarket', 'park']) : null,
      };
    }),
    realtor: ctx.realtorData,
    knowledge: ctx.kb.map((a) => ({ title: a.title, body: a.body })),
    draftAnswer: fallbackText,
  };

  const system = [
    'You are PropFinder Assistant, helping buyers, tenants, owners and agents in the Indian property market.',
    'Answer ONLY from the retrieved data provided in the latest user turn. If the data does not contain the answer, say what is missing and suggest a practical next step (e.g. open a property page, check the state RERA portal, ask the lister).',
    'Never invent listings, availability, prices, RERA status, nearby places, ratings, reviews or legal conclusions. Mention that distances are straight-line when you quote them. Asking prices are not transaction prices.',
    'Say "RERA registration verified" only when the status is "verified"; never say "RERA approved". RERA registration does not prove title.',
    'For legal, tax or financial questions give general information with a short caveat to consult a qualified professional.',
    'Do not declare one property best for everyone; tie recommendations to the user’s stated priorities.',
    'Use ₹ and lakh/crore. Be concise (under 180 words unless listing results). Use short markdown bullet lists. Listings flagged isDemo are sample data — say so if you mention them. Property cards are shown to the user separately, so do not paste URLs.',
    UNTRUSTED_RULE,
  ].join('\n');

  const turns = history.slice(-8).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1500) }));
  const messages = [...turns, { role: 'user', content: `${message}\n\n${asData('retrieved-data', retrieved)}` }];

  try {
    const text = await llmStream(system, messages, (d) => emit('delta', { text: d }), { maxTokens: 1500 });
    return { text, cards, actions, citations, suggestions, source: 'llm' };
  } catch (err) {
    console.warn('[chat] LLM unavailable, sending rule-based answer:', err.message);
    const prefix = err.partial ? '\n\n' : '';
    const note = `${prefix}_(The AI service is temporarily unavailable, so this answer was generated from rules.)_\n\n`;
    emit('delta', { text: note + fallbackText, replace: !err.partial });
    return { text: (err.partial || '') + note + fallbackText, cards, actions, citations, suggestions, source: 'rules-fallback' };
  }
}

export { toCard };
