// DB-independent logic: parsing, scoring, RERA helpers, geo, formatting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, isValidCoords } from '../src/utils/geo.js';
import { formatINR } from '../src/utils/format.js';
import { parseMoney, parseQuery, detectIntent } from '../src/services/chatService.js';
import { bandScore } from '../src/config/scoring.js';
import { overallFrom, personalize } from '../src/services/analysisService.js';
import { computeDiscrepancies, stateCodeFor, applicabilityNotes, summarize } from '../src/services/reraService.js';
import { pricePosition, quantile } from '../src/services/comparablesService.js';
import { searchKnowledge } from '../src/data/knowledge.js';
import { buildFilter } from '../src/services/searchService.js';

test('haversine and coordinate guards', () => {
  const d = haversineKm({ lat: 28.6328, lng: 77.2197 }, { lat: 28.4595, lng: 77.0266 });
  assert.ok(d > 20 && d < 40);
  assert.equal(isValidCoords({ lat: 0, lng: 0 }), true);
  assert.equal(isValidCoords({ lat: null, lng: 10 }), false);
  assert.equal(isValidCoords({ lat: 200, lng: 10 }), false);
});

test('INR formatting', () => {
  assert.equal(formatINR(7500000), '₹75 Lakh');
  assert.equal(formatINR(25000000), '₹2.5 Crore');
  assert.equal(formatINR(45000), '₹45,000');
});

test('money parsing understands lakh / crore / k', () => {
  assert.equal(parseMoney('under ₹1.2 crore')[0].value, 12000000);
  assert.equal(parseMoney('80 lakh')[0].value, 8000000);
  assert.equal(parseMoney('rent 45k')[0].value, 45000);
});

test('natural-language query parsing', () => {
  const dir = { cities: ['Gurugram', 'Pune'], localities: [{ city: 'Gurugram', locality: 'Sector 54' }] };
  const p = parseQuery('Find a 3 BHK flat in Gurgaon under ₹1.2 crore', dir);
  assert.equal(p.city, 'Gurugram');
  assert.equal(p.bedrooms, '3');
  assert.equal(p.maxPrice, 12000000);
  assert.equal(p.propertyType, 'apartment');
  const r = parseQuery('2bhk on rent in sector 54 between 30k and 50k', dir);
  assert.equal(r.listingType, 'rent');
  assert.equal(r.locality, 'Sector 54');
  assert.equal(r.minPrice, 30000);
  assert.equal(r.maxPrice, 50000);
});

test('intent detection', () => {
  assert.equal(detectIntent('Is this project’s RERA registration verified?'), 'rera');
  assert.equal(detectIntent('Are there good schools within 3 km?'), 'schools');
  assert.equal(detectIntent('Compare these two apartments for a family'), 'compare');
  assert.equal(detectIntent('Arrange a site visit with the agent'), 'site-visit');
  assert.equal(detectIntent('Help me list my property'), 'list-property');
  assert.equal(detectIntent('show my leads', 'agent'), 'my-leads');
  assert.notEqual(detectIntent('show my leads', 'buyer'), 'my-leads');
});

test('distance bands: closer scores higher; unknown is not perfect', () => {
  assert.equal(bandScore('metro', 0.5), 100);
  assert.ok(bandScore('metro', 2) < 100);
  assert.ok(bandScore('metro', null) < 50);
});

test('overall score excludes missing data and refuses with too little', () => {
  const mk = (key, value, extra = {}) => ({ key, value, ...extra });
  const none = overallFrom([mk('price', 80), mk('documentation', 60), mk('location', null), mk('connectivity', null), mk('amenities', null), mk('education', null), mk('healthcare', null), mk('rental', null)]);
  assert.equal(none.value, null, 'two scores are not enough');
  const some = overallFrom([mk('price', 80), mk('documentation', 60), mk('location', 70), mk('connectivity', 50), mk('amenities', null), mk('education', null), mk('healthcare', null), mk('rental', null, { notApplicable: true })]);
  assert.ok(some.value > 0 && some.value < 100);
  assert.notEqual(some.confidence, 'high');
  // Priorities shift the result.
  const fam = overallFrom([mk('price', 20), mk('documentation', 60), mk('location', 70), mk('education', 95), mk('healthcare', 95)], ['family']);
  const aff = overallFrom([mk('price', 20), mk('documentation', 60), mk('location', 70), mk('education', 95), mk('healthcare', 95)], ['affordability']);
  assert.ok(fam.value > aff.value);
});

test('personalisation: budget fit and commute note', () => {
  const report = { scores: [], facts: { price: 11000000, location: { lat: 28.44, lng: 77.09 } } };
  const p = personalize(report, { budgetMax: 10000000, workplace: { lat: 28.495, lng: 77.089 } });
  assert.equal(p.budget.fits, false);
  assert.equal(p.budget.overPct, 10);
  assert.ok(p.commute.straightLineKm > 5);
});

test('price position needs a minimum sample', () => {
  assert.equal(pricePosition({ price: 1e7, areaSqft: 1000 }, { n: 2, stats: { median: 9000 } }).verdict, 'insufficient-data');
  const pos = pricePosition({ price: 1.2e7, areaSqft: 1000 }, { n: 6, stats: { median: 10000, p25: 9000, p75: 11000 } });
  assert.equal(pos.verdict, 'above-market');
  assert.equal(pos.deltaPct, 20);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

test('RERA helpers: jurisdiction, discrepancies, honest notes', () => {
  assert.equal(stateCodeFor({ city: 'Gurugram' }), 'HR');
  assert.equal(stateCodeFor({ city: 'Noida' }), 'UP');
  assert.equal(stateCodeFor({ state: 'Maharashtra' }), 'MH');
  const d = computeDiscrepancies({ projectName: 'Green Acres', promoterName: 'ABC Builders Pvt Ltd' }, { projectName: 'Green Acres Phase 2', promoterName: 'ABC Builders Private Limited' });
  assert.equal(d.length, 1, 'promoter suffixes are normalised; project name differs');
  const notes = applicabilityNotes({ listingType: 'sale', constructionStatus: 'under-construction' });
  assert.ok(notes.some((n) => /does not by itself prove/.test(n)));
  const s = summarize({ property: { city: 'Pune', rera: { number: 'X', status: 'not-verified' } }, record: null });
  assert.equal(s.status, 'not-verified');
  assert.match(s.disclaimer, /does not establish clear title/);
});

test('knowledge retrieval finds the booking checklist', () => {
  const hits = searchKnowledge('What should I verify before paying a booking amount?');
  assert.equal(hits[0].id, 'kb-booking-checklist');
});

test('search filter builder: public statuses only, ranges and lists', () => {
  const { filter } = buildFilter({ status: 'draft', minPrice: '100', maxPrice: '200', bedrooms: '2,3', furnishing: 'furnished,bogus', reraVerified: '1' });
  assert.equal(filter.status, 'active', 'drafts can never be searched publicly');
  assert.deepEqual(filter.price, { $gte: 100, $lte: 200 });
  assert.deepEqual(filter.bedrooms, { $in: [2, 3] });
  assert.deepEqual(filter.furnishing, { $in: ['furnished'] });
  assert.equal(filter['rera.status'], 'verified');
});
