import mongoose from 'mongoose';
import Property from '../models/Property.js';
import User, { ALL_ROLES } from '../models/User.js';
import {
  AnalysisReport,
  AuditLog,
  ContactMessage,
  IntegrationEvent,
  Lead,
  Project,
  ReraRecord,
  Report,
  Review,
  SearchEvent,
} from '../models/index.js';
import { buildReport } from '../services/analysisService.js';
import { llmEnabled, llmProvider } from '../services/llmService.js';
import { providerName, routingEnabled } from '../services/placesService.js';
import { notify } from '../services/notificationService.js';
import { audit, badRequest, cleanText, escapeRegex, isId, notFound, paging, str, wrap } from '../utils/http.js';

export const stats = wrap(async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const [users, byRole, listings, byStatus, pendingRera, pendingReviews, openReports, leads30, searches30, openMessages, duplicates] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
    Property.countDocuments(),
    Property.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ReraRecord.countDocuments({ status: { $in: ['not-verified', 'found-needs-review'] } }),
    Review.countDocuments({ status: 'pending' }),
    Report.countDocuments({ status: 'open' }),
    Lead.countDocuments({ createdAt: { $gte: since } }),
    SearchEvent.countDocuments({ createdAt: { $gte: since } }),
    ContactMessage.countDocuments({ status: 'open' }),
    Property.countDocuments({ possibleDuplicateOf: { $ne: null }, status: { $in: ['active', 'paused', 'draft'] } }),
  ]);
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  res.json({ users, byRole: toMap(byRole), listings, byStatus: toMap(byStatus), pendingRera, pendingReviews, openReports, leads30, searches30, openMessages, duplicates });
});

/* ---------------- users ---------------- */

export const users = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 25 });
  const filter = {};
  if (ALL_ROLES.includes(str(req.query.role))) filter.role = str(req.query.role);
  if (['active', 'suspended'].includes(str(req.query.status))) filter.status = str(req.query.status);
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(str(req.query.q)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { company: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).select('name email role status company phone createdAt lastLoginAt').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

// PATCH /api/admin/users/:id  { role?, status?, confirm: true, reason }
export const updateUser = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('User not found');
  if (req.params.id === req.userId) throw badRequest('You cannot change your own role or status.');
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User not found');
  const b = req.body || {};
  if (b.confirm !== true) throw badRequest('Confirmation required for account changes.');
  const reason = cleanText(b.reason, 500);
  const before = { role: user.role, status: user.status };
  if (b.role !== undefined) {
    if (!ALL_ROLES.includes(b.role) || b.role === 'user') throw badRequest('Invalid role');
    user.role = b.role;
  }
  if (b.status !== undefined) {
    if (!['active', 'suspended'].includes(b.status)) throw badRequest('Invalid status');
    if (b.status === 'suspended' && reason.length < 5) throw badRequest('Give a reason for the suspension.');
    user.status = b.status;
    // Suspending a lister pauses their active listings.
    if (b.status === 'suspended') await Property.updateMany({ owner: user._id, status: 'active' }, { status: 'paused' });
  }
  await user.save();
  await audit(req, 'admin.user-update', 'user', user._id, { before, after: { role: user.role, status: user.status }, reason });
  res.json({ user: user.toSafeJSON() });
});

/* ---------------- listings ---------------- */

export const listings = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 25 });
  const filter = {};
  if (str(req.query.status)) filter.status = str(req.query.status);
  if (str(req.query.duplicates) === '1') filter.possibleDuplicateOf = { $ne: null };
  if (str(req.query.reported) === '1') {
    const ids = await Report.distinct('targetId', { targetType: 'property', status: 'open' });
    filter._id = { $in: ids };
  }
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(str(req.query.q)), 'i');
    filter.$or = [{ title: rx }, { city: rx }, { locality: rx }];
  }
  const [items, total] = await Promise.all([
    Property.find(filter)
      .select('title slug status city locality price listingType owner possibleDuplicateOf listingVerified rera isDemo createdAt views leadsCount')
      .populate('owner', 'name email role')
      .populate('possibleDuplicateOf', 'title slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Property.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

// PATCH /api/admin/listings/:id  { status?, listingVerified?, clearDuplicate?, reason, confirm }
export const moderateListing = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Property not found');
  const p = await Property.findById(req.params.id);
  if (!p) throw notFound('Property not found');
  const b = req.body || {};
  const reason = cleanText(b.reason, 500);
  const changes = {};
  if (b.status !== undefined) {
    if (!['active', 'paused', 'archived'].includes(b.status)) throw badRequest('Admins can set active, paused or archived.');
    if (b.status !== 'active' && reason.length < 5) throw badRequest('Give a reason when pausing or archiving a listing.');
    p.status = b.status;
    changes.status = b.status;
  }
  if (typeof b.listingVerified === 'boolean') {
    p.listingVerified = b.listingVerified;
    p.verifiedAt = b.listingVerified ? new Date() : null;
    changes.listingVerified = b.listingVerified;
  }
  if (b.clearDuplicate) {
    p.possibleDuplicateOf = null;
    changes.clearDuplicate = true;
  }
  await p.save();
  await audit(req, 'admin.listing-moderate', 'property', p._id, { ...changes, reason });
  if (changes.status && changes.status !== 'active') {
    await notify(p.owner, { type: 'moderation', title: `Your listing was ${changes.status}`, body: `${p.title}: ${reason}`, link: '/dashboard' });
  }
  res.json({ ok: true, status: p.status, listingVerified: p.listingVerified });
});

// DELETE /api/admin/listings/:id  { confirm: 'DELETE', reason }
export const deleteListing = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Property not found');
  if (req.body?.confirm !== 'DELETE') throw badRequest('Type DELETE to confirm permanent deletion.');
  const reason = cleanText(req.body?.reason, 500);
  if (reason.length < 5) throw badRequest('Give a reason for deleting this listing.');
  const p = await Property.findById(req.params.id);
  if (!p) throw notFound('Property not found');
  await p.deleteOne();
  await audit(req, 'admin.listing-delete', 'property', p._id, { title: p.title, owner: String(p.owner), reason });
  res.json({ ok: true });
});

/* ---------------- reports ---------------- */

export const reports = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 25 });
  const filter = { status: ['open', 'resolved', 'dismissed'].includes(str(req.query.status)) ? str(req.query.status) : 'open' };
  const [items, total] = await Promise.all([
    Report.find(filter).populate('reporter', 'name email').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    Report.countDocuments(filter),
  ]);
  // Attach a short label for each target.
  const propIds = items.filter((r) => r.targetType === 'property').map((r) => r.targetId);
  const reviewIds = items.filter((r) => r.targetType === 'review').map((r) => r.targetId);
  const [props, revs] = await Promise.all([
    Property.find({ _id: { $in: propIds } }).select('title slug status').lean(),
    Review.find({ _id: { $in: reviewIds } }).select('title body status').lean(),
  ]);
  const label = new Map([...props.map((p) => [String(p._id), { title: p.title, href: `/property/${p.slug || p._id}`, status: p.status }]), ...revs.map((r) => [String(r._id), { title: r.title || r.body.slice(0, 60), status: r.status }])]);
  res.json({ items: items.map((r) => ({ ...r, target: label.get(String(r.targetId)) || null })), total, page, pages: Math.ceil(total / limit) });
});

export const resolveReport = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Report not found');
  const status = str(req.body?.status);
  if (!['resolved', 'dismissed'].includes(status)) throw badRequest('Resolve or dismiss.');
  const r = await Report.findByIdAndUpdate(req.params.id, { status, resolution: cleanText(req.body?.resolution, 500), resolvedBy: req.userId }, { new: true });
  if (!r) throw notFound('Report not found');
  await audit(req, 'admin.report-resolve', 'report', r._id, { status, resolution: r.resolution });
  res.json(r);
});

/* ---------------- AI jobs, integrations, analytics, audit ---------------- */

export const analysisJobs = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 25 });
  const filter = ['ok', 'partial', 'failed'].includes(str(req.query.status)) ? { status: str(req.query.status) } : {};
  const [items, total, byStatus] = await Promise.all([
    AnalysisReport.find(filter).select('property status error durationMs updatedAt report.overall report.narrative.source report.nearby.status').populate('property', 'title slug').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    AnalysisReport.countDocuments(filter),
    AnalysisReport.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit), byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])) });
});

export const rerunAnalysis = wrap(async (req, res) => {
  if (!isId(req.params.propertyId)) throw notFound('Property not found');
  const p = await Property.findById(req.params.propertyId);
  if (!p) throw notFound('Property not found');
  const report = await buildReport(p, { refresh: true });
  await audit(req, 'admin.analysis-rerun', 'property', p._id);
  res.json({ ok: true, overall: report.overall, nearby: report.nearby.status });
});

export const integrations = wrap(async (req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await IntegrationEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$service', total: { $sum: 1 }, failures: { $sum: { $cond: ['$ok', 0, 1] } }, avgLatency: { $avg: '$latencyMs' }, last: { $first: '$$ROOT' } } },
  ]);
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
  res.json({
    configured: {
      database: { status: dbState },
      llm: { enabled: llmEnabled(), provider: llmEnabled() ? llmProvider() : null, note: llmEnabled() ? '' : 'AI_API_KEY not set — rule-based analysis and chat are used.' },
      places: { provider: providerName(), note: providerName() === 'google' && !process.env.GOOGLE_MAPS_API_KEY ? 'GOOGLE_MAPS_API_KEY missing' : '' },
      routing: { enabled: routingEnabled(), note: routingEnabled() ? '' : 'No routing provider — only straight-line distances are shown.' },
      geocoding: { provider: process.env.GEOCODER || 'nominatim' },
      email: { enabled: false, note: 'No email transport configured; password-reset links are shown only outside production.' },
      sms: { enabled: false, note: 'No SMS gateway configured; OTP codes are shown only outside production.' },
      rera: { automated: false, note: 'No official RERA feeds configured; verification is manual against state portals.' },
    },
    last24h: rows.map((r) => ({ service: r._id, total: r.total, failures: r.failures, avgLatencyMs: Math.round(r.avgLatency || 0), lastMessage: r.last.message, lastAt: r.last.createdAt, lastOk: r.last.ok })),
  });
});

export const searchAnalytics = wrap(async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const match = { $match: { createdAt: { $gte: since } } };
  const [byCity, byType, byFilter, zeroResults, byDay] = await Promise.all([
    SearchEvent.aggregate([match, { $match: { city: { $ne: '' } } }, { $group: { _id: { $toLower: '$city' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
    SearchEvent.aggregate([match, { $group: { _id: '$listingType', n: { $sum: 1 } } }]),
    SearchEvent.aggregate([match, { $unwind: '$filters' }, { $group: { _id: '$filters', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }]),
    SearchEvent.countDocuments({ createdAt: { $gte: since }, results: 0 }),
    SearchEvent.aggregate([match, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  res.json({ byCity, byType, byFilter, zeroResults, byDay, note: 'Aggregated filter usage only; no user identifiers or free-text queries are stored.' });
});

export const auditLogs = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 50, maxLimit: 200 });
  const filter = {};
  if (req.query.action) filter.action = new RegExp(`^${escapeRegex(str(req.query.action))}`);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).populate('actor', 'name email role').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

export const messages = wrap(async (req, res) => {
  res.json({ items: await ContactMessage.find({ status: str(req.query.status) || 'open' }).sort({ createdAt: -1 }).limit(100).lean() });
});

export const closeMessage = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Message not found');
  await ContactMessage.updateOne({ _id: req.params.id }, { status: 'closed' });
  res.json({ ok: true });
});

export const projects = wrap(async (req, res) => {
  res.json({ items: await Project.find().select('name slug city status rera developerName isDemo createdAt').sort({ createdAt: -1 }).limit(200).lean() });
});
