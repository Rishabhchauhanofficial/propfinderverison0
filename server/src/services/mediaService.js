/*
 * Who sees which media.
 *  - Signed out: the first PUBLIC_IMAGE_COUNT photos (default 2) and counts of the rest. No videos,
 *    brochures or video link.
 *  - Signed in: every photo, plus videos and brochures through short-lived signed links (a <video>
 *    or download link cannot send the login token, so the link itself carries a user-bound signature).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { Upload } from '../models/index.js';
import { badRequest } from '../utils/http.js';

export const PUBLIC_IMAGE_COUNT = Math.max(0, Number(process.env.PUBLIC_IMAGE_COUNT ?? 2));
const LINK_TTL_SECONDS = 60 * 60 * 2;
const MEDIA_URL = /^\/api\/media\/[\w-]+\.(mp4|webm|mov|pdf)$/;

const secret = () => process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const signature = (name, userId, exp) => crypto.createHmac('sha256', secret()).update(`media:${name}:${userId}:${exp}`).digest('base64url');

/** "/api/media/x.mp4" → "/api/media/x.mp4?u=<user>&e=<expiry>&s=<signature>" */
export function signMediaUrl(url, userId, ttl = LINK_TTL_SECONDS) {
  const name = path.basename(url);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return `${url}?u=${userId}&e=${exp}&s=${signature(name, String(userId), exp)}`;
}

/** Valid, unexpired signature for this file → the user id it was issued to; otherwise null. */
export function verifyMediaSignature(name, { u, e, s } = {}) {
  const exp = Number(e);
  if (!u || !s || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const expected = Buffer.from(signature(name, String(u), exp));
  const given = Buffer.from(String(s));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? String(u) : null;
}

/** Apply the signed-in / signed-out rules to a serialised property or project. */
export function gateMedia(o, { userId } = {}) {
  const images = o.images || [];
  const videos = o.videos || [];
  const brochures = o.brochures || [];
  const counts = { images: images.length, videos: videos.length + (o.videoUrl ? 1 : 0), brochures: brochures.length };
  if (!userId) {
    return { ...o, images: images.slice(0, PUBLIC_IMAGE_COUNT), videos: [], brochures: [], videoUrl: '', media: { locked: true, ...counts } };
  }
  const sign = (f) => ({ ...f, src: signMediaUrl(f.url, userId) });
  return { ...o, videos: videos.map(sign), brochures: brochures.map(sign), media: { locked: false, ...counts } };
}

/** Search cards show at most the public photos to everyone, plus the total. */
export function cardImages(images = []) {
  return { images: images.slice(0, PUBLIC_IMAGE_COUNT), imageCount: images.length };
}

const cleanName = (n, fallback) => String(n || fallback).replace(/[^\w.\- ()]/g, '').slice(0, 100) || fallback;

/**
 * Check media a listing or project is about to reference. Files already on it stay as they are;
 * new ones must be uploads by this user (any user for admins), and photos must have passed the
 * phone-number scan. Returns cleaned { images, videos, brochures } for the fields that were sent.
 */
export async function validateMedia(next, prev = {}, { userId, isAdmin = false } = {}) {
  const out = {};
  const owned = async (urls, kind) => {
    if (!urls.length) return new Map();
    const rows = await Upload.find({ url: { $in: urls }, kind, ...(isAdmin ? {} : { owner: userId }) }).lean();
    return new Map(rows.map((r) => [r.url, r]));
  };

  if (next.images !== undefined) {
    const before = new Set(prev.images || []);
    const images = (Array.isArray(next.images) ? next.images : []).map(String).slice(0, 20);
    const fresh = images.filter((u) => !before.has(u));
    // Links to outside images can't be scanned, so only admins may add them.
    const external = fresh.filter((u) => !u.startsWith('/uploads/'));
    if (external.length && !isAdmin) throw badRequest('Upload photos from your device; image links can no longer be added.');
    const rows = await owned(fresh.filter((u) => u.startsWith('/uploads/')), 'image');
    for (const u of fresh.filter((x) => x.startsWith('/uploads/'))) {
      const row = rows.get(u);
      if (!row) throw badRequest('One of the photos was not uploaded from this account.');
      if (row.scan?.status === 'phone-found') throw badRequest('One of the photos shows a phone number. Remove it and upload a clean photo.');
    }
    out.images = images.filter((u) => before.has(u) || u.startsWith('/uploads/') || isAdmin);
  }

  for (const [field, kind, max] of [['videos', 'video', 5], ['brochures', 'brochure', 5]]) {
    if (next[field] === undefined) continue;
    const before = new Map((prev[field] || []).map((f) => [f.url, f]));
    const list = (Array.isArray(next[field]) ? next[field] : []).filter((f) => f && MEDIA_URL.test(String(f.url))).slice(0, max);
    const rows = await owned(list.filter((f) => !before.has(f.url)).map((f) => f.url), kind);
    out[field] = list.map((f) => {
      if (before.has(f.url)) return { url: f.url, name: cleanName(f.name, before.get(f.url).name), size: before.get(f.url).size };
      const row = rows.get(f.url);
      if (!row) throw badRequest(`One of the ${field} was not uploaded from this account.`);
      return { url: row.url, name: cleanName(f.name, row.originalName || kind), size: row.size };
    });
  }
  return out;
}
