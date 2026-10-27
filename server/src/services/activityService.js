/*
 * Opt-in buyer activity shared with listers.
 *
 * Rules:
 *  - Nothing is recorded unless the user switched sharing on (a separate, unticked opt-in).
 *  - A lister sees a buyer's activity only if that buyer opted in AND has contacted that lister
 *    (an enquiry or site visit on one of their listings). Admins can see it for moderation.
 *  - Activity on the lister's own listings is shown in full. Activity on other listers' properties is
 *    described generally ("Viewed a 3 BHK apartment in Baner, Pune · ₹1.1 Cr"), never naming the
 *    listing or the other lister.
 *  - Events expire after 30 days; switching sharing off deletes them at once.
 */
import { ActivityEvent, Lead, SavedSearch } from '../models/index.js';
import { formatINR } from '../utils/format.js';

export const CONSENT_VERSION = '2026-10-27';
export const CONSENT_TEXT =
  'Share my property activity with listers I contact: the properties I view, save, compare and enquire about, ' +
  'my searches and the forms I submit on PropFinder in the last 30 days, so they can suggest better matches. ' +
  'I can turn this off at any time in my profile, which deletes this activity.';
const WINDOW_DAYS = 30;
const VIEW_DEDUPE_MS = 30 * 60 * 1000;

const TYPE_LABEL = {
  view: 'Viewed',
  save: 'Saved',
  unsave: 'Removed from shortlist',
  compare: 'Compared',
  contact: 'Enquired about',
  visit: 'Requested a site visit for',
  search: 'Searched for',
  'saved-search': 'Saved a search for',
};

const sharing = (user) => !!user?.activitySharing?.enabled;

/** Turn sharing on or off for a user document (saves it). Off deletes their activity. */
export async function setSharing(user, enabled) {
  if (enabled) {
    user.activitySharing = { enabled: true, consentedAt: new Date(), withdrawnAt: null, version: CONSENT_VERSION };
  } else {
    user.activitySharing = { ...(user.activitySharing?.toObject?.() || user.activitySharing || {}), enabled: false, withdrawnAt: new Date() };
    await ActivityEvent.deleteMany({ user: user._id });
  }
  await user.save();
  return user.activitySharing;
}

export function propertyMeta(p) {
  return {
    title: p.title,
    slug: p.slug,
    city: p.city,
    locality: p.locality,
    propertyType: p.propertyType,
    listingType: p.listingType,
    bedrooms: p.bedrooms ?? null,
    price: p.price ?? null,
  };
}

/**
 * Record one event for the signed-in user if they share activity. Never throws; never blocks the request.
 * property: a Property document or lean object (needs owner + the meta fields).
 */
export function record(req, type, { property = null, meta = null } = {}) {
  if (!req.userId || !sharing(req.user)) return;
  const owner = property?.owner?._id || property?.owner || null;
  if (property && owner && String(owner) === req.userId) return; // own listings are not "activity"
  (async () => {
    if (type === 'view' && property) {
      const recent = await ActivityEvent.exists({ user: req.userId, type: 'view', property: property._id, createdAt: { $gte: new Date(Date.now() - VIEW_DEDUPE_MS) } });
      if (recent) return;
    }
    if (type === 'search') {
      // The search page re-queries on every filter tweak; keep one event per distinct search in a row.
      const last = await ActivityEvent.findOne({ user: req.userId, type: 'search' }).sort({ createdAt: -1 }).select('meta').lean();
      if (last && JSON.stringify(last.meta) === JSON.stringify(meta)) return;
    }
    await ActivityEvent.create({
      user: req.userId,
      type,
      property: property?._id || null,
      owner,
      meta: meta || (property ? propertyMeta(property) : {}),
    });
  })().catch((err) => console.warn(`[activity] not recorded: ${err.message}`));
}

/** Search filters worth showing a lister: where, what, how big, budget. Free text is not kept. */
export function searchMeta(q = {}) {
  const pick = (k, n = 60) => (q[k] ? String(q[k]).slice(0, n) : undefined);
  const m = {
    city: pick('city'),
    locality: pick('locality'),
    location: pick('location'),
    listingType: pick('listingType', 10),
    propertyType: pick('propertyType'),
    bedrooms: pick('bedrooms', 10),
    minPrice: q.minPrice ? Number(q.minPrice) || undefined : undefined,
    maxPrice: q.maxPrice ? Number(q.maxPrice) || undefined : undefined,
  };
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== ''));
}

const typeWord = (t) => String(t || 'property').replace(/-/g, ' ');
const bhk = (n) => (n ? `${n} BHK ` : '');

function describeProperty(m = {}) {
  const where = [m.locality, m.city].filter(Boolean).join(', ');
  const price = m.price ? ` · ${formatINR(m.price)}${m.listingType === 'rent' ? '/mo' : ''}` : '';
  return `a ${bhk(m.bedrooms)}${typeWord(m.propertyType)}${m.listingType === 'rent' ? ' for rent' : ''}${where ? ` in ${where}` : ''}${price}`;
}

function describeSearch(m = {}) {
  const what = [m.bedrooms ? `${m.bedrooms}+ BHK` : '', m.propertyType ? typeWord(m.propertyType) : 'properties', m.listingType === 'rent' ? 'to rent' : m.listingType === 'sale' ? 'to buy' : '']
    .filter(Boolean)
    .join(' ');
  const where = [m.locality, m.city || m.location].filter(Boolean).join(', ');
  const budget = m.minPrice || m.maxPrice ? ` · ${m.minPrice ? formatINR(m.minPrice) : 'any'} – ${m.maxPrice ? formatINR(m.maxPrice) : 'any'}` : '';
  return `${what}${where ? ` in ${where}` : ''}${budget}`;
}

function top(values, n = 3) {
  const counts = new Map();
  for (const v of values) if (v !== undefined && v !== null && v !== '') counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return Math.round(sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo));
}

/** What a buyer appears to want, from their own activity: places, types, size and budget. */
export function preferencesFrom(events) {
  const interest = events.filter((e) => ['view', 'save', 'compare', 'contact', 'visit'].includes(e.type));
  const searches = events.filter((e) => e.type === 'search' || e.type === 'saved-search');
  const all = [...interest.map((e) => e.meta || {}), ...searches.map((e) => e.meta || {})];
  const intent = top(all.map((m) => m.listingType).filter((t) => t === 'sale' || t === 'rent'), 2);
  const mainType = intent[0]?.value || null;
  const prices = interest
    .map((e) => e.meta || {})
    .filter((m) => m.price > 0 && (!mainType || m.listingType === mainType))
    .map((m) => m.price)
    .sort((a, b) => a - b);
  return {
    lookingTo: mainType === 'rent' ? 'rent' : mainType === 'sale' ? 'buy' : null,
    cities: top(all.map((m) => m.city || m.location)),
    localities: top(all.map((m) => m.locality)),
    propertyTypes: top(all.map((m) => m.propertyType)),
    bedrooms: top(all.map((m) => (m.bedrooms ? String(m.bedrooms) : null))),
    // Middle half of the prices they looked at (needs at least 3 to say anything).
    budget: prices.length >= 3 ? { low: quantile(prices, 0.25), high: quantile(prices, 0.75), basedOn: prices.length } : null,
  };
}

function summarize(events) {
  const count = (t) => events.filter((e) => e.type === t).length;
  return {
    propertiesViewed: new Set(events.filter((e) => e.type === 'view' && e.property).map((e) => String(e.property))).size,
    views: count('view'),
    saves: count('save'),
    compares: count('compare'),
    enquiries: count('contact'),
    siteVisits: count('visit'),
    searches: count('search') + count('saved-search'),
  };
}

async function recentEvents(userId) {
  return ActivityEvent.find({ user: userId, createdAt: { $gte: new Date(Date.now() - WINDOW_DAYS * 86400000) } })
    .sort({ createdAt: -1 })
    .limit(2000)
    .lean();
}

/** May this lister see this buyer's activity? Only after the buyer contacted them (or for admins). */
export async function canSeeBuyer({ listerId, buyerId, isAdmin }) {
  if (isAdmin) return true;
  return !!(await Lead.exists({ listingOwner: listerId, buyer: buyerId }));
}

/** The lister's view of one buyer. Returns { sharing:false } when the buyer has not opted in. */
export async function buyerActivityFor({ listerId, buyer }) {
  if (!sharing(buyer)) return { sharing: false, windowDays: WINDOW_DAYS };
  const events = await recentEvents(buyer._id);
  const lister = String(listerId);
  const timeline = events.slice(0, 150).map((e) => {
    const m = e.meta || {};
    const at = e.createdAt;
    if (e.type === 'search' || e.type === 'saved-search') return { type: e.type, at, text: `${TYPE_LABEL[e.type]} ${describeSearch(m)}` };
    if (e.owner && String(e.owner) === lister) {
      return { type: e.type, at, yourListing: true, text: `${TYPE_LABEL[e.type]} your listing "${m.title || 'a listing'}"`, property: { id: e.property, slug: m.slug, title: m.title } };
    }
    return { type: e.type, at, yourListing: false, text: `${TYPE_LABEL[e.type]} ${describeProperty(m)}` };
  });
  const savedSearches = await SavedSearch.find({ user: buyer._id }).select('params createdAt').sort({ createdAt: -1 }).limit(10).lean();
  return {
    sharing: true,
    windowDays: WINDOW_DAYS,
    since: buyer.activitySharing.consentedAt,
    buyer: { id: buyer._id, name: buyer.name },
    summary: summarize(events),
    onYourListings: events.filter((e) => e.owner && String(e.owner) === lister && e.type !== 'unsave').length,
    preferences: preferencesFrom(events),
    savedSearches: savedSearches.map((s) => ({ text: describeSearch(searchMeta(s.params || {})), createdAt: s.createdAt })),
    timeline,
  };
}

/** The buyer's own view of what is shared (full detail, it is their data). */
export async function ownActivity(user) {
  const events = sharing(user) ? await recentEvents(user._id) : [];
  return {
    sharing: sharing(user),
    consentedAt: user.activitySharing?.consentedAt || null,
    consentText: CONSENT_TEXT,
    windowDays: WINDOW_DAYS,
    summary: summarize(events),
    preferences: preferencesFrom(events),
    timeline: events.slice(0, 200).map((e) => ({
      type: e.type,
      at: e.createdAt,
      text: e.type === 'search' || e.type === 'saved-search' ? `${TYPE_LABEL[e.type]} ${describeSearch(e.meta)}` : `${TYPE_LABEL[e.type]} "${e.meta?.title || describeProperty(e.meta)}"`,
    })),
  };
}

