import Property, { LISTING_STATUSES, COMMERCIAL_TYPES } from '../models/Property.js';
import User, { LISTER_ROLES } from '../models/User.js';
import { Lead, ReraRecord, SearchEvent, Favorite } from '../models/index.js';
import { search, suggest as suggestTerms, toCard, CARD_PROJECTION } from '../services/searchService.js';
import { stateCodeFor, authorityFor } from '../services/reraService.js';
import { notify } from '../services/notificationService.js';
import { audit, badRequest, cleanText, forbidden, isId, notFound, str, toNum, wrap } from '../utils/http.js';
import { haversineKm, isValidCoords } from '../utils/geo.js';
import { assignLocation } from '../services/locationService.js';

const OWNER_FIELDS = 'name role company';

// Fields a lister may set. Moderation/verification fields are deliberately absent.
const WRITABLE = [
  'title', 'description', 'listingType', 'propertyType', 'price', 'areaSqft', 'carpetAreaSqft', 'plotAreaSqft',
  'bedrooms', 'bathrooms', 'balconies', 'furnishing', 'floor', 'totalFloors', 'facing', 'ageYears', 'constructionStatus',
  'possessionDate', 'maintenanceMonthly', 'securityDeposit', 'city', 'locality', 'state', 'pinCode', 'address', 'location',
  'amenities', 'images', 'videoUrl', 'developerName', 'project', 'contactPreference', 'documents',
];
const OWNER_STATUSES = ['draft', 'active', 'paused', 'archived', 'sold', 'rented'];

function pickWritable(body = {}) {
  const out = {};
  for (const key of WRITABLE) if (body[key] !== undefined) out[key] = body[key];
  for (const k of ['title', 'locality', 'city', 'address', 'developerName', 'facing', 'state']) {
    if (out[k] !== undefined) out[k] = cleanText(out[k], k === 'address' ? 300 : 160);
  }
  if (out.description !== undefined) out.description = cleanText(out.description, 5000);
  if (out.pinCode !== undefined) out.pinCode = String(out.pinCode).replace(/\D/g, '').slice(0, 6);
  if (out.amenities !== undefined) out.amenities = (Array.isArray(out.amenities) ? out.amenities : []).map((a) => cleanText(a, 60)).filter(Boolean).slice(0, 40);
  if (out.images !== undefined) {
    out.images = (Array.isArray(out.images) ? out.images : []).map(String).filter((u) => /^(https:\/\/|http:\/\/|\/uploads\/)/i.test(u)).slice(0, 20);
  }
  if (out.documents !== undefined) {
    out.documents = (Array.isArray(out.documents) ? out.documents : [])
      .filter((d) => d && /^\/api\/files\/[\w-]+\.\w+$/.test(d.url))
      .map((d) => ({ url: d.url, name: cleanText(d.name, 100), kind: cleanText(d.kind || 'other', 40) }))
      .slice(0, 10);
  }
  if (out.project === '' ) out.project = null;
  if (out.project && !isId(out.project)) delete out.project;
  if (out.possessionDate === '') out.possessionDate = null;
  return out;
}

function validateListing(p) {
  if (!p.title || p.title.length < 5) return 'Title should be at least 5 characters.';
  if (!(p.price > 0)) return 'Enter a valid price in rupees.';
  if (!(p.areaSqft > 0)) return 'Enter the area in sq ft.';
  if (p.carpetAreaSqft && p.carpetAreaSqft > p.areaSqft * 1.05 && p.propertyType !== 'plot') return 'Carpet area cannot be larger than the built-up area.';
  if (p.listingType === 'sale' && p.price < 100000) return 'Sale price looks too low — enter the full amount in rupees (e.g. 7500000 for ₹75 lakh).';
  if (p.listingType === 'rent' && p.price > 5000000) return 'Monthly rent looks too high — enter the monthly amount.';
  if (p.pinCode && !/^\d{6}$/.test(p.pinCode)) return 'PIN code must have 6 digits.';
  const { lat, lng } = p.location || {};
  if ((lat != null) !== (lng != null)) return 'Provide both latitude and longitude, or neither.';
  if (lat != null && !isValidCoords({ lat, lng })) return 'Coordinates are out of range.';
  return null;
}

function serialize(doc, extra = {}) {
  const o = doc.toJSON({ virtuals: true });
  if (o.owner && typeof o.owner === 'object') {
    o.owner = { _id: o.owner._id, id: o.owner._id, name: o.owner.name, role: o.owner.role === 'user' ? 'owner' : o.owner.role, company: o.owner.company || '' };
  }
  return { ...o, ...extra };
}

/** Possible duplicates: same type & place, area within 3%, price within 5%, pins within 150 m. */
async function findDuplicate(p, excludeId) {
  const candidates = await Property.find({
    _id: { $ne: excludeId },
    status: { $in: ['active', 'paused', 'draft'] },
    listingType: p.listingType,
    propertyType: p.propertyType,
    city: new RegExp(`^${String(p.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    bedrooms: p.bedrooms || 0,
    areaSqft: { $gte: p.areaSqft * 0.97, $lte: p.areaSqft * 1.03 },
    price: { $gte: p.price * 0.95, $lte: p.price * 1.05 },
  })
    .select('title slug location locality owner')
    .limit(20)
    .lean();
  return candidates.find((c) => {
    if (isValidCoords(p.location) && isValidCoords(c.location)) return haversineKm(p.location, c.location) <= 0.15;
    return String(c.locality).toLowerCase() === String(p.locality).toLowerCase();
  });
}

async function syncReraRecord(property, req) {
  const number = property.rera?.number;
  if (!number) return;
  const state = stateCodeFor({ state: property.rera.state || property.state, city: property.city }) || property.rera.state || '';
  const existing = await ReraRecord.findOne({ property: property._id });
  if (existing && existing.registrationNumber === number && existing.state === state) return;
  const authority = authorityFor(state);
  const fields = {
    property: property._id,
    project: property.project || null,
    registrationNumber: number,
    state: state || 'unknown',
    authority: authority?.authority || '',
    officialUrl: authority?.url || '',
    status: 'not-verified',
    method: 'not-checked',
    submitted: {
      projectName: cleanText(req.body?.rera?.projectName, 160),
      promoterName: property.developerName || '',
      possessionDate: property.possessionDate || null,
    },
    official: {},
    discrepancies: [],
    lastVerifiedAt: null,
  };
  if (existing) {
    existing.set(fields);
    existing.history.push({ status: 'not-verified', note: 'Registration number changed by lister; verification reset.', by: req.userId });
    await existing.save();
  } else {
    await ReraRecord.create({ ...fields, history: [{ status: 'not-verified', note: 'Submitted by lister.', by: req.userId }] });
  }
  property.rera.status = 'not-verified';
  property.rera.state = state;
}

function applyRera(property, body) {
  if (body.rera === undefined) return;
  const number = cleanText(body.rera?.number, 80).toUpperCase().replace(/\s+/g, ' ');
  const state = cleanText(body.rera?.state, 40);
  property.rera = property.rera || {};
  if (body.rera?.notApplicable && !number) {
    property.rera.number = '';
    property.rera.status = 'not-applicable';
    property.rera.state = state;
    return;
  }
  if (number !== property.rera.number) {
    property.rera.number = number;
    property.rera.status = number ? 'not-verified' : 'not-provided';
  }
  property.rera.state = state || property.rera.state;
}

/* ---------------- public ---------------- */

export const list = wrap(async (req, res) => {
  const result = await search(req.query);
  // Privacy-conscious analytics: filter keys only.
  const filterKeys = Object.keys(req.query).filter((k) => !['page', 'limit', 'sort', 'q', 'near'].includes(k));
  SearchEvent.create({
    listingType: str(req.query.listingType) || 'any',
    city: str(req.query.city).slice(0, 40),
    propertyType: str(req.query.propertyType).slice(0, 40),
    hasQuery: Boolean(req.query.q),
    filters: filterKeys.slice(0, 20),
    results: result.total,
  }).catch(() => {});
  res.json(result);
});

export const suggest = wrap(async (req, res) => {
  res.json({ items: await suggestTerms(req.query.q) });
});

export const getOne = wrap(async (req, res) => {
  const key = req.params.id;
  const property = await Property.findOne(isId(key) ? { _id: key } : { slug: key })
    .sort({ createdAt: -1 })
    .populate('owner', OWNER_FIELDS)
    .populate('project', 'name slug status possessionDate developerName');
  if (!property) throw notFound('Property not found');

  const isOwner = req.userId && String(property.owner?._id) === req.userId;
  const canSeeHidden = isOwner || req.role === 'admin';
  if (['draft', 'paused', 'archived'].includes(property.status) && !canSeeHidden) throw notFound('Property not found');

  if (!isOwner) Property.updateOne({ _id: property._id }, { $inc: { views: 1 } }, { timestamps: false }).catch(() => {});
  if (req.userId) {
    User.updateOne({ _id: req.userId }, { $pull: { recentlyViewed: { property: property._id } } })
      .then(() =>
        User.updateOne(
          { _id: req.userId },
          { $push: { recentlyViewed: { $each: [{ property: property._id, viewedAt: new Date() }], $position: 0, $slice: 20 } } }
        )
      )
      .catch(() => {});
  }

  // Similar: same city & listing type, related property types, price within ±35%.
  const group = COMMERCIAL_TYPES.includes(property.propertyType) ? COMMERCIAL_TYPES : property.propertyType === 'plot' ? ['plot'] : ['apartment', 'villa', 'independent-house', 'builder-floor'];
  const related = await Property.find({
    _id: { $ne: property._id },
    city: property.city,
    listingType: property.listingType,
    propertyType: { $in: group },
    status: 'active',
    price: { $gte: property.price * 0.65, $lte: property.price * 1.35 },
  })
    .select(CARD_PROJECTION)
    .sort({ createdAt: -1 })
    .limit(4)
    .populate('owner', OWNER_FIELDS)
    .lean();

  const out = serialize(property, { isOwner: Boolean(isOwner) });
  // Documents are private to the owner and admins.
  if (!canSeeHidden) delete out.documents;
  out.isFavorite = req.userId ? Boolean(await Favorite.exists({ user: req.userId, property: property._id })) : false;
  if (property.possibleDuplicateOf && !canSeeHidden) delete out.possibleDuplicateOf;

  res.json({ property: out, related: related.map(toCard) });
});

/* ---------------- lister actions ---------------- */

export const create = wrap(async (req, res) => {
  if (!LISTER_ROLES.includes(req.role)) {
    throw forbidden('Switch your account to owner, agent or builder (Profile → Account type) to post listings.');
  }
  const data = pickWritable(req.body);
  const status = OWNER_STATUSES.includes(req.body?.status) ? req.body.status : 'active';
  const property = new Property({
    ...data,
    status,
    owner: req.userId,
    postedByRole: ['agent', 'builder', 'admin'].includes(req.role) ? req.role : 'owner',
  });
  applyRera(property, req.body || {});
  if (status !== 'draft') {
    const err = validateListing(property);
    if (err) throw badRequest(err);
  }
  const dup = await findDuplicate(property, property._id);
  if (dup) property.possibleDuplicateOf = dup._id;
  await assignLocation(property, { force: true });
  await property.save();
  await syncReraRecord(property, req);
  if (property.isModified()) await property.save();
  await property.populate('owner', OWNER_FIELDS);
  await audit(req, 'property.create', 'property', property._id, { status, duplicateOf: dup?._id });
  res.status(201).json({
    ...serialize(property),
    warnings: dup ? [`This looks similar to an existing listing ("${dup.title}"). Our moderators may review it.`] : [],
  });
});

async function findManageable(req) {
  if (!isId(req.params.id)) throw notFound('Property not found');
  const property = await Property.findById(req.params.id);
  if (!property) throw notFound('Property not found');
  if (String(property.owner) !== req.userId && req.role !== 'admin') throw forbidden('Not your listing');
  return property;
}

export const update = wrap(async (req, res) => {
  const property = await findManageable(req);
  property.set(pickWritable(req.body));
  applyRera(property, req.body || {});
  if (req.body?.status !== undefined) {
    if (!OWNER_STATUSES.includes(req.body.status)) throw badRequest('Invalid status');
    property.status = req.body.status;
  }
  if (property.status !== 'draft') {
    const err = validateListing(property);
    if (err) throw badRequest(err);
  }
  await syncReraRecord(property, req);
  await assignLocation(property);
  await property.save();
  await property.populate('owner', OWNER_FIELDS);
  await audit(req, 'property.update', 'property', property._id, { by: req.role });
  res.json(serialize(property));
});

export const setStatus = wrap(async (req, res) => {
  const property = await findManageable(req);
  const status = str(req.body?.status);
  if (!LISTING_STATUSES.includes(status)) throw badRequest('Invalid status');
  if (status === 'active') {
    const err = validateListing(property);
    if (err) throw badRequest(`Cannot publish yet: ${err}`);
  }
  property.status = status;
  await property.save();
  await audit(req, 'property.status', 'property', property._id, { status });
  res.json({ id: property.id, status: property.status });
});

export const remove = wrap(async (req, res) => {
  const property = await findManageable(req);
  await property.deleteOne();
  await Promise.all([ReraRecord.deleteMany({ property: property._id }), Favorite.deleteMany({ property: property._id })]);
  await audit(req, 'property.delete', 'property', property._id, { title: property.title });
  res.json({ ok: true });
});

export const mine = wrap(async (req, res) => {
  const docs = await Property.find({ owner: req.userId }).sort({ updatedAt: -1 });
  const ids = docs.map((d) => d._id);
  const [leadCounts, favCounts] = await Promise.all([
    Lead.aggregate([{ $match: { property: { $in: ids } } }, { $group: { _id: '$property', n: { $sum: 1 } } }]),
    Favorite.aggregate([{ $match: { property: { $in: ids } } }, { $group: { _id: '$property', n: { $sum: 1 } } }]),
  ]);
  const leadsBy = Object.fromEntries(leadCounts.map((l) => [String(l._id), l.n]));
  const favBy = Object.fromEntries(favCounts.map((l) => [String(l._id), l.n]));
  res.json({
    items: docs.map((d) => serialize(d, { leads: leadsBy[d.id] || 0, saves: favBy[d.id] || 0 })),
    total: docs.length,
  });
});

/* ---------------- contact (creates a lead) ---------------- */

export const contact = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Property not found');
  const property = await Property.findById(req.params.id).populate('owner', 'name phone role status');
  if (!property || property.status !== 'active') throw notFound('Property not found');
  if (String(property.owner._id) === req.userId) throw badRequest('This is your own listing.');

  const b = req.body || {};
  const source = ['contact-form', 'phone-reveal', 'chat'].includes(b.source) ? b.source : 'contact-form';
  const me = await User.findById(req.userId).select('name email phone');

  // One open lead per buyer per listing: update instead of duplicating.
  let lead = await Lead.findOne({ property: property._id, buyer: req.userId, status: { $nin: ['won', 'lost'] } });
  const requirements = {
    budgetMax: toNum(b.requirements?.budgetMax),
    bedrooms: toNum(b.requirements?.bedrooms),
    moveInBy: b.requirements?.moveInBy ? new Date(b.requirements.moveInBy) : null,
    purpose: ['self-use', 'investment', 'rental'].includes(b.requirements?.purpose) ? b.requirements.purpose : '',
  };
  if (requirements.moveInBy && Number.isNaN(requirements.moveInBy.getTime())) requirements.moveInBy = null;
  const message = cleanText(b.message, 2000);

  if (!lead) {
    lead = await Lead.create({
      property: property._id,
      listingOwner: property.owner._id,
      buyer: req.userId,
      name: cleanText(b.name, 120) || me.name,
      phone: cleanText(b.phone, 30) || me.phone || '',
      email: me.email.endsWith('@phone.propfinder.local') ? '' : me.email,
      message,
      requirements,
      source,
    });
    await Property.updateOne({ _id: property._id }, { $inc: { leadsCount: 1 } }, { timestamps: false });
    await notify(property.owner._id, {
      type: 'lead',
      title: `New enquiry for ${property.title}`,
      body: message ? message.slice(0, 140) : `${lead.name} wants to know more.`,
      link: '/dashboard?tab=leads',
    });
  } else if (message) {
    lead.message = message;
    lead.notes.push({ body: `Buyer follow-up: ${message.slice(0, 300)}` });
    await lead.save();
  }

  const sharePhone = property.contactPreference !== 'chat' && property.owner.phone;
  res.status(201).json({
    ok: true,
    leadId: lead.id,
    phone: sharePhone ? property.owner.phone : null,
    message: sharePhone ? 'Contact details shared.' : 'Your enquiry was sent. The lister prefers to reply by message.',
  });
});
