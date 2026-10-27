/*
 * Server-side property search used by the search API and the chat assistant.
 * All filtering, sorting and pagination happen in MongoDB.
 */
import mongoose from 'mongoose';
import Property, { COMMERCIAL_TYPES, PROPERTY_TYPES } from '../models/Property.js';
import { escapeRegex, str, toNum } from '../utils/http.js';
import { isValidCoords } from '../utils/geo.js';
import { breadcrumb, findBySlug, resolveLocation, searchLocations } from './locationService.js';

const PUBLIC_STATUSES = ['active', 'sold', 'rented'];
const ci = (v) => new RegExp(`^${escapeRegex(String(v).trim())}$`, 'i');
const list = (v) =>
  str(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const SORTS = {
  relevance: { _relevance: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  price_asc: { price: 1 },
  price_desc: { price: -1 },
  ppsf_asc: { _ppsf: 1 },
  ppsf_desc: { _ppsf: -1 },
  area_desc: { areaSqft: -1 },
  area_asc: { areaSqft: 1 },
};

// Public card fields. Never include owner phone/email here.
export const CARD_PROJECTION = {
  title: 1, slug: 1, listingType: 1, propertyType: 1, status: 1, price: 1, areaSqft: 1, carpetAreaSqft: 1,
  bedrooms: 1, bathrooms: 1, furnishing: 1, city: 1, locality: 1, pinCode: 1, location: 1, amenities: 1,
  images: 1, owner: 1, postedByRole: 1, createdAt: 1, updatedAt: 1, constructionStatus: 1, possessionDate: 1,
  developerName: 1, project: 1, rera: 1, listingVerified: 1, isDemo: 1, views: 1, ageYears: 1, nearbySummary: 1,
  floor: 1, totalFloors: 1, maintenanceMonthly: 1,
};

export function parseNear(near) {
  if (!near) return null;
  const [lat, lng] = str(near).split(',').map((s) => Number(s.trim()));
  const point = { lat, lng };
  return isValidCoords(point) ? point : null;
}

/** Build the Mongo filter from query params. Unknown params are ignored. */
/**
 * Resolve the search's place (?location=<slug>, or ?city= + ?locality=) onto the location tree.
 * Returns { node, localMatched } or null when the place is not in the tree.
 */
export async function locationScope(q = {}) {
  if (q.location) {
    const { node } = await findBySlug(str(q.location));
    return node ? { node, localMatched: true } : null;
  }
  if (!q.city) return null;
  const res = await resolveLocation({ city: str(q.city), locality: str(q.locality), state: str(q.state) });
  if (!res.city) return null;
  return { node: res.locality || res.city, localMatched: !q.locality || !!res.locality };
}

export function buildFilter(q = {}, { scope = null } = {}) {
  const and = [];
  const filter = {};

  const status = str(q.status || 'active');
  filter.status = PUBLIC_STATUSES.includes(status) ? status : 'active';

  if (q.listingType && ['sale', 'rent'].includes(str(q.listingType))) filter.listingType = str(q.listingType);

  const types = list(q.propertyType).filter((t) => PROPERTY_TYPES.includes(t));
  if (str(q.commercial) === '1') filter.propertyType = { $in: types.length ? types.filter((t) => COMMERCIAL_TYPES.includes(t)) : COMMERCIAL_TYPES };
  else if (types.length === 1) filter.propertyType = types[0];
  else if (types.length > 1) filter.propertyType = { $in: types };

  if (scope?.node) {
    // Everything at or below the matched place (Delhi includes Rohini), plus listings not yet
    // attached to the tree whose typed address matches.
    const id = scope.node._id;
    const typed = q.city ? { locationId: null, city: ci(str(q.city)), ...(q.locality ? { locality: ci(str(q.locality)) } : {}) } : null;
    and.push({ $or: [{ locationId: id }, { ancestors: id }, ...(typed ? [typed] : [])] });
    if (q.locality && !scope.localMatched) filter.locality = ci(str(q.locality));
  } else {
    if (q.city) filter.city = ci(str(q.city));
    if (q.locality) filter.locality = ci(str(q.locality));
  }
  if (q.pinCode) filter.pinCode = str(q.pinCode).replace(/\D/g, '').slice(0, 6);
  if (q.developer) filter.developerName = new RegExp(escapeRegex(str(q.developer).trim()), 'i');
  if (q.project && mongoose.isValidObjectId(str(q.project))) filter.project = new mongoose.Types.ObjectId(str(q.project));

  const range = (field, min, max) => {
    const lo = toNum(min);
    const hi = toNum(max);
    if (lo === null && hi === null) return;
    filter[field] = { ...(lo !== null ? { $gte: lo } : {}), ...(hi !== null ? { $lte: hi } : {}) };
  };
  range('price', q.minPrice, q.maxPrice);

  const areaField = { carpet: 'carpetAreaSqft', plot: 'plotAreaSqft' }[str(q.areaType)] || 'areaSqft';
  range(areaField, q.minArea, q.maxArea);

  // Bedrooms: "3" = 3 or more (legacy behaviour), "2,3" = exactly 2 or 3.
  const beds = list(q.bedrooms).map(Number).filter(Number.isFinite);
  if (beds.length === 1) filter.bedrooms = { $gte: beds[0] };
  else if (beds.length > 1) filter.bedrooms = { $in: beds };

  const baths = toNum(q.bathrooms);
  if (baths !== null) filter.bathrooms = { $gte: baths };

  const furnishing = list(q.furnishing).filter((f) => ['unfurnished', 'semi-furnished', 'furnished'].includes(f));
  if (furnishing.length) filter.furnishing = { $in: furnishing };

  const maxAge = toNum(q.maxAge);
  if (maxAge !== null) filter.ageYears = { $lte: maxAge };

  if (['ready', 'under-construction'].includes(str(q.constructionStatus))) filter.constructionStatus = str(q.constructionStatus);
  if (q.possessionBy) {
    const d = new Date(str(q.possessionBy));
    if (!Number.isNaN(d.getTime())) and.push({ $or: [{ constructionStatus: 'ready' }, { possessionDate: { $lte: d } }] });
  }

  if (str(q.reraVerified) === '1') filter['rera.status'] = 'verified';
  if (str(q.verified) === '1') filter.listingVerified = true;
  if (['owner', 'agent', 'builder'].includes(str(q.postedBy))) filter.postedByRole = str(q.postedBy);
  if (str(q.excludeDemo) === '1') filter.isDemo = { $ne: true };

  const amenities = list(q.amenities);
  if (amenities.length) filter.amenities = { $all: amenities.map((a) => ci(a)) };

  // Nearby-facility filters use the denormalised summary (only listings whose locality data was fetched).
  for (const [param, key] of [['nearMetroKm', 'metro'], ['nearSchoolKm', 'school'], ['nearHospitalKm', 'hospital']]) {
    const km = toNum(q[param]);
    if (km !== null) filter[`nearbySummary.${key}`] = { $ne: null, $lte: km };
  }

  // Price per sq ft (sale listings only).
  const minPpsf = toNum(q.minPpsf);
  const maxPpsf = toNum(q.maxPpsf);
  if (minPpsf !== null || maxPpsf !== null) {
    const expr = { $divide: ['$price', '$areaSqft'] };
    if (minPpsf !== null) and.push({ $expr: { $gte: [expr, minPpsf] } });
    if (maxPpsf !== null) and.push({ $expr: { $lte: [expr, maxPpsf] } });
  }

  const keyword = str(q.q || '').trim().slice(0, 80);
  if (keyword) {
    const rx = new RegExp(escapeRegex(keyword), 'i');
    and.push({ $or: [{ title: rx }, { locality: rx }, { city: rx }, { pinCode: rx }, { developerName: rx }, { address: rx }] });
  }

  if (and.length) filter.$and = and;
  return { filter, keyword };
}

function relevanceStage(keyword) {
  if (!keyword) return { $addFields: { _relevance: 0 } };
  const rx = escapeRegex(keyword);
  const hit = (field, w) => ({ $cond: [{ $regexMatch: { input: { $ifNull: [`$${field}`, ''] }, regex: rx, options: 'i' } }, w, 0] });
  return { $addFields: { _relevance: { $add: [hit('locality', 4), hit('title', 3), hit('city', 2), hit('developerName', 2), hit('pinCode', 3), hit('address', 1)] } } };
}

async function computeFacets(match) {
  const [result] = await Property.aggregate([
    { $match: match },
    {
      $facet: {
        cities: [
          { $group: { _id: '$city', count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 40 },
          { $project: { _id: 0, city: '$_id', count: 1 } },
        ],
        propertyTypes: [
          { $group: { _id: '$propertyType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $project: { _id: 0, value: '$_id', count: 1 } },
        ],
        localities: [
          { $group: { _id: '$locality', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
          { $project: { _id: 0, locality: '$_id', count: 1 } },
        ],
        priceRange: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }],
      },
    },
  ]);
  return {
    cities: result?.cities || [],
    propertyTypes: result?.propertyTypes || [],
    localities: result?.localities || [],
    priceRange: result?.priceRange?.[0] ? { min: result.priceRange[0].min, max: result.priceRange[0].max } : null,
  };
}

/** Full search. Returns { items, total, page, pages, facets }. */
export async function search(q = {}, { withFacets = true } = {}) {
  const scope = await locationScope(q);
  const { filter, keyword } = buildFilter(q, { scope });
  const page = Math.max(1, parseInt(str(q.page), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(str(q.limit), 10) || 12));
  const near = parseNear(q.near);
  const sortKey = str(q.sort) || (keyword ? 'relevance' : 'newest');
  let sort = SORTS[sortKey] || SORTS.newest;

  const pipeline = [];
  if (near) {
    const radiusKm = Math.min(100, Math.max(0.1, Number(q.radiusKm) || 10));
    pipeline.push({
      $geoNear: {
        near: { type: 'Point', coordinates: [near.lng, near.lat] },
        distanceField: '_distanceM',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: filter,
      },
    });
    if (!q.sort) sort = { _distanceM: 1 };
  } else {
    pipeline.push({ $match: filter });
  }
  pipeline.push(relevanceStage(keyword));
  pipeline.push({ $addFields: { _ppsf: { $cond: [{ $gt: ['$areaSqft', 0] }, { $divide: ['$price', '$areaSqft'] }, null] } } });
  pipeline.push({ $sort: { ...sort, _id: 1 } });
  pipeline.push({
    $facet: {
      items: [
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { ...CARD_PROJECTION, _distanceM: 1, _relevance: 1 } },
        { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'owner', pipeline: [{ $project: { name: 1, role: 1, company: 1 } }] } },
        { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
      ],
      total: [{ $count: 'n' }],
      ...(near ? { ids: [{ $project: { _id: 1 } }] } : {}),
    },
  });

  const [res] = await Property.aggregate(pipeline);
  const total = res.total[0]?.n || 0;
  const items = res.items.map(toCard);

  let facets = null;
  if (withFacets) facets = await computeFacets(near ? { _id: { $in: res.ids.map((d) => d._id) } } : filter);

  return { items, total, page, pages: Math.ceil(total / limit), facets, sort: near && !q.sort ? 'distance' : sortKey };
}

/** Normalise a lean/aggregated property into the public card shape. */
export function toCard(d) {
  const out = { ...d, id: String(d._id) };
  out.pricePerSqft = d.listingType === 'sale' && d.areaSqft > 0 ? Math.round(d.price / d.areaSqft) : null;
  if (d._distanceM != null) out.distanceKm = Math.round(d._distanceM / 100) / 10;
  if (out.owner && typeof out.owner === 'object') {
    out.owner = { _id: out.owner._id, name: out.owner.name, role: out.owner.role === 'user' ? 'owner' : out.owner.role, company: out.owner.company || '' };
  }
  delete out._distanceM;
  delete out._relevance;
  delete out._ppsf;
  return out;
}

/** Autocomplete suggestions across cities, localities, PIN codes, projects and developers. */
export async function suggest(term) {
  const t = String(term || '').trim().slice(0, 40);
  if (t.length < 2) return [];
  const rx = new RegExp(`^${escapeRegex(t)}|\\s${escapeRegex(t)}`, 'i');
  const [rows] = await Property.aggregate([
    { $match: { status: 'active' } },
    {
      $facet: {
        localities: [
          { $match: { $or: [{ locality: rx }, { city: rx }] } },
          { $group: { _id: { city: '$city', locality: '$locality' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 6 },
        ],
        cities: [{ $match: { city: rx } }, { $group: { _id: '$city', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 3 }],
        pins: [{ $match: { pinCode: new RegExp(`^${escapeRegex(t)}`) } }, { $group: { _id: { pin: '$pinCode', city: '$city' }, count: { $sum: 1 } } }, { $limit: 3 }],
        developers: [{ $match: { developerName: rx } }, { $group: { _id: '$developerName', count: { $sum: 1 } } }, { $limit: 3 }],
      },
    },
  ]);
  const { Project } = await import('../models/index.js');
  const projects = await Project.find({ name: rx }).select('name slug city locality').limit(4).lean();
  // Places from the location tree, so aliases work ('Gurgaon' → Gurugram) even before a listing uses that spelling.
  const seen = new Set([...rows.cities.map((c) => c._id), ...rows.localities.map((l) => l._id.locality)].map((n) => n.toLowerCase()));
  const places = [];
  for (const node of await searchLocations(t, { limit: 5 })) {
    if (node.type === 'country' || seen.has(node.name.toLowerCase())) continue;
    seen.add(node.name.toLowerCase());
    const crumbs = (await breadcrumb(node)).filter((c) => c.type !== 'country');
    const parents = crumbs.slice(0, -1).reverse();
    const cityCrumb = parents.find((c) => ['city', 'town', 'district', 'state'].includes(c.type));
    const local = ['locality', 'village'].includes(node.type);
    places.push({
      type: local ? 'locality' : 'city',
      label: node.name,
      sub: [node.type[0].toUpperCase() + node.type.slice(1), parents.map((c) => c.name).join(', ')].filter(Boolean).join(' · '),
      params: local && cityCrumb ? { city: cityCrumb.name, locality: node.name } : { city: node.name },
    });
  }
  return [
    ...rows.cities.map((c) => ({ type: 'city', label: c._id, sub: `${c.count} listings`, params: { city: c._id } })),
    ...rows.localities.map((l) => ({ type: 'locality', label: l._id.locality, sub: `${l._id.city} · ${l.count} listings`, params: { city: l._id.city, locality: l._id.locality } })),
    ...places,
    ...rows.pins.filter((p) => p._id.pin).map((p) => ({ type: 'pin', label: p._id.pin, sub: p._id.city, params: { pinCode: p._id.pin } })),
    ...projects.map((p) => ({ type: 'project', label: p.name, sub: `${p.locality}, ${p.city}`, href: `/projects/${p.slug}` })),
    ...rows.developers.map((d) => ({ type: 'developer', label: d._id, sub: 'Developer', params: { developer: d._id } })),
  ].slice(0, 12);
}
