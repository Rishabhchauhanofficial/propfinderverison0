import Property from '../models/Property.js';
import { Project, Developer, ReraRecord, Review } from '../models/index.js';
import { CARD_PROJECTION, toCard } from '../services/searchService.js';
import { summarize as reraSummary, stateCodeFor, authorityFor } from '../services/reraService.js';
import { slugify } from '../utils/slug.js';
import { assignLocation } from '../services/locationService.js';
import { audit, badRequest, cleanText, escapeRegex, forbidden, isId, notFound, paging, str, toNum, wrap } from '../utils/http.js';

const STATUSES = ['pre-launch', 'under-construction', 'ready', 'completed'];

export const list = wrap(async (req, res) => {
  const { page, limit, skip } = paging(req.query, { defLimit: 12 });
  const filter = {};
  if (req.query.city) filter.city = new RegExp(`^${escapeRegex(str(req.query.city))}$`, 'i');
  if (STATUSES.includes(str(req.query.status))) filter.status = str(req.query.status);
  if (str(req.query.reraVerified) === '1') filter['rera.status'] = 'verified';
  if (req.query.q) filter.$or = [{ name: new RegExp(escapeRegex(str(req.query.q)), 'i') }, { developerName: new RegExp(escapeRegex(str(req.query.q)), 'i') }, { locality: new RegExp(escapeRegex(str(req.query.q)), 'i') }];
  const [items, total] = await Promise.all([Project.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(), Project.countDocuments(filter)]);
  const counts = await Property.aggregate([{ $match: { project: { $in: items.map((p) => p._id) }, status: 'active' } }, { $group: { _id: '$project', n: { $sum: 1 } } }]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json({ items: items.map((p) => ({ ...p, id: String(p._id), listings: byId[String(p._id)] || 0 })), total, page, pages: Math.ceil(total / limit) });
});

export const getOne = wrap(async (req, res) => {
  const key = req.params.slug;
  const project = await Project.findOne(isId(key) ? { _id: key } : { slug: key }).populate('developer').lean();
  if (!project) throw notFound('Project not found');
  const [listings, record, ratings, otherProjects] = await Promise.all([
    Property.find({ project: project._id, status: 'active' }).select(CARD_PROJECTION).populate('owner', 'name role company').limit(24).lean(),
    ReraRecord.findOne({ project: project._id, property: null }).lean(),
    Review.find({ targetKey: String(project._id), status: 'published' }).select('ratings.overall').lean(),
    project.developer ? Project.find({ developer: project.developer._id, _id: { $ne: project._id } }).select('name slug city locality status').limit(6).lean() : [],
  ]);
  const code = stateCodeFor({ state: project.state || project.rera?.state, city: project.city });
  const rera = reraSummary({ property: { ...project, constructionStatus: project.status === 'ready' || project.status === 'completed' ? 'ready' : 'under-construction', project: project._id, listingType: 'sale', rera: project.rera, city: project.city, state: code }, record });
  res.json({
    project: { ...project, id: String(project._id) },
    developer: project.developer
      ? {
          name: project.developer.name,
          website: project.developer.website,
          description: project.developer.description,
          descriptionIsClaim: true,
          foundedYear: project.developer.foundedYear,
          otherProjects,
        }
      : null,
    listings: listings.map(toCard),
    rera,
    ratingSummary: { count: ratings.length, avg: ratings.length ? Math.round((ratings.reduce((a, r) => a + (r.ratings?.overall || 0), 0) / ratings.length) * 10) / 10 : null },
  });
});

function pickProject(b = {}) {
  const date = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    name: cleanText(b.name, 160),
    city: cleanText(b.city, 60),
    locality: cleanText(b.locality, 100),
    state: cleanText(b.state, 40),
    description: cleanText(b.description, 5000),
    status: STATUSES.includes(b.status) ? b.status : 'under-construction',
    launchDate: date(b.launchDate),
    possessionDate: date(b.possessionDate),
    totalUnits: toNum(b.totalUnits),
    landAreaSqm: toNum(b.landAreaSqm),
    configurations: (Array.isArray(b.configurations) ? b.configurations : []).map((c) => cleanText(c, 30)).filter(Boolean).slice(0, 10),
    priceFrom: toNum(b.priceFrom),
    priceTo: toNum(b.priceTo),
    amenities: (Array.isArray(b.amenities) ? b.amenities : []).map((a) => cleanText(a, 60)).filter(Boolean).slice(0, 40),
    images: (Array.isArray(b.images) ? b.images : []).filter((u) => /^(https:\/\/|\/uploads\/)/.test(u)).slice(0, 20),
    location: { lat: toNum(b.location?.lat), lng: toNum(b.location?.lng) },
  };
}

async function syncProjectRera(project, b, req) {
  const number = cleanText(b.rera?.number, 80).toUpperCase();
  if (!number) {
    project.rera = { number: '', state: '', status: b.rera?.notApplicable ? 'not-applicable' : 'not-provided' };
    return;
  }
  if (project.rera?.number === number) return;
  const state = stateCodeFor({ state: b.rera?.state || project.state, city: project.city }) || '';
  const authority = authorityFor(state);
  project.rera = { number, state, status: 'not-verified' };
  await ReraRecord.findOneAndUpdate(
    { project: project._id, property: null },
    {
      project: project._id,
      property: null,
      registrationNumber: number,
      state: state || 'unknown',
      authority: authority?.authority || '',
      officialUrl: authority?.url || '',
      status: 'not-verified',
      method: 'not-checked',
      submitted: { projectName: project.name, promoterName: project.developerName, possessionDate: project.possessionDate },
      $push: { history: { status: 'not-verified', note: 'Submitted by builder.', by: req.userId } },
    },
    { upsert: true }
  );
}

export const create = wrap(async (req, res) => {
  if (!['builder', 'admin'].includes(req.role)) throw forbidden('Only builder accounts can add projects.');
  const data = pickProject(req.body);
  if (!data.name || !data.city || !data.locality) throw badRequest('Project name, city and locality are required.');
  let developer = null;
  const devName = cleanText(req.body?.developerName || req.user.company, 160);
  if (devName) {
    developer = await Developer.findOneAndUpdate({ name: devName }, { $setOnInsert: { name: devName, account: req.role === 'builder' ? req.userId : null } }, { upsert: true, new: true });
    if (developer.account && String(developer.account) !== req.userId && req.role !== 'admin') throw forbidden('This developer is managed by another account.');
  }
  const project = new Project({ ...data, slug: `${slugify(`${data.name} ${data.locality} ${data.city}`)}-${Date.now().toString(36).slice(-4)}`, developer: developer?._id || null, developerName: devName, createdBy: req.userId });
  await syncProjectRera(project, req.body || {}, req);
  await assignLocation(project, { force: true });
  await project.save();
  await audit(req, 'project.create', 'project', project._id);
  res.status(201).json(project);
});

export const update = wrap(async (req, res) => {
  if (!isId(req.params.slug)) throw notFound('Project not found');
  const project = await Project.findById(req.params.slug);
  if (!project) throw notFound('Project not found');
  if (String(project.createdBy) !== req.userId && req.role !== 'admin') throw forbidden('Not your project');
  const data = pickProject({ ...project.toObject(), ...req.body });
  project.set(data);
  await syncProjectRera(project, req.body || {}, req);
  await assignLocation(project);
  await project.save();
  await audit(req, 'project.update', 'project', project._id);
  res.json(project);
});

export const mine = wrap(async (req, res) => {
  res.json({ items: await Project.find({ createdBy: req.userId }).sort({ updatedAt: -1 }).lean() });
});
