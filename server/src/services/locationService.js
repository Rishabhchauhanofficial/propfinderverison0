/*
 * Location tree: resolving free-text city/locality onto Location nodes, attaching listings to
 * the tree, breadcrumbs, and loading the shipped seed tree.
 */
import mongoose from 'mongoose';
import Location from '../models/Location.js';
import { slugify } from '../utils/slug.js';
import { isValidCoords } from '../utils/geo.js';
import { LOCATION_SEED } from '../data/locations.seed.js';

const TYPE_RANK = { city: 6, town: 5, district: 4, state: 3, locality: 2, village: 1, country: 0 };
const CITY_LEVEL = ['city', 'town', 'district', 'state'];
const LOCAL_LEVEL = ['locality', 'village', 'town', 'city'];
// Typed text is matched against a city when the coordinates fall this close to it and the name is unknown.
const NEAREST_CITY_KM = 25;

/** "Sector-62 ", "sector 62" and "SECTOR 62" all become "sector 62". */
export function normalizeName(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Typos allowed for a name of this length: none for short names, so "Agra" never matches "Ara". */
export function fuzzyBudget(key) {
  if (key.length >= 9) return 2;
  if (key.length >= 5) return 1;
  return 0;
}

const rank = (n) => (TYPE_RANK[n.type] || 0) * 1e9 + (n.priority || 0) * 1e6 + Math.min(n.population || 0, 999999);
const best = (nodes) => [...nodes].sort((a, b) => rank(b) - rank(a))[0] || null;
const keyMatch = (key) => ({ $or: [{ nameKey: key }, { aliasKeys: key }] });
const within = (node) => (node ? { $or: [{ _id: node._id }, { ancestors: node._id }] } : {});

async function fuzzyFind(key, filter) {
  const budget = fuzzyBudget(key);
  if (!budget) return null;
  // Same first letter keeps this an index-friendly prefix scan rather than a full collection read.
  const rx = new RegExp(`^${key[0]}`);
  const candidates = await Location.find({ ...filter, nameKey: rx }).select('name nameKey type priority population ancestors parentId geo slug').limit(2000).lean();
  let found = null;
  let bestDist = budget + 1;
  const digits = key.replace(/\D/g, '');
  for (const c of candidates) {
    // Numbers are identity, not spelling: "Sector 54" must never match "Sector 62".
    if (c.nameKey.replace(/\D/g, '') !== digits) continue;
    const d = levenshtein(key, c.nameKey);
    if (d < bestDist || (d === bestDist && found && rank(c) > rank(found))) {
      found = c;
      bestDist = d;
    }
  }
  return bestDist <= budget ? found : null;
}

async function findState(state) {
  const key = normalizeName(state);
  if (!key) return null;
  return best(await Location.find({ type: 'state', ...keyMatch(key) }).lean());
}

async function findCity(city, stateNode, coords) {
  const key = normalizeName(city);
  if (!key) return null;
  const scope = within(stateNode);
  const exact = await Location.find({ $and: [{ type: { $in: CITY_LEVEL } }, keyMatch(key), scope] }).lean();
  if (exact.length) return best(exact);
  const fuzzy = await fuzzyFind(key, { $and: [{ type: { $in: ['city', 'town', 'district'] } }, scope] });
  if (fuzzy) return fuzzy;
  if (isValidCoords(coords)) {
    return Location.findOne({
      type: { $in: ['city', 'town'] },
      geo: { $near: { $geometry: { type: 'Point', coordinates: [coords.lng, coords.lat] }, $maxDistance: NEAREST_CITY_KM * 1000 } },
    }).lean();
  }
  return null;
}

async function findLocal(locality, cityNode) {
  const key = normalizeName(locality);
  if (!key || !cityNode) return null;
  if (key === cityNode.nameKey) return cityNode;
  const scope = { ancestors: cityNode._id, type: { $in: LOCAL_LEVEL } };
  const exact = await Location.find({ ...scope, ...keyMatch(key) }).lean();
  if (exact.length) return best(exact);
  return fuzzyFind(key, scope);
}

/** The nearest city/town/district above a node (or the node itself), used to make child slugs readable. */
async function cityContext(node) {
  if (['city', 'town', 'district', 'state'].includes(node.type)) return node;
  const ids = [...(node.ancestors || [])].reverse();
  const nodes = await Location.find({ _id: { $in: ids } }).select('slug type').lean();
  const byId = new Map(nodes.map((n) => [String(n._id), n]));
  for (const id of ids) {
    const n = byId.get(String(id));
    if (n && ['city', 'town', 'district', 'state'].includes(n.type)) return n;
  }
  return null;
}

/** A free slug: "rohini-delhi"; on a clash "rohini-delhi-2", "-3", … */
export async function freeSlug(base, taken = null) {
  const root = slugify(base) || 'location';
  const isTaken = async (s) => (taken ? taken.has(s) : !!(await Location.exists({ slug: s })));
  if (!(await isTaken(root))) return root;
  for (let i = 2; i < 1000; i++) {
    const s = `${root}-${i}`;
    if (!(await isTaken(s))) return s;
  }
  return `${root}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
}

/** Add a locality the tree did not know, under the matched city. Marked for admin review. */
async function createLocal(name, parent, coords) {
  const ctx = await cityContext(parent);
  const slug = await freeSlug(`${name} ${ctx?.slug || parent.slug}`);
  const hasCoords = isValidCoords(coords);
  const doc = {
    name: String(name).trim().slice(0, 120),
    slug,
    type: 'locality',
    parentId: parent._id,
    ancestors: [...(parent.ancestors || []), parent._id],
    nameKey: normalizeName(name),
    geo: hasCoords ? { type: 'Point', coordinates: [coords.lng, coords.lat] } : parent.geo,
    approxGeo: !hasCoords || !!parent.approxGeo,
    source: 'listing',
    reviewed: false,
  };
  try {
    return (await Location.create(doc)).toObject();
  } catch (err) {
    // Two listings naming the same new locality at once: the slug index rejects the second; reuse the first.
    if (err?.code === 11000) return findLocal(name, parent);
    throw err;
  }
}

/**
 * Map a listing's free-text address onto the tree.
 * Returns { location, state, city, locality, created } — location is the deepest node matched.
 * With create=true an unknown locality inside a known city is added (source "listing").
 */
export async function resolveLocation({ state, city, locality, coords } = {}, { create = false } = {}) {
  const stateNode = await findState(state);
  const cityNode = await findCity(city, stateNode, coords);
  if (!cityNode) return { location: null, state: stateNode, city: null, locality: null, created: false };
  let localNode = await findLocal(locality, cityNode);
  let created = false;
  if (!localNode && create && normalizeName(locality)) {
    localNode = await createLocal(locality, cityNode, coords);
    created = !!localNode;
  }
  return { location: localNode || cityNode, state: stateNode, city: cityNode, locality: localNode, created };
}

/**
 * Set locationId + ancestors on a Property or Project document (before save).
 * Re-resolves only when the address changed, or when it was never resolved.
 */
export async function assignLocation(doc, { create = true, force = false } = {}) {
  const changed = ['city', 'locality', 'state'].some((f) => doc.isModified?.(f));
  if (!force && doc.locationId && !changed) return doc;
  const { location } = await resolveLocation(
    { state: doc.state, city: doc.city, locality: doc.locality, coords: doc.location },
    { create }
  );
  doc.locationId = location?._id || null;
  doc.ancestors = location ? [...(location.ancestors || [])] : [];
  return doc;
}

/** Root-first chain of { name, slug, type } ending with the node itself. */
export async function breadcrumb(node) {
  if (!node) return [];
  const ids = node.ancestors || [];
  const nodes = await Location.find({ _id: { $in: ids } }).select('name slug type').lean();
  const byId = new Map(nodes.map((n) => [String(n._id), n]));
  return [...ids.map((id) => byId.get(String(id))).filter(Boolean), node].map(({ name, slug, type }) => ({ name, slug, type }));
}

/** Query matching listings that sit at a node or anywhere below it. */
export function underLocation(id) {
  return { $or: [{ locationId: id }, { ancestors: id }] };
}

/** Find a node by its slug, or by an alias typed as a slug ("gurgaon" → Gurugram). */
export async function findBySlug(slug) {
  const s = String(slug || '').toLowerCase().slice(0, 120);
  if (!s) return { node: null, canonical: false };
  const node = await Location.findOne({ slug: s }).lean();
  if (node) return { node, canonical: true };
  const key = normalizeName(s.replace(/-/g, ' '));
  const alias = best(await Location.find(keyMatch(key)).lean());
  return { node: alias, canonical: false };
}

/** Prefix search over names and aliases for autocomplete. */
export async function searchLocations(term, { limit = 10, types } = {}) {
  const key = normalizeName(term).slice(0, 60);
  if (key.length < 2) return [];
  const rx = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const filter = { $or: [{ nameKey: rx }, { aliasKeys: rx }], ...(types ? { type: { $in: types } } : {}) };
  const rows = await Location.find(filter).limit(200).lean();
  return rows.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
}

/* ---------------- shipped seed tree ---------------- */

function flatten(node, parentSlug = null, depth = 0, out = []) {
  out.push({ ...node, parentSlug, depth });
  for (const child of node.children || []) flatten(child, node.slug, depth + 1, out);
  return out;
}

/**
 * Upsert the shipped tree (data/locations.seed.js). Safe to run on every boot: existing nodes keep
 * any admin edits; only missing nodes are inserted and new aliases added.
 */
export async function seedLocations(tree = LOCATION_SEED) {
  const rows = flatten(tree);
  const ids = new Map();
  const ancestorsOf = new Map();
  const maxDepth = Math.max(...rows.map((r) => r.depth));
  let inserted = 0;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const level = rows.filter((r) => r.depth === depth);
    const ops = level.map((r) => {
      const parentId = r.parentSlug ? ids.get(r.parentSlug) : null;
      const ancestors = r.parentSlug ? [...ancestorsOf.get(r.parentSlug), parentId] : [];
      const aliases = r.aliases || [];
      return {
        updateOne: {
          filter: { slug: r.slug },
          update: {
            $setOnInsert: {
              name: r.name,
              slug: r.slug,
              type: r.type,
              parentId,
              ancestors,
              nameKey: normalizeName(r.name),
              geo: r.geo ? { type: 'Point', coordinates: r.geo } : undefined,
              population: r.population ?? null,
              priority: r.priority ?? 0,
              source: 'seed',
              reviewed: true,
            },
            ...(aliases.length ? { $addToSet: { aliases: { $each: aliases }, aliasKeys: { $each: aliases.map(normalizeName) } } } : {}),
          },
          upsert: true,
        },
      };
    });
    const res = await Location.bulkWrite(ops, { ordered: false });
    inserted += res.upsertedCount || 0;
    const docs = await Location.find({ slug: { $in: level.map((r) => r.slug) } }).select('slug ancestors').lean();
    for (const d of docs) {
      ids.set(d.slug, d._id);
      ancestorsOf.set(d.slug, d.ancestors || []);
    }
  }
  return { nodes: rows.length, inserted };
}

/**
 * Recompute every node's ancestors from parentId (after an import moved nodes),
 * then copy the result onto listings and projects. Returns counts of changed documents.
 */
export async function rebuildAncestors() {
  const nodes = await Location.find().select('parentId ancestors').lean();
  const parentOf = new Map(nodes.map((n) => [String(n._id), n.parentId ? String(n.parentId) : null]));
  const memo = new Map();
  const chain = (id) => {
    if (memo.has(id)) return memo.get(id);
    const out = [];
    const seen = new Set([id]);
    for (let p = parentOf.get(id); p && !seen.has(p); p = parentOf.get(p)) {
      out.unshift(p);
      seen.add(p);
    }
    memo.set(id, out);
    return out;
  };
  const ops = [];
  for (const n of nodes) {
    const next = chain(String(n._id));
    if (next.join() !== (n.ancestors || []).map(String).join()) {
      ops.push({ updateOne: { filter: { _id: n._id }, update: { $set: { ancestors: next.map((id) => new mongoose.Types.ObjectId(id)) } } } });
    }
  }
  for (let i = 0; i < ops.length; i += 1000) await Location.bulkWrite(ops.slice(i, i + 1000), { ordered: false });

  const listings = await syncListingAncestors();
  return { nodes: ops.length, ...listings };
}

/** Copy each attached node's ancestors onto the listings and projects pointing at it. */
export async function syncListingAncestors() {
  const { default: Property } = await import('../models/Property.js');
  const { Project } = await import('../models/index.js');
  const out = {};
  for (const [name, Model] of [['properties', Property], ['projects', Project]]) {
    const ops = [];
    const cursor = Model.aggregate([
      { $match: { locationId: { $type: 'objectId' } } },
      { $lookup: { from: 'locations', localField: 'locationId', foreignField: '_id', as: 'loc', pipeline: [{ $project: { ancestors: 1 } }] } },
      { $project: { ancestors: 1, next: { $ifNull: [{ $arrayElemAt: ['$loc.ancestors', 0] }, []] }, missing: { $eq: [{ $size: '$loc' }, 0] } } },
    ]).cursor();
    for await (const d of cursor) {
      if (d.missing) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { locationId: null, ancestors: [] } } } });
      else if ((d.ancestors || []).map(String).join() !== d.next.map(String).join()) {
        ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { ancestors: d.next } } } });
      }
    }
    for (let i = 0; i < ops.length; i += 1000) await Model.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    out[name] = ops.length;
  }
  return out;
}

/**
 * Attach listings and projects that have no locationId yet. Runs at boot (capped) and after
 * imports; unknown localities inside known cities are added to the tree for review.
 */
export async function backfillListingLocations({ limit = 5000 } = {}) {
  const { default: Property } = await import('../models/Property.js');
  const { Project } = await import('../models/index.js');
  const out = { properties: 0, projects: 0, unresolved: 0 };
  for (const [name, Model] of [['properties', Property], ['projects', Project]]) {
    const docs = await Model.find({ locationId: { $in: [null, undefined] }, city: { $nin: [null, ''] } })
      .select('city locality state location')
      .limit(limit);
    const ops = [];
    for (const doc of docs) {
      const { location } = await resolveLocation(
        { state: doc.state, city: doc.city, locality: doc.locality, coords: doc.location },
        { create: true }
      );
      if (!location) {
        out.unresolved++;
        continue;
      }
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { locationId: location._id, ancestors: location.ancestors || [] } } } });
    }
    for (let i = 0; i < ops.length; i += 1000) await Model.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    out[name] = ops.length;
  }
  return out;
}

/** Pages a listing at this address will appear on, deepest first: Rohini, North West Delhi, Delhi. */
export async function appearsOn(address) {
  const { location } = await resolveLocation(address, { create: false });
  if (!location) return { location: null, pages: [] };
  const crumbs = await breadcrumb(location);
  return {
    location: { name: location.name, slug: location.slug, type: location.type },
    pages: crumbs.filter((c) => c.type !== 'country').reverse(),
  };
}
