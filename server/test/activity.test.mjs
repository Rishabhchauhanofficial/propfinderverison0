// Opt-in buyer activity: consent, what is recorded, who may see it, and opting out.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

const { default: Property } = await import('../src/models/Property.js');
const { default: User } = await import('../src/models/User.js');
const { ActivityEvent } = await import('../src/models/index.js');
const { preferencesFrom } = await import('../src/services/activityService.js');

let t;
let agent;
let owner;
let agentId;
let ownerId;
before(async () => {
  t = await startServer();
  [agent, owner] = await Promise.all([t.login('agent@propfinder.in'), t.login('priya@example.com')]);
  agentId = (await User.findOne({ email: 'agent@propfinder.in' }).lean())._id;
  ownerId = (await User.findOne({ email: 'priya@example.com' }).lean())._id;
});
after(async () => t.stop());

// Recording is fire-and-forget; wait until the expected number of events has landed.
async function events(userId, n) {
  for (let i = 0; i < 50; i++) {
    const rows = await ActivityEvent.find({ user: userId }).lean();
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return ActivityEvent.find({ user: userId }).lean();
}

test('nothing is recorded without consent, and only a literal true at sign-up counts', async () => {
  const quiet = await t.register({ shareActivity: 'true' });
  assert.equal(quiet.user.activitySharing.enabled, false);
  const p = await Property.findOne({ owner: agentId, status: 'active' }).lean();
  await t.api(`/api/properties/${p._id}`, { token: quiet.token });
  await t.api('/api/properties?city=Pune', { token: quiet.token });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await ActivityEvent.countDocuments({ user: quiet.user.id }), 0);
  assert.equal((await t.api('/api/me/activity', { token: quiet.token })).data.sharing, false);
});

test('a consenting buyer\'s activity reaches the lister they contacted, other listers\' details stay general', async () => {
  const buyer = await t.register({ name: 'Asha Buyer', shareActivity: true });
  assert.equal(buyer.user.activitySharing.enabled, true);

  const mine = await Property.findOne({ owner: agentId, status: 'active', listingType: 'sale' }).lean();
  const other = await Property.findOne({ owner: ownerId, status: 'active' }).lean();
  await t.api('/api/properties?city=Pune&bedrooms=3&maxPrice=20000000', { token: buyer.token });
  await t.api('/api/properties?city=Pune&bedrooms=3&maxPrice=20000000', { token: buyer.token }); // same search: kept once
  await t.api(`/api/properties/${mine._id}`, { token: buyer.token });
  await t.api(`/api/properties/${mine._id}`, { token: buyer.token }); // repeat view within 30 min: kept once
  await t.api(`/api/properties/${other._id}`, { token: buyer.token });
  await t.api(`/api/me/favorites/${other._id}`, { method: 'POST', token: buyer.token });
  const c = await t.api(`/api/properties/${mine._id}/contact`, { method: 'POST', token: buyer.token, body: { message: 'Is it available?' } });
  assert.equal(c.status, 201);
  await events(buyer.user.id, 5);

  const leads = await t.api('/api/leads', { token: agent });
  const lead = leads.data.items.find((l) => String(l.buyer) === String(buyer.user.id));
  assert.equal(lead.buyerSharesActivity, true);

  const act = await t.api(`/api/leads/buyers/${buyer.user.id}/activity`, { token: agent });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal(act.data.sharing, true);
  assert.deepEqual(
    { viewed: act.data.summary.propertiesViewed, views: act.data.summary.views, saves: act.data.summary.saves, enquiries: act.data.summary.enquiries, searches: act.data.summary.searches },
    { viewed: 2, views: 2, saves: 1, enquiries: 1, searches: 1 }
  );
  const own = act.data.timeline.filter((e) => e.yourListing);
  assert.ok(own.some((e) => e.type === 'contact' && e.property.title === mine.title));
  const theirs = act.data.timeline.filter((e) => e.yourListing === false);
  assert.ok(theirs.length >= 2);
  for (const e of theirs) {
    assert.equal(e.property, undefined);
    assert.ok(!e.text.includes(other.title), e.text); // never names the other lister's listing
  }
  assert.ok(act.data.timeline.some((e) => e.type === 'search' && /3\+ BHK/.test(e.text) && /Pune/.test(e.text)));
  assert.ok(act.data.preferences.cities.length > 0);

  // A lister the buyer never contacted sees nothing.
  assert.equal((await t.api(`/api/leads/buyers/${buyer.user.id}/activity`, { token: owner })).status, 403);
  // Buyers can't use the lister endpoint.
  assert.equal((await t.api(`/api/leads/buyers/${buyer.user.id}/activity`, { token: buyer.token })).status, 403);

  // The buyer sees their own full log.
  const self = await t.api('/api/me/activity', { token: buyer.token });
  assert.equal(self.data.sharing, true);
  assert.ok(self.data.timeline.some((e) => e.text.includes(other.title)));

  // Opting out deletes the log and hides it from the lister.
  const off = await t.api('/api/me/activity-sharing', { method: 'PUT', token: buyer.token, body: { enabled: false } });
  assert.equal(off.data.enabled, false);
  assert.equal(await ActivityEvent.countDocuments({ user: buyer.user.id }), 0);
  assert.deepEqual((await t.api(`/api/leads/buyers/${buyer.user.id}/activity`, { token: agent })).data, { sharing: false, windowDays: 30 });

  // Opting back in from the profile records consent again.
  const on = await t.api('/api/me/activity-sharing', { method: 'PUT', token: buyer.token, body: { enabled: true } });
  assert.equal(on.data.enabled, true);
  assert.ok(on.data.consentedAt);
});

test('preferences: intent, places and the middle of the budget they looked at', () => {
  const ev = (type, meta) => ({ type, meta });
  const prefs = preferencesFrom([
    ev('view', { city: 'Pune', locality: 'Baner', listingType: 'sale', propertyType: 'apartment', bedrooms: 3, price: 10000000 }),
    ev('view', { city: 'Pune', locality: 'Baner', listingType: 'sale', propertyType: 'apartment', bedrooms: 3, price: 12000000 }),
    ev('save', { city: 'Pune', locality: 'Kothrud', listingType: 'sale', propertyType: 'apartment', bedrooms: 2, price: 14000000 }),
    ev('view', { city: 'Mumbai', listingType: 'rent', propertyType: 'apartment', bedrooms: 1, price: 40000 }),
    ev('search', { city: 'Pune', listingType: 'sale', bedrooms: '3' }),
  ]);
  assert.equal(prefs.lookingTo, 'buy');
  assert.deepEqual(prefs.cities[0], { value: 'Pune', count: 4 });
  assert.equal(prefs.localities[0].value, 'Baner');
  assert.deepEqual(prefs.budget, { low: 11000000, high: 13000000, basedOn: 3 }); // rent price ignored
  assert.equal(preferencesFrom([ev('view', { price: 5000000, listingType: 'sale' })]).budget, null); // too few to say
  assert.equal(preferencesFrom([ev('view', { listingType: 'sale' }), ev('save', { listingType: 'rent' })]).lookingTo, 'buy or rent');
});
