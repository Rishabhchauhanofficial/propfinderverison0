// Media access (photos, videos, brochures behind login) and the phone-number check on photos and text.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sampleListing } from './helpers.mjs';

const { findPhoneNumbers } = await import('../src/services/phoneScan.js');

let t;
let owner;
let agent;
let buyer;
before(async () => {
  t = await startServer();
  [owner, agent, buyer] = await Promise.all([t.login('priya@example.com'), t.login('agent@propfinder.in'), t.login('demo@propfinder.in')]);
});
after(async () => t.stop());

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
// A real PNG whose "OCR text" (test stand-in) is the given string.
const photo = (text = '') => Buffer.concat([PNG, Buffer.from(text ? `OCRTEXT:${text}` : '')]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)]);
const PDF = Buffer.from('%PDF-1.4\n% test brochure\n%%EOF\n');

async function upload(path, field, files, token = owner) {
  const fd = new FormData();
  for (const [buf, name, type] of files) fd.append(field, new Blob([buf], { type }), name);
  return t.api(path, { method: 'POST', token, body: fd });
}
const uploadPhotos = (texts, token) => upload('/api/uploads', 'images', texts.map((x, i) => [photo(x), `p${i}.png`, 'image/png']), token);

test('phone detection: Indian formats and OCR slips found; prices, areas and IDs ignored', () => {
  for (const s of ['Call 98765 43210', '+91-98765-43210', '098765 43210', 'Mob: 98765.43210', 'Call 9876S 4321O', 'Office 011 2345 6789', 'Toll free 1800 123 4567']) {
    assert.equal(findPhoneNumbers(s).length, 1, s);
  }
  for (const s of ['Price 1.25 Cr', '₹ 75,00,000', '2400 sq ft, 3 BHK, floor 12 of 20', 'RERA P52100012345', 'Sector 62 Noida 201309', 'Sole selling', '']) {
    assert.deepEqual(findPhoneNumbers(s), [], s);
  }
  assert.deepEqual(findPhoneNumbers('Call 98765 43210'), ['98••••••10']);
});

test('photos showing a phone number are refused; clean ones are accepted', async () => {
  const bad = await uploadPhotos(['FOR SALE call 98765 43210']);
  assert.equal(bad.status, 422);
  assert.match(bad.data.error, /phone number \(98••••••10\)/);
  assert.doesNotMatch(bad.data.error, /98765/);

  const mixed = await uploadPhotos(['Living room', 'WhatsApp +91 99887 76655']);
  assert.equal(mixed.status, 201);
  assert.equal(mixed.data.urls.length, 1);
  assert.equal(mixed.data.rejected.length, 1);
});

test('listings only take the lister\'s own scanned uploads, and no phone numbers in text', async () => {
  const external = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ images: ['https://example.com/x.jpg'] }) });
  assert.equal(external.status, 400);
  assert.match(external.data.error, /Upload photos/);

  const someoneElses = (await uploadPhotos(['kitchen'], agent)).data.urls;
  const stolen = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ images: someoneElses }) });
  assert.equal(stolen.status, 400);

  const inText = await t.api('/api/properties', { method: 'POST', token: owner, body: sampleListing({ description: 'Great flat, call me on 98765-43210 anytime' }) });
  assert.equal(inText.status, 400);
  assert.match(inText.data.error, /phone numbers/);
});

test('signed out: two photos and counts; signed in: everything, through signed links', async () => {
  const images = (await uploadPhotos(['one', 'two', 'three', 'four'])).data.urls;
  const videos = (await upload('/api/uploads/videos', 'videos', [[MP4, 'tour.mp4', 'video/mp4']])).data.files;
  const brochures = (await upload('/api/uploads/brochures', 'brochures', [[PDF, 'brochure.pdf', 'application/pdf']])).data.files;
  assert.equal(videos.length, 1);
  assert.equal(brochures.length, 1);
  assert.equal((await upload('/api/uploads/videos', 'videos', [[PDF, 'fake.mp4', 'video/mp4']])).status, 400);
  assert.equal((await upload('/api/uploads/brochures', 'brochures', [[MP4, 'fake.pdf', 'application/pdf']])).status, 400);

  const created = await t.api('/api/properties', {
    method: 'POST',
    token: owner,
    body: sampleListing({ title: 'Media test flat in Sector 54', images, videos, brochures, videoUrl: 'https://www.youtube.com/watch?v=test' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id || created.data._id;

  const anon = (await t.api(`/api/properties/${id}`)).data.property;
  assert.equal(anon.images.length, 2);
  assert.deepEqual(anon.videos, []);
  assert.deepEqual(anon.brochures, []);
  assert.equal(anon.videoUrl, '');
  assert.deepEqual(anon.media, { locked: true, images: 4, videos: 2, brochures: 1 });

  const seen = (await t.api(`/api/properties/${id}`, { token: buyer })).data.property;
  assert.equal(seen.images.length, 4);
  assert.equal(seen.media.locked, false);
  assert.equal(seen.videoUrl, 'https://www.youtube.com/watch?v=test');
  const { src } = seen.videos[0];
  assert.match(src, /^\/api\/media\/[\w-]+\.mp4\?u=.+&e=\d+&s=/);

  const file = await t.api(src, { raw: true });
  assert.equal(file.status, 200);
  assert.equal(Buffer.from(await file.arrayBuffer()).length, MP4.length);
  assert.equal((await t.api(src, { raw: true, headers: { Range: 'bytes=0-9' } })).status, 206);
  assert.equal((await t.api(seen.videos[0].url, { raw: true })).status, 401); // no signature
  assert.equal((await t.api(src.replace(/s=[^&]+/, 's=forged'), { raw: true })).status, 401);
  assert.equal((await t.api(src.replace(/e=\d+/, 'e=1'), { raw: true })).status, 401); // expired / tampered
  assert.equal((await t.api(seen.brochures[0].src, { raw: true })).status, 200);

  // Search cards never carry more than the public photos.
  const card = (await t.api('/api/properties?q=Media test flat')).data.items[0];
  assert.equal(card.images.length, 2);
  assert.equal(card.imageCount, 4);

  // Editing keeps existing media without re-checking it.
  const edit = await t.api(`/api/properties/${id}`, { method: 'PUT', token: owner, body: { images: images.slice(0, 3), price: 26000000 } });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
});

test('compare and projects follow the same rules', async () => {
  const list = (await t.api('/api/properties?city=Gurugram&limit=2')).data.items;
  const cmp = await t.api('/api/ai/compare', { method: 'POST', body: { ids: list.map((p) => p.id) } });
  assert.ok(cmp.data.items.every((i) => i.property.images.length <= 2 && i.property.media.locked));

  const slug = (await t.api('/api/projects')).data.items[0].slug;
  const anon = (await t.api(`/api/projects/${slug}`)).data.project;
  assert.equal(anon.media.locked, true);
  assert.ok(anon.images.length <= 2);
  assert.equal((await t.api(`/api/projects/${slug}`, { token: buyer })).data.project.media.locked, false);
});
