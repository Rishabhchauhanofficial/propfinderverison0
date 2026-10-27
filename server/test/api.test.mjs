// End-to-end API tests against an isolated in-memory MongoDB with demo seed data.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startServer, parseSSE, sampleListing } from './helpers.mjs';

let t; // harness
let admin, agent, owner, builder, buyer;

before(async () => {
  t = await startServer();
  [admin, agent, owner, builder, buyer] = await Promise.all([
    t.login('admin@propfinder.in'),
    t.login('agent@propfinder.in'),
    t.login('priya@example.com'),
    t.login('builder@propfinder.in'),
    t.login('demo@propfinder.in'),
  ]);
});
after(async () => t.stop());

/* ---------------- auth & roles ---------------- */

test('registration: admin role cannot be self-assigned; weak passwords rejected', async () => {
  const r = await t.api('/api/auth/register', { method: 'POST', body: { name: 'Eve', email: 'eve@test.in', password: 'Secret123', role: 'admin' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'buyer');
  const weak = await t.api('/api/auth/register', { method: 'POST', body: { name: 'W', email: 'w@test.in', password: 'short' } });
  assert.equal(weak.status, 400);
  const me = await t.api('/api/auth/me', { token: r.data.token });
  assert.equal(me.data.user.email, 'eve@test.in');
});

test('password reset flow works and the token is single-use', async () => {
  const { email } = await t.register();
  const f = await t.api('/api/auth/forgot-password', { method: 'POST', body: { email } });
  assert.equal(f.status, 200);
  const url = new URL(f.data.devResetUrl);
  const token = url.searchParams.get('token');
  const r = await t.api('/api/auth/reset-password', { method: 'POST', body: { email, token, password: 'NewPass456' } });
  assert.equal(r.status, 200);
  const again = await t.api('/api/auth/reset-password', { method: 'POST', body: { email, token, password: 'Another789' } });
  assert.equal(again.status, 400);
  const login = await t.api('/api/auth/login', { method: 'POST', body: { email, password: 'NewPass456' } });
  assert.equal(login.status, 200);
  // Unknown emails get the same generic answer.
  const unknown = await t.api('/api/auth/forgot-password', { method: 'POST', body: { email: 'nobody@nowhere.in' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.devResetUrl, undefined);
});

test('listing creation is enforced server-side by role', async () => {
  assert.equal((await t.api('/api/properties', { method: 'POST', body: sampleListing() })).status, 401);
  assert.equal((await t.api('/api/properties', { method: 'POST', token: buyer, body: sampleListing() })).status, 403);
  const created = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ title: 'Owner flat in Sector 54' }) });
  assert.equal(created.status, 201);
  assert.equal(created.data.postedByRole, 'owner');
  // Moderation fields cannot be set by the lister.
  const sneaky = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ title: 'Sneaky verified flat', listingVerified: true, isDemo: false, rera: { number: 'HRERA-123' }, price: 30000000 }) });
  assert.equal(sneaky.data.listingVerified, false);
  assert.equal(sneaky.data.rera.status, 'not-verified', 'entering a RERA number never makes it verified');
});

test('listing validation rejects nonsense prices and bad coordinates', async () => {
  const low = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ price: 5000 }) });
  assert.equal(low.status, 400);
  const coords = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ location: { lat: 95, lng: 77 } }) });
  assert.equal(coords.status, 400);
  const carpet = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ carpetAreaSqft: 5000 }) });
  assert.equal(carpet.status, 400);
});

test('duplicate listings are detected and flagged', async () => {
  const body = sampleListing({ title: 'Dup check flat', price: 41000000, areaSqft: 2222, location: { lat: 28.45, lng: 77.1 } });
  await t.api('/api/properties', { method: 'POST', token: owner, body });
  const second = await t.api('/api/properties', { method: 'POST', token: agent, body: { ...body, title: 'Same flat, different agent' } });
  assert.equal(second.status, 201);
  assert.ok(second.data.warnings.length >= 1);
  assert.ok(second.data.possibleDuplicateOf);
});

test('drafts and paused listings are hidden from the public but visible to the owner', async () => {
  const d = await t.api('/api/properties', { method: 'POST', token: owner, body: { title: 'Half-written draft', listingType: 'sale', propertyType: 'apartment', price: 1, areaSqft: 1, city: 'Pune', locality: 'Baner', status: 'draft' } });
  assert.equal(d.status, 201, JSON.stringify(d.data));
  assert.equal((await t.api(`/api/properties/${d.data.id}`)).status, 404);
  assert.equal((await t.api(`/api/properties/${d.data.id}`, { token: owner })).status, 200);
  // Publishing an incomplete draft is refused.
  const pub = await t.api(`/api/properties/${d.data.id}/status`, { method: 'PATCH', token: owner, body: { status: 'active' } });
  assert.equal(pub.status, 400);
  // Others cannot edit it.
  assert.equal((await t.api(`/api/properties/${d.data.id}`, { method: 'PUT', token: agent, body: { title: 'hijack' } })).status, 403);
});

/* ---------------- search ---------------- */

test('search filters run on the server and combine correctly', async () => {
  const r = await t.api('/api/properties?city=Gurugram&listingType=sale&bedrooms=3&maxPrice=40000000&sort=price_asc&limit=50');
  assert.equal(r.status, 200);
  assert.ok(r.data.total > 0);
  for (const p of r.data.items) {
    assert.equal(p.city, 'Gurugram');
    assert.equal(p.listingType, 'sale');
    assert.ok(p.bedrooms >= 3);
    assert.ok(p.price <= 40000000);
  }
  const prices = r.data.items.map((p) => p.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.ok(r.data.facets.cities.length >= 1);
});

test('search: privacy — owner phone and email never appear in results', async () => {
  const r = await t.api('/api/properties?limit=50');
  const json = JSON.stringify(r.data.items);
  assert.ok(!json.includes('98100'), 'no phone numbers');
  assert.ok(!json.includes('@propfinder.in'), 'no emails');
});

test('search: commercial, price per sq ft, under construction, RERA and near-me filters', async () => {
  const c = await t.api('/api/properties?commercial=1&limit=50');
  assert.ok(c.data.items.every((p) => ['commercial', 'office', 'retail-shop'].includes(p.propertyType)));
  const ppsf = await t.api('/api/properties?listingType=sale&minPpsf=20000&limit=50');
  assert.ok(ppsf.data.items.every((p) => p.pricePerSqft >= 20000));
  const uc = await t.api('/api/properties?constructionStatus=under-construction&limit=50');
  assert.ok(uc.data.total >= 3 && uc.data.items.every((p) => p.constructionStatus === 'under-construction'));
  const rv = await t.api('/api/properties?reraVerified=1');
  assert.equal(rv.data.total, 0, 'no seeded listing is RERA-verified');
  const near = await t.api('/api/properties?near=28.4795,77.0895&radiusKm=2');
  assert.ok(near.data.total > 0);
  assert.ok(near.data.items.every((p) => p.distanceKm <= 2));
  assert.ok(near.data.items.every((p, i, a) => i === 0 || a[i - 1].distanceKm <= p.distanceKm), 'sorted by distance');
});

test('autocomplete returns localities, projects and PIN codes', async () => {
  const r = await t.api('/api/properties/suggest?q=whitef');
  assert.ok(r.data.items.some((s) => s.type === 'locality' && s.label === 'Whitefield'));
  const proj = await t.api('/api/properties/suggest?q=Sample Lake');
  assert.ok(proj.data.items.some((s) => s.type === 'project'));
  const pin = await t.api('/api/properties/suggest?q=5600');
  assert.ok(pin.data.items.some((s) => s.type === 'pin'));
});

/* ---------------- personal features ---------------- */

test('favourites, saved searches and recently viewed persist per user', async () => {
  const list = await t.api('/api/properties?city=Pune&limit=2');
  const id = list.data.items[0].id;
  assert.equal((await t.api(`/api/me/favorites/${id}`, { method: 'POST', token: buyer })).status, 201);
  assert.equal((await t.api(`/api/me/favorites/${id}`, { method: 'POST', token: buyer })).status, 201, 'idempotent');
  const favs = await t.api('/api/me/favorites', { token: buyer });
  assert.deepEqual(favs.data.ids, [id]);
  const detail = await t.api(`/api/properties/${id}`, { token: buyer });
  assert.equal(detail.data.property.isFavorite, true);
  await t.api(`/api/me/favorites/${id}`, { method: 'DELETE', token: buyer });
  assert.equal((await t.api('/api/me/favorites', { token: buyer })).data.ids.length, 0);

  const ss = await t.api('/api/me/saved-searches', { method: 'POST', token: buyer, body: { params: { city: 'Pune', listingType: 'sale', evil: '$where' } } });
  assert.equal(ss.status, 201);
  assert.equal(ss.data.params.evil, undefined, 'unknown params are dropped');
  const saved = await t.api('/api/me/saved-searches', { token: buyer });
  assert.ok(saved.data.items[0].total > 0);

  const recent = await t.api('/api/me/recently-viewed', { token: buyer });
  assert.equal(recent.data.items[0].id, id);
});

/* ---------------- leads & site visits ---------------- */

test('contact creates one lead; only the listing owner can manage it', async () => {
  const list = await t.api('/api/properties?city=Delhi&limit=50');
  const agentListing = list.data.items.find((p) => p.owner?.role === 'agent');
  const c = await t.api(`/api/properties/${agentListing.id}/contact`, { method: 'POST', token: buyer, body: { message: 'Is it available?', requirements: { budgetMax: 30000000, bedrooms: 2 } } });
  assert.equal(c.status, 201);
  assert.ok(c.data.phone, 'phone shared after contact');
  await t.api(`/api/properties/${agentListing.id}/contact`, { method: 'POST', token: buyer, body: { message: 'Following up' } });

  const leads = await t.api('/api/leads', { token: agent });
  const mine = leads.data.items.filter((l) => String(l.property._id) === agentListing.id);
  assert.equal(mine.length, 1, 'no duplicate lead for the same buyer and listing');

  assert.equal((await t.api('/api/leads', { token: buyer })).status, 403, 'buyers have no lead inbox');
  const ownerLeads = await t.api('/api/leads', { token: owner });
  assert.ok(!ownerLeads.data.items.some((l) => l._id === mine[0]._id), 'other listers cannot see it');
  assert.equal((await t.api(`/api/leads/${mine[0]._id}`, { method: 'PATCH', token: owner, body: { status: 'won' } })).status, 403);
  const upd = await t.api(`/api/leads/${mine[0]._id}`, { method: 'PATCH', token: agent, body: { status: 'qualified', note: 'Called' } });
  assert.equal(upd.data.status, 'qualified');

  const notes = await t.api('/api/me/notifications', { token: agent });
  assert.ok(notes.data.items.some((n) => n.type === 'lead'));
});

test('site visits: request, confirm by lister, cancel by requester only', async () => {
  const list = await t.api('/api/properties?city=Mumbai&limit=50');
  const p = list.data.items.find((x) => x.owner?.role === 'agent');
  const when = new Date(Date.now() + 3 * 86400000).toISOString();
  assert.equal((await t.api('/api/visits', { method: 'POST', token: buyer, body: { propertyId: p.id, scheduledAt: new Date(Date.now() - 1000).toISOString() } })).status, 400);
  const v = await t.api('/api/visits', { method: 'POST', token: buyer, body: { propertyId: p.id, scheduledAt: when, note: 'Evening please' } });
  assert.equal(v.status, 201);
  const vid = v.data.visit._id;
  assert.equal((await t.api(`/api/visits/${vid}`, { method: 'PATCH', token: buyer, body: { status: 'confirmed' } })).status, 400, 'requester cannot confirm');
  assert.equal((await t.api(`/api/visits/${vid}`, { method: 'PATCH', token: owner, body: { status: 'confirmed' } })).status, 403);
  assert.equal((await t.api(`/api/visits/${vid}`, { method: 'PATCH', token: agent, body: { status: 'confirmed' } })).data.status, 'confirmed');
  const mine = await t.api('/api/me/enquiries', { token: buyer });
  assert.ok(mine.data.visits.some((x) => x._id === vid));
});

/* ---------------- reviews & moderation ---------------- */

test('reviews: no self-reviews, clean reviews publish, duplicates are queued, moderation is admin-only', async () => {
  const list = await t.api('/api/properties?city=Bengaluru&limit=50');
  const p = list.data.items.find((x) => x.owner?.role === 'owner');
  const body = 'Lived here for two years. Maintenance is responsive and the water supply has been reliable throughout.';
  const ratings = { overall: 4, maintenance: 5, connectivity: 3 };

  // Accounts younger than a day are queued by design; age the seeded buyer.
  await mongoose.connection.collection('users').updateOne({ email: 'demo@propfinder.in' }, { $set: { createdAt: new Date(Date.now() - 30 * 86400000) } });

  const self = await t.api('/api/reviews', { method: 'POST', token: owner, body: { targetType: 'property', targetId: p.id, ratings, body } });
  assert.equal(self.status, 403);

  const ok = await t.api('/api/reviews', { method: 'POST', token: buyer, body: { targetType: 'property', targetId: p.id, ratings, body, relationship: 'resident' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.review.status, 'published');
  assert.equal(ok.data.review.relationshipVerified, false, 'self-declared relationship is never auto-verified');

  const again = await t.api('/api/reviews', { method: 'POST', token: buyer, body: { targetType: 'property', targetId: p.id, ratings, body } });
  assert.equal(again.status, 400, 'one review per target');

  const other = await t.register();
  const dup = await t.api('/api/reviews', { method: 'POST', token: other.token, body: { targetType: 'property', targetId: p.id, ratings: { overall: 5 }, body } });
  assert.equal(dup.data.review.status, 'pending');

  const pub = await t.api(`/api/reviews?targetType=property&targetId=${p.id}`);
  assert.equal(pub.data.summary.count, 1, 'pending reviews are not public');
  assert.equal(pub.data.summary.dimensions.maintenance.avg, 5);

  assert.equal((await t.api('/api/admin/reviews', { token: agent })).status, 403);
  const queue = await t.api('/api/admin/reviews?status=pending', { token: admin });
  const queued = queue.data.items.find((r) => r._id === dup.data.review.id);
  assert.ok(queued.autoFlags.includes('duplicate-text'));
  assert.equal((await t.api(`/api/admin/reviews/${queued._id}`, { method: 'PATCH', token: admin, body: { status: 'rejected' } })).status, 400, 'reason required');
  assert.equal((await t.api(`/api/admin/reviews/${queued._id}`, { method: 'PATCH', token: admin, body: { status: 'rejected', note: 'Copied text' } })).status, 200);

  // Reporting queues for moderators but does not hide.
  const rep = await t.api('/api/reports', { method: 'POST', token: other.token, body: { targetType: 'review', targetId: ok.data.review.id, reason: 'fake-review' } });
  assert.equal(rep.status, 201);
  assert.equal((await t.api(`/api/reviews?targetType=property&targetId=${p.id}`)).data.summary.count, 1);

  // Lister can reply, not delete.
  assert.equal((await t.api(`/api/reviews/${ok.data.review.id}/replies`, { method: 'POST', token: owner, body: { body: 'Thank you for the feedback!' } })).status, 201);
  assert.equal((await t.api(`/api/reviews/${ok.data.review.id}`, { method: 'DELETE', token: owner })).status, 403);

  const logs = await t.api('/api/admin/audit-logs?action=review.moderate', { token: admin });
  assert.ok(logs.data.items.length >= 1);
});

test('locality reviews work without an owner', async () => {
  const other = await t.register();
  const r = await t.api('/api/reviews', { method: 'POST', token: other.token, body: { targetType: 'locality', targetId: 'Pune|Baner', ratings: { overall: 4, connectivity: 3 }, body: 'Good markets and parks, though traffic on Baner Road is heavy at peak hours.' } });
  assert.equal(r.status, 201);
});

/* ---------------- RERA ---------------- */

test('RERA: verification requires official evidence and detects mismatches', async () => {
  const created = await t.api('/api/properties', {
    method: 'POST',
    token: builder,
    body: sampleListing({ title: 'RERA test unit', constructionStatus: 'under-construction', developerName: 'Acme Homes Pvt Ltd', rera: { number: 'RC/REP/HARERA/GGM/999/2024', projectName: 'Acme Heights' } }),
  });
  assert.equal(created.status, 201);
  const pid = created.data.id;
  let summary = await t.api(`/api/rera/properties/${pid}`);
  assert.equal(summary.data.status, 'not-verified');
  assert.equal(summary.data.authority.code, 'HR', 'Gurugram maps to the Haryana authority');
  assert.ok(summary.data.officialUrl.startsWith('https://'));

  // Evidence upload: private document storage + attach.
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const fd = new FormData();
  fd.append('files', new Blob([pdf], { type: 'application/pdf' }), 'certificate.pdf');
  const up = await t.api('/api/uploads/documents', { method: 'POST', token: builder, body: fd });
  assert.equal(up.status, 201);
  assert.equal((await t.api(`/api/rera/properties/${pid}/evidence`, { method: 'POST', token: buyer, body: { files: up.data.files } })).status, 403);
  assert.equal((await t.api(`/api/rera/properties/${pid}/evidence`, { method: 'POST', token: builder, body: { files: up.data.files } })).status, 201);
  // The document is private.
  assert.equal((await t.api(up.data.files[0].url, { token: buyer, raw: true })).status, 403);
  assert.equal((await t.api(up.data.files[0].url, { token: builder, raw: true })).status, 200);
  assert.equal((await t.api(up.data.files[0].url, { token: admin, raw: true })).status, 200);

  const queue = await t.api('/api/admin/rera', { token: admin });
  const rec = queue.data.items.find((r) => String(r.property?._id) === pid);
  assert.ok(rec);

  const check = await t.api(`/api/admin/rera/${rec._id}/check`, { method: 'POST', token: admin });
  assert.equal(check.data.available, false, 'no automated feed is claimed');

  const noSource = await t.api(`/api/admin/rera/${rec._id}`, { method: 'PUT', token: admin, body: { status: 'verified', official: { projectName: 'Acme Heights', promoterName: 'Acme Homes Private Limited' } } });
  assert.equal(noSource.status, 400);

  const mismatch = await t.api(`/api/admin/rera/${rec._id}`, { method: 'PUT', token: admin, body: { status: 'verified', official: { projectName: 'Acme Heights', promoterName: 'Totally Different Realty', sourceUrl: 'https://haryanarera.gov.in/x' } } });
  assert.equal(mismatch.data.status, 'mismatch');
  summary = await t.api(`/api/rera/properties/${pid}`);
  assert.equal(summary.data.status, 'mismatch');
  assert.ok(summary.data.discrepancies.length >= 1);

  const verified = await t.api(`/api/admin/rera/${rec._id}`, { method: 'PUT', token: admin, body: { status: 'verified', official: { projectName: 'Acme Heights', promoterName: 'Acme Homes Private Limited', sourceUrl: 'https://haryanarera.gov.in/x' } } });
  assert.equal(verified.data.status, 'verified');
  const listing = await t.api(`/api/properties/${pid}`);
  assert.equal(listing.data.property.rera.status, 'verified');
  assert.equal((await t.api('/api/properties?reraVerified=1')).data.total, 1);

  // Changing the number resets verification.
  await t.api(`/api/properties/${pid}`, { method: 'PUT', token: builder, body: { rera: { number: 'RC/REP/HARERA/GGM/111/2025' } } });
  assert.equal((await t.api(`/api/rera/properties/${pid}`)).data.status, 'not-verified');

  assert.equal((await t.api(`/api/admin/rera/${rec._id}`, { method: 'PUT', token: agent, body: { status: 'verified' } })).status, 403);
});

/* ---------------- AI analysis ---------------- */

test('AI report: explained scores, honest data limits, cached', async () => {
  const list = await t.api('/api/properties?city=Gurugram&locality=DLF Phase 2&listingType=sale&propertyType=apartment&limit=5');
  const id = list.data.items[0].id;
  const r = await t.api(`/api/ai/properties/${id}/report`);
  assert.equal(r.status, 200);
  const rep = r.data;
  assert.equal(rep.scores.length, 8);
  for (const s of rep.scores) {
    assert.ok(s.label && s.method !== undefined && s.confidence, `score ${s.key} explained`);
    if (s.value !== null) assert.ok(s.value >= 0 && s.value <= 100);
  }
  assert.ok(['below-market', 'near-market', 'above-market'].includes(rep.price.position.verdict));
  assert.ok(rep.price.comparables.n >= 3);
  assert.equal(rep.price.basis, 'asking-prices');
  assert.equal(rep.nearby.provider, 'fixture');
  assert.equal(rep.nearby.distanceMethod, 'straight-line');
  assert.match(rep.disclaimer, /not guarantees/);
  assert.ok(rep.limitations.some((l) => /asking prices/.test(l)));
  assert.ok(rep.narrative.watchouts.some((w) => /demo listing/.test(w)));
  const again = await t.api(`/api/ai/properties/${id}/report`);
  assert.equal(again.data.cached, true);
  // Refresh is restricted to the lister/admin.
  assert.equal((await t.api(`/api/ai/properties/${id}/report?refresh=1`, { token: buyer })).status, 403);
  // Personalisation re-weights without recomputing evidence.
  const fam = await t.api(`/api/ai/properties/${id}/report?priorities=family&budgetMax=10000000`);
  assert.deepEqual(fam.data.personalized.priorities, ['family']);
  assert.equal(typeof fam.data.personalized.budget.fits, 'boolean');
});

test('AI report: missing data yields null scores, not perfect or failing ones', async () => {
  const created = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ title: 'Isolated plot far away', propertyType: 'plot', bedrooms: 0, bathrooms: 0, carpetAreaSqft: null, city: 'Shillong', locality: 'Laitumkhrah', location: null, price: 5000000, areaSqft: 2000 }) });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const r = await t.api(`/api/ai/properties/${created.data.id}/report`);
  const by = Object.fromEntries(r.data.scores.map((s) => [s.key, s]));
  assert.equal(by.connectivity.value, null);
  assert.equal(by.price.value, null);
  assert.equal(r.data.price.position.verdict, 'insufficient-data');
  assert.equal(r.data.nearby.status, 'no-coordinates');
  assert.equal(r.data.overall.value, null);
  assert.equal(r.data.rental.applicable, false);
});

test('AI: provider failure falls back to rules instead of erroring', async () => {
  process.env.AI_API_KEY = 'fake-key';
  process.env.AI_PROVIDER = 'not-a-provider';
  try {
    const list = await t.api('/api/properties?city=Noida&limit=1');
    const r = await t.api(`/api/ai/properties/${list.data.items[0].id}/report`);
    assert.equal(r.status, 200);
    assert.equal(r.data.narrative.source, 'rules');
    const m = await t.api(`/api/ai/properties/${list.data.items[0].id}/marketing`);
    assert.equal(m.data.source, 'heuristic');
  } finally {
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;
  }
});

test('AI compare: requires two properties and returns conditional comparison', async () => {
  const list = await t.api('/api/properties?city=Bengaluru&listingType=sale&propertyType=apartment&limit=3');
  const ids = list.data.items.slice(0, 2).map((p) => p.id);
  assert.equal((await t.api('/api/ai/compare', { method: 'POST', body: { ids: [ids[0]] } })).status, 400);
  const r = await t.api('/api/ai/compare', { method: 'POST', body: { ids, priorities: ['commute'] } });
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 2);
  assert.match(r.data.summary.text, /not a recommendation for everyone|tie|leads overall|not enough data/);
});

test('AI description drafting is for listers only', async () => {
  const body = { propertyType: 'apartment', listingType: 'sale', bedrooms: 2, bathrooms: 2, areaSqft: 1100, city: 'Pune', locality: 'Baner', price: 9000000 };
  assert.equal((await t.api('/api/ai/draft-description', { method: 'POST', token: buyer, body })).status, 403);
  const r = await t.api('/api/ai/draft-description', { method: 'POST', token: agent, body });
  assert.match(r.data.description, /Baner, Pune/);
});

/* ---------------- chat assistant ---------------- */

async function chat(body, token) {
  const res = await t.api('/api/chat', { method: 'POST', body: { sessionId: 'testsession01', ...body }, token, raw: true });
  assert.equal(res.headers.get('content-type').split(';')[0], 'text/event-stream');
  const events = parseSSE(await res.text());
  const meta = events.find((e) => e.event === 'meta')?.data;
  const text = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
  return { events, meta, text, done: events.find((e) => e.event === 'done')?.data };
}

test('chat: natural-language search retrieves real matching listings', async () => {
  const r = await chat({ message: 'Find a 3 BHK flat in Gurgaon under ₹4 crore' });
  assert.equal(r.meta.intent, 'search');
  assert.ok(r.meta.cards.length > 0);
  const db = await t.api('/api/properties?city=Gurugram&bedrooms=3&maxPrice=40000000&propertyType=apartment&limit=50');
  const ids = new Set(db.data.items.map((p) => p.id));
  assert.ok(r.meta.cards.every((c) => ids.has(c.id)), 'every card is a real matching listing');
  assert.match(r.text, /found \d+ active listing/);
  assert.equal(r.done.source, 'rules');
});

test('chat: no results is stated honestly', async () => {
  const r = await chat({ message: 'Show me 5 BHK villas in Pune under 10 lakh' }, null);
  assert.equal(r.meta.cards.length, 0);
  assert.match(r.text, /couldn't find/);
});

test('chat: property-context questions use the report (RERA, schools, price)', async () => {
  const list = await t.api('/api/properties?constructionStatus=under-construction&city=Noida&limit=1');
  const pid = list.data.items[0].id;
  const rera = await chat({ message: 'Is this project’s RERA registration verified?', propertyId: pid });
  assert.equal(rera.meta.intent, 'rera');
  assert.match(rera.text, /Not yet verified/);
  assert.ok(!/RERA approved/i.test(rera.text));
  const schools = await chat({ message: 'Are there good schools within 3 km?', propertyId: pid });
  assert.match(schools.text, /Fixture Public School/);
  assert.match(schools.text, /straight-line/);
  const kb = await chat({ message: 'What should I verify before paying a booking amount?' });
  assert.ok(kb.meta.citations.some((c) => c.type === 'kb'));
});

test('chat: realtor tools only see their own data', async () => {
  const r = await chat({ message: 'show my leads' }, agent);
  assert.equal(r.meta.intent, 'my-leads');
  const b = await chat({ message: 'show my leads' }, buyer);
  assert.notEqual(b.meta.intent, 'my-leads');
});

test('chat: conversation history persists per session', async () => {
  const h = await t.api('/api/chat/history?sessionId=testsession01');
  assert.ok(h.data.messages.length >= 2);
  assert.equal(h.data.messages[0].role, 'user');
});

/* ---------------- admin ---------------- */

test('admin endpoints are admin-only; suspensions need confirmation and block login', async () => {
  for (const tok of [null, buyer, agent, builder]) {
    assert.ok([401, 403].includes((await t.api('/api/admin/stats', { token: tok })).status));
  }
  const s = await t.api('/api/admin/stats', { token: admin });
  assert.ok(s.data.listings > 0);
  const victim = await t.register({ role: 'agent' });
  const users = await t.api(`/api/admin/users?q=${encodeURIComponent(victim.email)}`, { token: admin });
  const uid = users.data.items[0]._id;
  assert.equal((await t.api(`/api/admin/users/${uid}`, { method: 'PATCH', token: admin, body: { status: 'suspended', reason: 'Spam listings' } })).status, 400);
  assert.equal((await t.api(`/api/admin/users/${uid}`, { method: 'PATCH', token: admin, body: { status: 'suspended', confirm: true } })).status, 400, 'reason required');
  assert.equal((await t.api(`/api/admin/users/${uid}`, { method: 'PATCH', token: admin, body: { status: 'suspended', reason: 'Spam listings', confirm: true } })).status, 200);
  assert.equal((await t.api('/api/auth/login', { method: 'POST', body: { email: victim.email, password: 'Secret123' } })).status, 403);
  assert.equal((await t.api('/api/auth/me', { token: victim.token })).status, 403, 'existing tokens stop working');
  const integ = await t.api('/api/admin/integrations', { token: admin });
  assert.equal(integ.data.configured.llm.enabled, false);
  const del = await t.api(`/api/admin/listings/${(await t.api('/api/properties?limit=1')).data.items[0].id}`, { method: 'DELETE', token: admin, body: { reason: 'x' } });
  assert.equal(del.status, 400, 'deletion needs typed confirmation');
});

/* ---------------- uploads, misc ---------------- */

test('uploads validate file content, not just the declared type', async () => {
  const fd = new FormData();
  fd.append('images', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'image/png' }), 'evil.png');
  assert.equal((await t.api('/api/uploads', { method: 'POST', token: owner, body: fd })).status, 400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  const ok = new FormData();
  ok.append('images', new Blob([png], { type: 'image/png' }), 'real.png');
  const r = await t.api('/api/uploads', { method: 'POST', token: owner, body: ok });
  assert.equal(r.status, 201);
  assert.equal((await t.api(r.data.urls[0], { raw: true })).status, 200);
});

test('public stats are real counts; sitemap, robots and projects are served', async () => {
  const s = await t.api('/api/stats');
  assert.ok(s.data.listings > 0 && s.data.demoListings > 0);
  const sm = await t.api('/sitemap.xml', { raw: true });
  assert.equal(sm.status, 200);
  assert.match(await sm.text(), /<urlset/);
  assert.equal((await t.api('/robots.txt', { raw: true })).status, 200);
  const projects = await t.api('/api/projects');
  assert.ok(projects.data.items.length >= 3);
  const one = await t.api(`/api/projects/${projects.data.items[0].slug}`);
  assert.ok(one.data.rera && one.data.listings);
  assert.equal(one.data.developer.descriptionIsClaim, true);
  const loc = await t.api('/api/localities/Gurugram/DLF%20Phase%202/insights');
  assert.ok(loc.data.segments.length > 0);
  assert.equal(loc.data.nearby.status, 'ok');
  const contact = await t.api('/api/contact', { method: 'POST', body: { name: 'A', email: 'a@b.in', message: 'Please help with my listing.' } });
  assert.equal(contact.status, 201);
});

test('unknown routes and malformed JSON return clean errors', async () => {
  assert.equal((await t.api('/api/nope')).status, 404);
  const res = await fetch(`${t.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  assert.equal(res.status, 400);
  assert.equal((await t.api('/api/properties/not-a-real-slug')).status, 404);
});
