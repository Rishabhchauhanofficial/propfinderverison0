import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import { Review, Report, Project, Developer, REVIEW_RATING_KEYS } from '../models/index.js';
import { notify } from '../services/notificationService.js';
import { audit, badRequest, cleanText, forbidden, isId, notFound, paging, str, wrap } from '../utils/http.js';

const TARGET_TYPES = ['property', 'project', 'locality', 'developer'];
const EDIT_WINDOW_DAYS = 30;
const DAILY_LIMIT = 5;
// 'flagged' (default): clean reviews publish immediately, flagged ones wait for a moderator.
// 'all': every review waits for a moderator.
const moderationMode = () => (process.env.REVIEW_MODERATION === 'all' ? 'all' : 'flagged');

const hashText = (s) => crypto.createHash('sha1').update(String(s).toLowerCase().replace(/\W+/g, ' ').trim()).digest('hex');

/** Resolves the target and who "owns" it (owners cannot review their own target). */
async function resolveTarget(type, id) {
  if (!TARGET_TYPES.includes(type)) throw badRequest('Unknown review target.');
  if (type === 'locality') {
    const [city, locality] = String(id || '').split('|');
    if (!city || !locality) throw badRequest('Locality reviews need a city and locality.');
    const key = `${city.trim().toLowerCase()}|${locality.trim().toLowerCase()}`;
    return { key, ownerIds: [], title: `${locality}, ${city}` };
  }
  if (!isId(id)) throw notFound('Review target not found');
  if (type === 'property') {
    const p = await Property.findById(id).select('owner title');
    if (!p) throw notFound('Property not found');
    return { key: String(p._id), ownerIds: [String(p.owner)], title: p.title };
  }
  if (type === 'project') {
    const p = await Project.findById(id).select('createdBy name developer');
    if (!p) throw notFound('Project not found');
    const dev = p.developer ? await Developer.findById(p.developer).select('account') : null;
    return { key: String(p._id), ownerIds: [p.createdBy, dev?.account].filter(Boolean).map(String), title: p.name };
  }
  const d = await Developer.findById(id).select('account name');
  if (!d) throw notFound('Developer not found');
  return { key: String(d._id), ownerIds: [d.account].filter(Boolean).map(String), title: d.name };
}

function parseRatings(input = {}) {
  const ratings = {};
  for (const k of REVIEW_RATING_KEYS) {
    const v = Number(input[k]);
    ratings[k] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
  }
  if (!ratings.overall) throw badRequest('Give an overall rating from 1 to 5.');
  return ratings;
}

async function autoFlags({ body, authorId, reviewId, user }) {
  const flags = [];
  const links = (body.match(/https?:\/\/|www\./gi) || []).length;
  if (links >= 2) flags.push('link-spam');
  if (/(.)\1{7,}/.test(body) || /\b(\w+)\b(?:\W+\1\b){4,}/i.test(body)) flags.push('repetitive');
  if (/\b(\d[\s-]?){10}\b/.test(body)) flags.push('contains-phone');
  const hash = hashText(body);
  if (await Review.exists({ contentHash: hash, _id: { $ne: reviewId } })) flags.push('duplicate-text');
  const created = user?.createdAt || (await mongoose.model('User').findById(authorId).select('createdAt'))?.createdAt;
  if (created && Date.now() - new Date(created).getTime() < 24 * 3600 * 1000) flags.push('new-account');
  return { flags, hash };
}

function summarizeReviews(rows) {
  const dims = {};
  for (const k of REVIEW_RATING_KEYS) {
    const vals = rows.map((r) => r.ratings?.[k]).filter((v) => v != null);
    dims[k] = vals.length ? { avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, n: vals.length } : null;
  }
  const distribution = [1, 2, 3, 4, 5].map((s) => ({ stars: s, count: rows.filter((r) => r.ratings?.overall === s).length }));
  return { count: rows.length, dimensions: dims, distribution };
}

const publicReview = (r, viewerId) => ({
  id: String(r._id),
  targetType: r.targetType,
  ratings: r.ratings,
  title: r.title,
  body: r.body,
  relationship: r.relationship,
  relationshipVerified: Boolean(r.verifiedRelationship),
  photos: r.photos,
  status: r.status,
  author: { id: String(r.author?._id || r.author), name: r.author?.name || 'PropFinder user' },
  replies: (r.replies || []).map((x) => ({ id: String(x._id), body: x.body, authorName: x.authorName, authorRole: x.authorRole, createdAt: x.createdAt })),
  createdAt: r.createdAt,
  editedAt: r.editedAt,
  mine: viewerId ? String(r.author?._id || r.author) === viewerId : false,
});

// GET /api/reviews?targetType=property&targetId=...
export const list = wrap(async (req, res) => {
  const { key } = await resolveTarget(str(req.query.targetType), str(req.query.targetId));
  const { page, limit, skip } = paging(req.query, { defLimit: 10 });
  const sort = str(req.query.sort) === 'lowest' ? { 'ratings.overall': 1, createdAt: -1 } : str(req.query.sort) === 'highest' ? { 'ratings.overall': -1, createdAt: -1 } : { createdAt: -1 };
  const [published, items, mine] = await Promise.all([
    Review.find({ targetKey: key, status: 'published' }).select('ratings').lean(),
    Review.find({ targetKey: key, status: 'published' }).populate('author', 'name').sort(sort).skip(skip).limit(limit).lean(),
    req.userId ? Review.findOne({ targetKey: key, author: req.userId }).populate('author', 'name').lean() : null,
  ]);
  res.json({
    summary: summarizeReviews(published),
    items: items.map((r) => publicReview(r, req.userId)),
    mine: mine ? publicReview(mine, req.userId) : null,
    page,
    pages: Math.ceil(published.length / limit),
    moderation: moderationMode(),
  });
});

export const create = wrap(async (req, res) => {
  const b = req.body || {};
  const target = await resolveTarget(str(b.targetType), str(b.targetId));
  if (target.ownerIds.includes(req.userId)) throw forbidden('You cannot review your own listing, project or company.');
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  if ((await Review.countDocuments({ author: req.userId, createdAt: { $gte: since } })) >= DAILY_LIMIT) {
    throw badRequest('You have reached the daily review limit. Try again tomorrow.');
  }
  const body = cleanText(b.body, 4000);
  if (body.length < 30) throw badRequest('Please write at least 30 characters about your experience.');
  const ratings = parseRatings(b.ratings);
  const { flags, hash } = await autoFlags({ body, authorId: req.userId });

  try {
    const review = await Review.create({
      targetType: b.targetType,
      targetKey: target.key,
      author: req.userId,
      ratings,
      title: cleanText(b.title, 140),
      body,
      relationship: ['resident', 'tenant', 'owner', 'visitor', 'other'].includes(b.relationship) ? b.relationship : 'other',
      photos: (Array.isArray(b.photos) ? b.photos : []).filter((u) => /^\/uploads\/[\w-]+\.\w+$/.test(u)).slice(0, 6),
      status: flags.length || moderationMode() === 'all' ? 'pending' : 'published',
      autoFlags: flags,
      contentHash: hash,
    });
    if (review.status === 'published' && target.ownerIds[0]) {
      await notify(target.ownerIds[0], { type: 'review', title: `New review on ${target.title}`, body: `${ratings.overall}★ — ${review.title || body.slice(0, 80)}`, link: '' });
    }
    await audit(req, 'review.create', 'review', review._id, { status: review.status, flags });
    res.status(201).json({
      review: publicReview(await review.populate('author', 'name'), req.userId),
      message: review.status === 'pending' ? 'Thanks! Your review will appear after a moderator checks it.' : 'Thanks! Your review is live.',
    });
  } catch (err) {
    if (err?.code === 11000) throw badRequest('You have already reviewed this. Edit your existing review instead.');
    throw err;
  }
});

async function ownReview(req) {
  if (!isId(req.params.id)) throw notFound('Review not found');
  const review = await Review.findById(req.params.id);
  if (!review) throw notFound('Review not found');
  if (String(review.author) !== req.userId) throw forbidden('You can only change your own review.');
  return review;
}

export const update = wrap(async (req, res) => {
  const review = await ownReview(req);
  if (Date.now() - review.createdAt.getTime() > EDIT_WINDOW_DAYS * 86400000) throw badRequest(`Reviews can be edited for ${EDIT_WINDOW_DAYS} days after posting.`);
  const b = req.body || {};
  const body = cleanText(b.body ?? review.body, 4000);
  if (body.length < 30) throw badRequest('Please write at least 30 characters.');
  review.body = body;
  if (b.title !== undefined) review.title = cleanText(b.title, 140);
  if (b.ratings) review.ratings = parseRatings(b.ratings);
  const { flags, hash } = await autoFlags({ body, authorId: req.userId, reviewId: review._id });
  review.autoFlags = flags;
  review.contentHash = hash;
  review.editedAt = new Date();
  // Rejected/hidden reviews stay that way until a moderator re-checks the edit.
  review.status = flags.length || moderationMode() === 'all' || ['rejected', 'hidden'].includes(review.status) ? 'pending' : 'published';
  await review.save();
  await audit(req, 'review.edit', 'review', review._id, { status: review.status });
  res.json({ review: publicReview(await review.populate('author', 'name'), req.userId) });
});

export const remove = wrap(async (req, res) => {
  const review = await ownReview(req);
  await review.deleteOne();
  await audit(req, 'review.delete-own', 'review', review._id);
  res.json({ ok: true });
});

// POST /api/reviews/:id/replies — the target's lister/builder or an admin may reply (but never delete).
export const reply = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Review not found');
  const review = await Review.findById(req.params.id);
  if (!review || review.status !== 'published') throw notFound('Review not found');
  const target = await resolveTarget(review.targetType, review.targetType === 'locality' ? review.targetKey : review.targetKey);
  const isOwner = target.ownerIds.includes(req.userId);
  if (!isOwner && req.role !== 'admin') throw forbidden('Only the lister, the developer or PropFinder staff can reply.');
  const body = cleanText(req.body?.body, 2000);
  if (body.length < 5) throw badRequest('Write a reply.');
  review.replies.push({ author: req.userId, authorName: req.user.name, authorRole: req.role === 'admin' ? 'PropFinder team' : isOwner ? 'Lister / developer' : req.role, body });
  await review.save();
  await notify(review.author, { type: 'review', title: 'Someone replied to your review', body: body.slice(0, 120) });
  res.status(201).json({ ok: true });
});

// POST /api/reports  { targetType: 'property'|'review', targetId, reason, details }
export const report = wrap(async (req, res) => {
  const b = req.body || {};
  if (!['property', 'review'].includes(b.targetType) || !isId(b.targetId)) throw badRequest('Invalid report target.');
  const Model = b.targetType === 'property' ? Property : Review;
  if (!(await Model.exists({ _id: b.targetId }))) throw notFound('Not found');
  try {
    await Report.create({ targetType: b.targetType, targetId: b.targetId, reporter: req.userId, reason: b.reason, details: cleanText(b.details, 2000) });
  } catch (err) {
    if (err?.code === 11000) return res.json({ ok: true, message: 'You already reported this. Our moderators will review it.' });
    if (err?.name === 'ValidationError') throw badRequest('Choose a reason for the report.');
    throw err;
  }
  // Reports queue items for moderators; they never hide content automatically.
  if (b.targetType === 'review') await Review.updateOne({ _id: b.targetId }, { $inc: { reportsCount: 1 } });
  res.status(201).json({ ok: true, message: 'Thanks — our moderators will review this.' });
});

/* ---------------- admin moderation ---------------- */

export const moderationQueue = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 20 });
  const status = str(req.query.status) || 'pending';
  const filter = status === 'reported' ? { reportsCount: { $gt: 0 }, status: 'published' } : { status };
  const [items, total] = await Promise.all([
    Review.find(filter).populate('author', 'name email createdAt').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    Review.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

export const moderate = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Review not found');
  const review = await Review.findById(req.params.id);
  if (!review) throw notFound('Review not found');
  const { status, note, verifiedRelationship } = req.body || {};
  if (!['published', 'rejected', 'hidden'].includes(status)) throw badRequest('Choose publish, reject or hide.');
  if (status !== 'published' && cleanText(note, 5).length < 3) throw badRequest('Give a reason when rejecting or hiding a review.');
  const before = review.status;
  review.status = status;
  review.moderationNote = cleanText(note, 500);
  if (typeof verifiedRelationship === 'boolean') review.verifiedRelationship = verifiedRelationship;
  if (status === 'published') review.reportsCount = 0;
  await review.save();
  await Report.updateMany({ targetType: 'review', targetId: review._id, status: 'open' }, { status: 'resolved', resolution: `Review ${status}`, resolvedBy: req.userId });
  await audit(req, 'review.moderate', 'review', review._id, { from: before, to: status, note: review.moderationNote, verifiedRelationship });
  await notify(review.author, { type: 'review', title: `Your review was ${status === 'published' ? 'published' : status}`, body: review.moderationNote });
  res.json({ ok: true, status });
});
