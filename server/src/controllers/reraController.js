import Property from '../models/Property.js';
import { ReraRecord } from '../models/index.js';
import {
  RERA_AUTHORITIES,
  STATUS_LABELS,
  DUE_DILIGENCE_CHECKLIST,
  RERA_SCOPE_DISCLAIMER,
  authorityFor,
  checkOfficial,
  computeDiscrepancies,
  summarize,
} from '../services/reraService.js';
import { notify } from '../services/notificationService.js';
import { audit, badRequest, cleanText, forbidden, isId, notFound, paging, str, wrap } from '../utils/http.js';

const REVIEW_STATUSES = ['verified', 'found-needs-review', 'not-verified', 'mismatch', 'not-found', 'not-applicable'];

export const authorities = wrap(async (req, res) => {
  res.json({
    authorities: Object.entries(RERA_AUTHORITIES).map(([code, a]) => ({ code, ...a })),
    statuses: STATUS_LABELS,
    checklist: DUE_DILIGENCE_CHECKLIST,
    disclaimer: RERA_SCOPE_DISCLAIMER,
  });
});

async function loadProperty(id) {
  if (!isId(id)) throw notFound('Property not found');
  const p = await Property.findById(id);
  if (!p) throw notFound('Property not found');
  return p;
}

// GET /api/rera/properties/:id — public summary.
export const forProperty = wrap(async (req, res) => {
  const p = await loadProperty(req.params.id);
  const record = await ReraRecord.findOne({ property: p._id }).lean();
  const summary = summarize({ property: p.toObject(), record });
  // Evidence files are private; expose only the count publicly.
  const isOwner = req.userId && String(p.owner) === req.userId;
  if (isOwner || req.role === 'admin') summary.evidence = record?.evidence || [];
  res.json(summary);
});

// POST /api/rera/properties/:id/evidence  { files: [{url,name,mime}] }  — lister uploads the certificate.
export const addEvidence = wrap(async (req, res) => {
  const p = await loadProperty(req.params.id);
  if (String(p.owner) !== req.userId && req.role !== 'admin') throw forbidden('Not your listing');
  const record = await ReraRecord.findOne({ property: p._id });
  if (!record) throw badRequest('Add a RERA registration number to the listing first.');
  const files = (Array.isArray(req.body?.files) ? req.body.files : []).filter((f) => /^\/api\/files\/[\w-]+\.\w+$/.test(f?.url)).slice(0, 5);
  if (!files.length) throw badRequest('Upload at least one document.');
  for (const f of files) record.evidence.push({ url: f.url, name: cleanText(f.name, 100), mime: cleanText(f.mime, 60), uploadedBy: req.userId });
  if (record.status === 'not-verified') record.statusNote = 'Evidence uploaded — awaiting review.';
  await record.save();
  await audit(req, 'rera.evidence', 'rera', record._id, { files: files.length });
  res.status(201).json({ ok: true, evidenceCount: record.evidence.length });
});

/* ---------------- admin ---------------- */

export const queue = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 20 });
  const status = str(req.query.status);
  const filter = REVIEW_STATUSES.includes(status) ? { status } : { status: { $in: ['not-verified', 'found-needs-review'] } };
  const [items, total] = await Promise.all([
    ReraRecord.find(filter)
      .populate('property', 'title slug city locality developerName possessionDate owner isDemo')
      .sort({ updatedAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ReraRecord.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) });
});

// POST /api/admin/rera/:recordId/check — try an official adapter, if one exists.
export const runCheck = wrap(async (req, res) => {
  if (!isId(req.params.recordId)) throw notFound('Record not found');
  const record = await ReraRecord.findById(req.params.recordId);
  if (!record) throw notFound('Record not found');
  const result = await checkOfficial(record.state, record.registrationNumber).catch((err) => ({ available: true, error: err.message }));
  if (!result.available) {
    const a = authorityFor(record.state);
    return res.json({
      available: false,
      message: `No automated official feed is configured for ${a?.state || record.state}. Verify manually on ${a?.url || 'the state RERA portal'} and record the result.`,
      officialUrl: a?.url || '',
    });
  }
  if (result.error) return res.status(502).json({ available: true, error: `Official source check failed: ${result.error}` });
  res.json(result);
});

// PUT /api/admin/rera/:recordId  { status, official: {...}, statusNote }
export const review = wrap(async (req, res) => {
  if (!isId(req.params.recordId)) throw notFound('Record not found');
  const record = await ReraRecord.findById(req.params.recordId);
  if (!record) throw notFound('Record not found');
  const b = req.body || {};
  if (!REVIEW_STATUSES.includes(b.status)) throw badRequest('Choose a verification status.');

  const o = b.official || {};
  const date = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  record.official = {
    projectName: cleanText(o.projectName, 200),
    promoterName: cleanText(o.promoterName, 200),
    registrationStatus: cleanText(o.registrationStatus, 80),
    registeredOn: date(o.registeredOn),
    validUntil: date(o.validUntil),
    declaredCompletion: date(o.declaredCompletion),
    sourceUrl: /^https:\/\//i.test(o.sourceUrl || '') ? String(o.sourceUrl).slice(0, 500) : record.official?.sourceUrl || '',
  };
  record.discrepancies = computeDiscrepancies(record.submitted, record.official);

  let status = b.status;
  // A "verified" decision needs evidence from the official record and no unresolved discrepancies.
  if (status === 'verified') {
    if (!record.official.sourceUrl) throw badRequest('Add the official record URL you checked before marking as verified.');
    if (!record.official.projectName || !record.official.promoterName) throw badRequest('Enter the project and promoter names exactly as shown on the official record.');
    if (record.discrepancies.length && !b.overrideDiscrepancies) status = 'mismatch';
  }
  if (status === 'not-applicable' && !cleanText(b.statusNote, 10)) throw badRequest('Explain why RERA registration is not applicable.');

  record.status = status;
  record.statusNote = cleanText(b.statusNote, 1000);
  record.method = 'manual-review';
  record.lastVerifiedAt = new Date();
  record.verifiedBy = req.userId;
  record.history.push({ status, note: record.statusNote || STATUS_LABELS[status], by: req.userId });
  await record.save();

  if (record.property) {
    const p = await Property.findByIdAndUpdate(record.property, { $set: { 'rera.status': status } }, { new: true });
    if (p) {
      await notify(p.owner, {
        type: 'rera',
        title: `RERA review: ${STATUS_LABELS[status]}`,
        body: `${p.title}${record.discrepancies.length ? ` — ${record.discrepancies[0]}` : ''}`,
        link: `/property/${p.slug || p._id}#rera`,
      });
    }
  }
  await audit(req, 'rera.review', 'rera', record._id, { status, discrepancies: record.discrepancies.length });
  res.json(record);
});
