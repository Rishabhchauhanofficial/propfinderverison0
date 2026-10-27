// Location tree: name matching, listing attachment, tree-scoped search, API, and the GeoNames import.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, sampleListing } from './helpers.mjs';

const { normalizeName, levenshtein, fuzzyBudget, resolveLocation } = await import('../src/services/locationService.js');
const { classify, importGeoNames } = await import('../src/data/importLocations.js');
const { default: Location } = await import('../src/models/Location.js');
const { default: Property } = await import('../src/models/Property.js');

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'geonames-sample.txt');

let t;
let owner;
before(async () => {
  t = await startServer();
  owner = await t.login('priya@example.com');
});
after(async () => t.stop());

const slugOf = async (id) => (await Location.findById(id).lean())?.slug;
const slugsOf = async (ids) => (await Location.find({ _id: { $in: ids } }).lean()).map((n) => n.slug).sort();

test('name helpers: normalisation, edit distance, typo budget, GeoNames classes', () => {
  assert.equal(normalizeName('  Sector-62 '), 'sector 62');
  assert.equal(normalizeName('DLF Phase-II'), 'dlf phase ii');
  assert.equal(levenshtein('gurugarm', 'gurugram'), 2);
  assert.equal(fuzzyBudget('agra'), 0); // short names must match exactly
  assert.equal(fuzzyBudget('kanpur'), 1);
  assert.equal(fuzzyBudget('gurugram'), 1);
  assert.equal(classify({ fcode: 'PPLX', population: 0 }), 'locality');
  assert.equal(classify({ fcode: 'PPLA2', population: 0 }), 'city');
  assert.equal(classify({ fcode: 'PPL', population: 250000 }), 'city');
  assert.equal(classify({ fcode: 'PPL', population: 15000 }), 'town');
  assert.equal(classify({ fcode: 'PPL', population: 900 }), 'village');
});

test('resolution: aliases, typos, states as cities, and numbers never fuzzed', async () => {
  assert.equal((await resolveLocation({ city: 'Gurgaon' })).location.slug, 'gurugram');
  assert.equal((await resolveLocation({ city: 'Gurugrm' })).location.slug, 'gurugram');
  assert.equal((await resolveLocation({ city: 'Bangalore', locality: 'Koramangala' })).location.slug, 'koramangala-bengaluru');
  assert.equal((await resolveLocation({ city: 'Cawnpore' })).location.slug, 'kanpur');
  assert.equal((await resolveLocation({ city: 'New Delhi', locality: 'Rohini' })).location.slug, 'rohini-delhi');
  assert.equal((await resolveLocation({ city: 'Pune', locality: 'Hinjawadi' })).location.slug, 'hinjewadi-pune');
  // Sector 63 is one character from Sector 62 but a different place: stop at the city.
  const noida = await resolveLocation({ city: 'Noida', locality: 'Sector 63' });
  assert.equal(noida.location.slug, 'noida');
  assert.equal(noida.locality, null);
  assert.equal((await resolveLocation({ city: 'Atlantis' })).location, null);
  // Unknown name but coordinates inside a known city.
  assert.equal((await resolveLocation({ city: 'Gurgram City', coords: { lat: 28.46, lng: 77.03 } })).location.slug, 'gurugram');
});

test('seeded listings sit in the tree: Rohini counts towards North West Delhi and Delhi', async () => {
  const rohini = await Property.findOne({ city: 'Delhi', locality: 'Rohini' }).lean();
  assert.equal(await slugOf(rohini.locationId), 'rohini-delhi');
  assert.deepEqual(await slugsOf(rohini.ancestors), ['delhi', 'india', 'north-west-delhi']);
  assert.equal(await Property.countDocuments({ locationId: null }), 0);

  const delhi = await t.api('/api/locations/delhi');
  assert.equal(delhi.status, 200);
  const delhiListings = await Property.countDocuments({ status: 'active', city: 'Delhi' });
  assert.equal(delhi.data.counts.total, delhiListings);
  assert.deepEqual(delhi.data.breadcrumb.map((c) => c.slug), ['india', 'delhi']);
  const nw = delhi.data.children.find((c) => c.slug === 'north-west-delhi');
  assert.equal(nw.listings, await Property.countDocuments({ status: 'active', city: 'Delhi', locality: 'Rohini' }));

  assert.deepEqual((await t.api('/api/locations/gurgaon')).data, { redirect: 'gurugram' });
  assert.equal((await t.api('/api/locations/nowhere-at-all')).status, 404);
});

test('search is scoped by the tree: aliases and parent places find the same listings', async () => {
  const byName = await t.api('/api/properties?city=Gurugram&limit=50');
  const byAlias = await t.api('/api/properties?city=Gurgaon&limit=50');
  assert.ok(byName.data.total > 0);
  assert.equal(byAlias.data.total, byName.data.total);

  const state = await t.api('/api/properties?city=Uttar Pradesh&limit=50');
  const noida = await t.api('/api/properties?city=Noida&limit=50');
  assert.equal(state.data.total, noida.data.total); // all UP demo listings are in Noida

  const rohini = await t.api('/api/properties?city=Delhi&locality=Rohini&limit=50');
  assert.ok(rohini.data.total > 0);
  assert.ok(rohini.data.items.every((p) => p.locality === 'Rohini'));
  assert.equal((await t.api('/api/properties?location=north-west-delhi&limit=50')).data.total, rohini.data.total);

  const suggest = await t.api('/api/properties/suggest?q=gurga');
  assert.ok(suggest.data.items.some((s) => s.label === 'Gurugram'), JSON.stringify(suggest.data));
});

test('a new listing in an unknown locality extends the tree for review and previews its pages', async () => {
  const before = await t.api('/api/locations/appears-on?city=Gurgaon&locality=DLF Phase II');
  assert.deepEqual(before.data.pages.map((p) => p.slug), ['dlf-phase-2-gurugram', 'gurugram', 'haryana']);

  const created = await t.api('/api/properties', {
    method: 'POST',
    token: owner,
    body: sampleListing({ title: 'Test flat in Sushant Lok 1', locality: 'Sushant Lok 1', location: { lat: 28.4645, lng: 77.0773 } }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const doc = await Property.findById(created.data.id || created.data._id).lean();
  const node = await Location.findById(doc.locationId).lean();
  assert.equal(node.slug, 'sushant-lok-1-gurugram');
  assert.equal(node.source, 'listing');
  assert.equal(node.reviewed, false);
  assert.deepEqual(await slugsOf(doc.ancestors), ['gurugram', 'haryana', 'india']);

  // Moving the listing to another city re-attaches it.
  await t.api(`/api/properties/${doc._id}`, { method: 'PUT', token: owner, body: { city: 'Pune', locality: 'Baner', location: { lat: 18.559, lng: 73.7868 } } });
  assert.equal(await slugOf((await Property.findById(doc._id).lean()).locationId), 'baner-pune');
});

test('GeoNames import adopts the shipped tree, adds new places, and is safe to re-run', async () => {
  const quiet = () => {};
  const first = await importGeoNames(FIXTURE, { log: quiet });
  assert.equal(first.states, 3);

  // Existing nodes keep their slugs and gain the GeoNames id; Gurugram moves under its district.
  const gurugram = await Location.findOne({ slug: 'gurugram' }).lean();
  assert.equal(gurugram.codes.geonames, 9000011);
  assert.equal(await slugOf(gurugram.parentId), 'gurgaon-district');
  const kanpur = await Location.findOne({ slug: 'kanpur' }).lean();
  assert.equal(kanpur.codes.geonames, 9000007);
  assert.ok(kanpur.aliases.includes('Cawnpur'));
  assert.equal(await Location.countDocuments({ nameKey: 'rohini' }), 1);
  assert.equal(await Location.countDocuments({ nameKey: 'delhi', type: { $in: ['city', 'town'] } }), 0); // folded into the state

  // New places get readable slugs.
  const village = await Location.findOne({ 'codes.geonames': 9000008 }).lean();
  assert.equal(village.slug, 'testpur-kanpur-nagar');
  assert.equal(village.type, 'village');
  assert.equal((await Location.findOne({ 'codes.geonames': 9000012 }).lean()).type, 'town');

  // Listings follow the moved node.
  const dlf = await Property.findOne({ city: 'Gurugram', locality: 'DLF Phase 2' }).lean();
  assert.ok((await slugsOf(dlf.ancestors)).includes('gurgaon-district'));

  const count = await Location.countDocuments();
  await importGeoNames(FIXTURE, { log: quiet });
  assert.equal(await Location.countDocuments(), count);
});
