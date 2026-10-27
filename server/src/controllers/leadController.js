import mongoose from 'mongoose';
import Property from '../models/Property.js';
import { Lead, SiteVisit, LEAD_STATUSES } from '../models/index.js';
import { notify } from '../services/notificationService.js';
import { audit, badRequest, cleanText, forbidden, isId, notFound, paging, str, wrap } from '../utils/http.js';

/* ---------------- leads (listing owner's view) ---------------- */

// Listers only ever see leads on their own listings; admins see all.
const scope = (req) => (req.role === 'admin' && str(req.query.all) === '1' ? {} : { listingOwner: req.userId });

export const listLeads = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 25, maxLimit: 100 });
  const filter = { ...scope(req) };
  if (LEAD_STATUSES.includes(str(req.query.status))) filter.status = str(req.query.status);
  if (isId(req.query.property)) filter.property = req.query.property;
  const [items, total, byStatus] = await Promise.all([
    Lead.find(filter).populate('property', 'title slug price listingType city locality').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Lead.countDocuments(filter),
    Lead.aggregate([
      { $match: scope(req).listingOwner ? { listingOwner: new mongoose.Types.ObjectId(req.userId) } : {} },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit), byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])) });
});

async function ownLead(req) {
  if (!isId(req.params.id)) throw notFound('Lead not found');
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw notFound('Lead not found');
  if (String(lead.listingOwner) !== req.userId && req.role !== 'admin') throw forbidden('This lead belongs to another lister.');
  return lead;
}

export const updateLead = wrap(async (req, res) => {
  const lead = await ownLead(req);
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!LEAD_STATUSES.includes(b.status)) throw badRequest('Invalid lead status');
    lead.status = b.status;
  }
  if (b.note) lead.notes.push({ body: cleanText(b.note, 1000) });
  if (b.followUpAt !== undefined) {
    const d = b.followUpAt ? new Date(b.followUpAt) : null;
    lead.followUpAt = d && !Number.isNaN(d.getTime()) ? d : null;
  }
  await lead.save();
  res.json(lead);
});

/* ---------------- site visits ---------------- */

export const requestVisit = wrap(async (req, res) => {
  const b = req.body || {};
  if (!isId(b.propertyId)) throw notFound('Property not found');
  const property = await Property.findById(b.propertyId).select('owner title status slug');
  if (!property || property.status !== 'active') throw notFound('Property not found');
  if (String(property.owner) === req.userId) throw badRequest('This is your own listing.');
  const when = new Date(b.scheduledAt);
  if (Number.isNaN(when.getTime()) || when < new Date(Date.now() + 30 * 60000)) throw badRequest('Pick a date and time at least 30 minutes from now.');
  if (when > new Date(Date.now() + 90 * 86400000)) throw badRequest('Pick a date within the next 90 days.');

  let lead = await Lead.findOne({ property: property._id, buyer: req.userId, status: { $nin: ['won', 'lost'] } });
  if (!lead) {
    lead = await Lead.create({
      property: property._id,
      listingOwner: property.owner,
      buyer: req.userId,
      name: req.user.name,
      phone: cleanText(b.phone, 30) || req.user.phone || '',
      message: cleanText(b.note, 1000),
      source: 'site-visit',
      status: 'site-visit',
    });
    await Property.updateOne({ _id: property._id }, { $inc: { leadsCount: 1 } }, { timestamps: false });
  } else if (['new', 'contacted', 'qualified'].includes(lead.status)) {
    lead.status = 'site-visit';
    await lead.save();
  }

  const visit = await SiteVisit.create({
    property: property._id,
    lead: lead._id,
    requester: req.userId,
    listingOwner: property.owner,
    scheduledAt: when,
    note: cleanText(b.note, 1000),
  });
  await notify(property.owner, {
    type: 'site-visit',
    title: `Site visit requested: ${property.title}`,
    body: `${req.user.name} proposed ${when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}.`,
    link: '/dashboard?tab=visits',
  });
  res.status(201).json({ visit, message: 'Visit requested. The lister will confirm or suggest another time.' });
});

export const listVisits = wrap(async (req, res) => {
  const role = str(req.query.as) === 'requester' ? { requester: req.userId } : { listingOwner: req.userId };
  const items = await SiteVisit.find(role)
    .populate('property', 'title slug city locality')
    .populate('requester', 'name phone')
    .sort({ scheduledAt: 1 })
    .limit(100)
    .lean();
  // Requesters never see the lister's private notes; listers see requester name/phone only for their visits.
  res.json({ items });
});

export const updateVisit = wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound('Visit not found');
  const visit = await SiteVisit.findById(req.params.id).populate('property', 'title slug');
  if (!visit) throw notFound('Visit not found');
  const isLister = String(visit.listingOwner) === req.userId;
  const isRequester = String(visit.requester) === req.userId;
  if (!isLister && !isRequester && req.role !== 'admin') throw forbidden();
  const status = str(req.body?.status);
  const allowed = isLister || req.role === 'admin' ? ['confirmed', 'completed', 'cancelled'] : ['cancelled'];
  if (!allowed.includes(status)) throw badRequest('You cannot set that status.');
  if (req.body?.scheduledAt && (isLister || req.role === 'admin')) {
    const d = new Date(req.body.scheduledAt);
    if (!Number.isNaN(d.getTime())) visit.scheduledAt = d;
  }
  visit.status = status;
  await visit.save();
  const other = isLister ? visit.requester : visit.listingOwner;
  await notify(other, {
    type: 'site-visit',
    title: `Site visit ${status}: ${visit.property?.title || ''}`,
    body: visit.scheduledAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }),
    link: isLister ? '/saved?tab=enquiries' : '/dashboard?tab=visits',
  });
  await audit(req, 'visit.update', 'visit', visit._id, { status });
  res.json(visit);
});
