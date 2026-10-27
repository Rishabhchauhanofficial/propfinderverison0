/*
 * Import India's places from a GeoNames country dump into the location tree.
 *
 *   1. Download https://download.geonames.org/export/dump/IN.zip (CC BY 4.0, credit GeoNames) and unzip IN.txt
 *   2. npm run import:locations -- --file path/to/IN.txt [--no-villages] [--dry-run]
 *
 * Safe to re-run: nodes are keyed by GeoNames id, so a second run updates rather than duplicates.
 * Nodes that already exist without a GeoNames id (the shipped seed tree, localities created from
 * listings) are matched by name inside the same state/parent and adopted, keeping their slug.
 * Afterwards every node's ancestors and every listing's ancestors are recomputed.
 */
import 'dotenv/config';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Location from '../models/Location.js';
import { haversineKm } from '../utils/geo.js';
import { slugify } from '../utils/slug.js';
import { backfillListingLocations, normalizeName, rebuildAncestors, seedLocations } from '../services/locationService.js';

const PLACE_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC', 'PPLG', 'PPLL', 'PPLS', 'PPLX']);
const CITY_CODES = new Set(['PPLC', 'PPLA', 'PPLA2']);
const CITY_POPULATION = 100000;
const TOWN_POPULATION = 10000;
const LOCALITY_PARENT_KM = 30; // a PPLX (section of a city) attaches to the nearest city within this distance
const BATCH = 1000;

const { ObjectId } = mongoose.Types;

/** Readable alternate names only (GeoNames mixes in other scripts, codes and links). */
function pickAliases(name, alternates) {
  const own = normalizeName(name);
  const seen = new Set([own]);
  const out = [];
  for (const a of String(alternates || '').split(',')) {
    const t = a.trim();
    if (!/^[A-Za-z][A-Za-z .'-]{2,59}$/.test(t) || /^[A-Z]{2,4}$/.test(t)) continue;
    const k = normalizeName(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

export function classify(row) {
  if (row.fcode === 'PPLX') return 'locality';
  if (CITY_CODES.has(row.fcode) || row.population >= CITY_POPULATION) return 'city';
  if (row.population >= TOWN_POPULATION) return 'town';
  return 'village';
}

/** Parse a GeoNames dump into states, districts and places (only the columns we use). */
export async function parseGeoNames(file) {
  const states = [];
  const districts = [];
  const places = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length < 15) continue;
    const row = {
      geonames: Number(c[0]),
      name: c[1].trim(),
      aliases: pickAliases(c[1], c[3]),
      lat: Number(c[4]),
      lng: Number(c[5]),
      fcode: c[7],
      a1: c[10],
      a2: c[11],
      population: Number(c[14]) || 0,
    };
    if (!row.name || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
    if (c[6] === 'A' && row.fcode === 'ADM1') states.push(row);
    else if (c[6] === 'A' && row.fcode === 'ADM2') districts.push(row);
    else if (c[6] === 'P' && PLACE_CODES.has(row.fcode)) places.push(row);
  }
  return { states, districts, places };
}

export async function importGeoNames(file, { villages = true, dryRun = false, log = console.log } = {}) {
  const { states, districts, places } = await parseGeoNames(file);
  for (const p of places) p.type = classify(p);
  const kept = villages ? places : places.filter((p) => p.type !== 'village');
  log(`[import] parsed ${states.length} states, ${districts.length} districts, ${kept.length} places`);
  if (dryRun) return { states: states.length, districts: districts.length, places: kept.length, written: 0 };

  await seedLocations();
  const root = await Location.findOne({ type: 'country', slug: 'india' }).lean();

  // What already exists: by GeoNames id, and (for nodes without one) by name for adoption.
  const byGeonames = new Map();
  for await (const n of Location.find({ 'codes.geonames': { $type: 'number' } }).select('codes slug').lean().cursor()) {
    byGeonames.set(n.codes.geonames, n);
  }
  const unmatched = await Location.find({ 'codes.geonames': { $exists: false }, type: { $ne: 'country' } }).lean();
  const taken = new Set((await Location.find().select('slug').lean()).map((n) => n.slug));

  const adopt = (keys, types) => {
    for (const n of unmatched) {
      if (n._adopted || !types.includes(n.type)) continue;
      const nk = [n.nameKey, ...(n.aliasKeys || [])];
      if (keys.some((k) => nk.includes(k.name) && k.test(n))) {
        n._adopted = true;
        return n;
      }
    }
    return null;
  };
  const freeSlug = (...candidates) => {
    for (const c of candidates) {
      const s = slugify(c);
      if (s && !taken.has(s)) {
        taken.add(s);
        return s;
      }
    }
    const base = slugify(candidates[0]) || 'location';
    for (let i = 2; ; i++) {
      if (!taken.has(`${base}-${i}`)) {
        taken.add(`${base}-${i}`);
        return `${base}-${i}`;
      }
    }
  };

  const ops = [];
  let written = 0;
  const flush = async (force = false) => {
    if (ops.length && (force || ops.length >= BATCH)) {
      const batch = ops.splice(0, ops.length);
      await Location.bulkWrite(batch, { ordered: false });
      written += batch.length;
    }
  };

  /** Queue a write for one imported row and return { _id, slug, ancestors } for its children. */
  const put = async (row, type, parent, slugCandidates, existingByName) => {
    const ancestors = [...parent.ancestors, parent._id];
    const fields = {
      type,
      parentId: parent._id,
      ancestors,
      population: row.population || null,
      'codes.geonames': row.geonames,
    };
    const aliasSet = { $addToSet: { aliases: { $each: row.aliases }, aliasKeys: { $each: row.aliases.map(normalizeName) } } };
    const known = byGeonames.get(row.geonames) || existingByName;
    if (known) {
      // Keep the existing name, slug and coordinates (an admin may have corrected them); adopt the structure.
      const nameAlias = normalizeName(row.name) !== known.nameKey && known.nameKey ? [row.name] : [];
      ops.push({
        updateOne: {
          filter: { _id: known._id },
          update: {
            $set: { ...fields, ...(existingByName ? { type: known.type } : {}) },
            $addToSet: {
              aliases: { $each: [...row.aliases, ...nameAlias] },
              aliasKeys: { $each: [...row.aliases, ...nameAlias].map(normalizeName) },
            },
          },
        },
      });
      await flush();
      return { _id: known._id, slug: known.slug, ancestors, nameKey: normalizeName(row.name), lat: row.lat, lng: row.lng };
    }
    const _id = new ObjectId();
    const slug = freeSlug(...slugCandidates);
    ops.push({
      updateOne: {
        filter: { 'codes.geonames': row.geonames },
        update: {
          $set: fields,
          $setOnInsert: {
            _id,
            name: row.name,
            slug,
            nameKey: normalizeName(row.name),
            geo: { type: 'Point', coordinates: [row.lng, row.lat] },
            approxGeo: false,
            priority: 0,
            source: 'import',
            reviewed: true,
          },
          ...aliasSet,
        },
        upsert: true,
      },
    });
    await flush();
    return { _id, slug, ancestors, nameKey: normalizeName(row.name), lat: row.lat, lng: row.lng };
  };

  // States.
  const stateByCode = new Map();
  for (const s of states) {
    const key = normalizeName(s.name);
    const existing = adopt([{ name: key, test: () => true }], ['state']);
    stateByCode.set(s.a1, await put(s, 'state', root, [s.name, `${s.name} state`], existing));
  }

  // City-level names per district, so a district named like its main city gets "-district".
  const cityNamesIn = new Map();
  for (const p of kept) {
    if (p.type !== 'city' && p.type !== 'town') continue;
    const k = `${p.a1}.${p.a2}`;
    if (!cityNamesIn.has(k)) cityNamesIn.set(k, new Set());
    cityNamesIn.get(k).add(slugify(p.name));
  }

  // Districts.
  const districtByCode = new Map();
  for (const d of districts) {
    const state = stateByCode.get(d.a1);
    if (!state) continue;
    const key = normalizeName(d.name);
    const existing = adopt([{ name: key, test: (n) => n.ancestors?.some((a) => String(a) === String(state._id)) }], ['district']);
    const base = slugify(d.name);
    const clash = cityNamesIn.get(`${d.a1}.${d.a2}`)?.has(base);
    const slugs = clash ? [`${d.name} district`, `${d.name} district ${state.slug}`] : [d.name, `${d.name} ${state.slug}`, `${d.name} district`];
    districtByCode.set(`${d.a1}.${d.a2}`, await put(d, 'district', state, slugs, existing));
  }

  // Cities and towns (a city named exactly like its state, e.g. Delhi, is folded into the state).
  const citiesIn = new Map();
  const cityLevel = kept.filter((p) => p.type === 'city' || p.type === 'town').sort((a, b) => b.population - a.population);
  for (const p of cityLevel) {
    const state = stateByCode.get(p.a1);
    if (!state) continue;
    const key = normalizeName(p.name);
    if (key === state.nameKey) continue;
    const district = districtByCode.get(`${p.a1}.${p.a2}`);
    const parent = district || state;
    const existing = adopt([{ name: key, test: (n) => n.ancestors?.some((a) => String(a) === String(state._id)) }], ['city', 'town']);
    const node = await put(p, p.type, parent, [p.name, `${p.name} ${state.slug}`, `${p.name} ${parent.slug}`], existing);
    const k = `${p.a1}.${p.a2}`;
    if (!citiesIn.has(k)) citiesIn.set(k, []);
    citiesIn.get(k).push(node);
  }

  // Localities (sections of a city) and villages.
  for (const p of kept) {
    if (p.type !== 'locality' && p.type !== 'village') continue;
    const state = stateByCode.get(p.a1);
    if (!state) continue;
    const district = districtByCode.get(`${p.a1}.${p.a2}`);
    let parent = district || state;
    if (p.type === 'locality') {
      let bestKm = LOCALITY_PARENT_KM;
      for (const c of citiesIn.get(`${p.a1}.${p.a2}`) || []) {
        const km = haversineKm({ lat: p.lat, lng: p.lng }, { lat: c.lat, lng: c.lng });
        if (km < bestKm) {
          bestKm = km;
          parent = c;
        }
      }
    }
    const key = normalizeName(p.name);
    const scopeId = String((district || state)._id);
    const existing = adopt(
      [{ name: key, test: (n) => n.ancestors?.some((a) => String(a) === scopeId) }],
      ['locality', 'village']
    );
    await put(p, p.type, parent, [`${p.name} ${parent.slug}`, `${p.name} ${parent.slug} ${p.geonames}`], existing);
  }
  await flush(true);

  log(`[import] wrote ${written} nodes; rebuilding ancestors…`);
  const rebuilt = await rebuildAncestors();
  const attached = await backfillListingLocations({ limit: 100000 });
  log(`[import] ancestors updated on ${rebuilt.nodes} nodes, ${rebuilt.properties} listings, ${rebuilt.projects} projects`);
  log(`[import] newly attached ${attached.properties} listings, ${attached.projects} projects (${attached.unresolved} still unresolved)`);
  return { states: states.length, districts: districts.length, places: kept.length, written, rebuilt, attached };
}

// CLI: npm run import:locations -- --file IN.txt [--no-villages] [--dry-run]
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const file = args[args.indexOf('--file') + 1];
  if (!args.includes('--file') || !file || !fs.existsSync(file)) {
    console.error('Usage: npm run import:locations -- --file path/to/IN.txt [--no-villages] [--dry-run]');
    process.exit(1);
  }
  const { connectDB, disconnectDB } = await import('../config/db.js');
  if (!process.env.MONGODB_URI) console.warn('[import] MONGODB_URI is not set — importing into a temporary in-memory database.');
  await connectDB();
  try {
    await importGeoNames(file, { villages: !args.includes('--no-villages'), dryRun: args.includes('--dry-run') });
  } finally {
    await disconnectDB();
  }
  process.exit(0);
}
