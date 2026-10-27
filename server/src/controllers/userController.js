import Property from '../models/Property.js';
import User from '../models/User.js';
import { Favorite, SavedSearch, Notification, Lead, SiteVisit } from '../models/index.js';
import { search, toCard, CARD_PROJECTION } from '../services/searchService.js';
import { badRequest, cleanText, isId, notFound, wrap } from '../utils/http.js';

/* ---------------- favourites ---------------- */

export const listFavorites = wrap(async (req, res) => {
  const favs = await Favorite.find({ user: req.userId }).sort({ createdAt: -1 }).lean();
  const props = await Property.find({ _id: { $in: favs.map((f) => f.property) } }).select(CARD_PROJECTION).populate('owner', 'name role company').lean();
  const byId = new Map(props.map((p) => [String(p._id), p]));
  res.json({
    items: favs.map((f) => byId.get(String(f.property))).filter(Boolean).map(toCard),
    ids: favs.map((f) => String(f.property)),
  });
});

export const addFavorite = wrap(async (req, res) => {
  if (!isId(req.params.propertyId) || !(await Property.exists({ _id: req.params.propertyId }))) throw notFound('Property not found');
  const r = await Favorite.updateOne({ user: req.userId, property: req.params.propertyId }, { $setOnInsert: { user: req.userId, property: req.params.propertyId } }, { upsert: true });
  if (r.upsertedCount) await Property.updateOne({ _id: req.params.propertyId }, { $inc: { favoritesCount: 1 } }, { timestamps: false });
  res.status(201).json({ ok: true, saved: true });
});

export const removeFavorite = wrap(async (req, res) => {
  if (!isId(req.params.propertyId)) throw notFound('Property not found');
  const r = await Favorite.deleteOne({ user: req.userId, property: req.params.propertyId });
  if (r.deletedCount) await Property.updateOne({ _id: req.params.propertyId }, { $inc: { favoritesCount: -1 } }, { timestamps: false });
  res.json({ ok: true, saved: false });
});

/* ---------------- saved searches ---------------- */

const ALLOWED_PARAMS = [
  'listingType', 'propertyType', 'city', 'locality', 'q', 'pinCode', 'minPrice', 'maxPrice', 'bedrooms', 'bathrooms', 'minArea', 'maxArea',
  'furnishing', 'constructionStatus', 'reraVerified', 'verified', 'postedBy', 'amenities', 'commercial', 'maxAge', 'developer', 'minPpsf', 'maxPpsf',
  'nearMetroKm', 'nearSchoolKm', 'nearHospitalKm', 'possessionBy', 'areaType', 'excludeDemo',
];

export const listSavedSearches = wrap(async (req, res) => {
  const rows = await SavedSearch.find({ user: req.userId }).sort({ createdAt: -1 }).lean();
  // New matches since last check (cheap count per search).
  const items = await Promise.all(
    rows.map(async (s) => {
      const r = await search({ ...s.params, limit: 1 }, { withFacets: false });
      const fresh = await search({ ...s.params, limit: 50, sort: 'newest' }, { withFacets: false });
      const newCount = fresh.items.filter((p) => new Date(p.createdAt) > new Date(s.lastCheckedAt)).length;
      return { ...s, id: String(s._id), total: r.total, newCount };
    })
  );
  res.json({ items });
});

export const createSavedSearch = wrap(async (req, res) => {
  const params = {};
  for (const k of ALLOWED_PARAMS) if (req.body?.params?.[k] !== undefined && req.body.params[k] !== '') params[k] = String(req.body.params[k]).slice(0, 80);
  if (!Object.keys(params).length) throw badRequest('Add at least one filter before saving the search.');
  if ((await SavedSearch.countDocuments({ user: req.userId })) >= 25) throw badRequest('You can keep up to 25 saved searches.');
  const name = cleanText(req.body?.name, 120) || [params.bedrooms && `${params.bedrooms}+ BHK`, params.propertyType, params.locality, params.city].filter(Boolean).join(' ') || 'My search';
  const s = await SavedSearch.create({ user: req.userId, name, params, notify: req.body?.notify !== false });
  res.status(201).json({ ...s.toObject(), id: s.id });
});

export const touchSavedSearch = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Saved search not found');
  const s = await SavedSearch.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { lastCheckedAt: new Date(), ...(typeof req.body?.notify === 'boolean' ? { notify: req.body.notify } : {}) }, { new: true });
  if (!s) throw notFound('Saved search not found');
  res.json({ ok: true });
});

export const deleteSavedSearch = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Saved search not found');
  await SavedSearch.deleteOne({ _id: req.params.id, user: req.userId });
  res.json({ ok: true });
});

/* ---------------- recently viewed ---------------- */

export const recentlyViewed = wrap(async (req, res) => {
  const user = await User.findById(req.userId).select('recentlyViewed').lean();
  const ids = (user?.recentlyViewed || []).map((r) => r.property);
  const props = await Property.find({ _id: { $in: ids }, status: { $in: ['active', 'sold', 'rented'] } }).select(CARD_PROJECTION).lean();
  const byId = new Map(props.map((p) => [String(p._id), p]));
  res.json({ items: ids.map((id) => byId.get(String(id))).filter(Boolean).map(toCard) });
});

export const clearRecentlyViewed = wrap(async (req, res) => {
  await User.updateOne({ _id: req.userId }, { $set: { recentlyViewed: [] } });
  res.json({ ok: true });
});

/* ---------------- notifications ---------------- */

export const notifications = wrap(async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ user: req.userId, read: false }),
  ]);
  res.json({ items, unread });
});

export const markNotificationsRead = wrap(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isId);
  await Notification.updateMany({ user: req.userId, ...(ids.length ? { _id: { $in: ids } } : {}) }, { read: true });
  res.json({ ok: true });
});

/* ---------------- buyer activity ---------------- */

export const myEnquiries = wrap(async (req, res) => {
  const [leads, visits] = await Promise.all([
    Lead.find({ buyer: req.userId }).select('property status message createdAt source').populate('property', 'title slug price listingType city locality images').sort({ createdAt: -1 }).limit(50).lean(),
    SiteVisit.find({ requester: req.userId }).populate('property', 'title slug city locality').sort({ scheduledAt: -1 }).limit(50).lean(),
  ]);
  res.json({ leads, visits });
});
