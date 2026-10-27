import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import Property from '../models/Property.js';
import User from '../models/User.js';
import { ReraRecord, Upload } from '../models/index.js';
import { scanImage } from '../services/phoneScan.js';
import { verifyMediaSignature } from '../services/mediaService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/controllers -> server/uploads (public photos) and server/uploads-private (documents)
export const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.resolve(__dirname, '../../uploads'));
export const PRIVATE_DIR = path.resolve(process.env.PRIVATE_UPLOADS_DIR || path.resolve(__dirname, '../../uploads-private'));

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_DIR, { recursive: true });
// Videos and brochures: private, served only through signed links (GET /api/media/:name).
export const MEDIA_DIR = path.join(PRIVATE_DIR, 'media');
const TMP_DIR = path.join(PRIVATE_DIR, 'tmp');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Detect type from file content, not the client-supplied mimetype/extension.
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') return { mime: 'image/gif', ext: '.gif' };
  if (buf.slice(4, 12).toString('ascii') === 'ftypavif') return { mime: 'image/avif', ext: '.avif' };
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: '.mov' };
    if (!['avis', 'heic', 'heix', 'mif1', 'msf1'].includes(brand)) return { mime: 'video/mp4', ext: '.mp4' };
  }
  if (buf.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mime: 'video/webm', ext: '.webm' };
  if (buf.slice(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  return null;
}

const memory = (maxFiles, maxMb) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles } });

const imageUpload = memory(12, 5).array('images', 12);
const docUpload = memory(5, 10).array('files', 5);
const brochureUpload = memory(3, 25).array('brochures', 3);
// Videos go to disk (up to 100MB each) rather than memory.
const videoUpload = multer({ dest: TMP_DIR, limits: { fileSize: 100 * 1024 * 1024, files: 3 } }).array('videos', 3);
const originalName = (f, fallback) => String(f.originalname || fallback).replace(/[^\w.\- ()]/g, '').slice(0, 100) || fallback;

const newName = (ext) => `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

function multerError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return 'File is too large.';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return 'Too many files.';
  return err.message;
}

// POST /api/uploads (field "images") -> { urls, rejected } — public listing photos.
// Every photo is scanned for phone numbers; photos showing one are refused (contact goes through PropFinder).
export function handleUpload(req, res, next) {
  imageUpload(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5MB or smaller.' : multerError(err) });
      const files = req.files || [];
      if (files.length === 0) return res.status(400).json({ error: 'No images received.' });
      for (const f of files) {
        f.type = sniff(f.buffer);
        if (!f.type || !f.type.mime.startsWith('image/')) {
          return res.status(400).json({ error: 'Only image files (jpg, png, webp, gif, avif) are allowed.' });
        }
      }
      const urls = [];
      const rejected = [];
      for (const f of files) {
        const label = originalName(f, 'photo');
        const scan = await scanImage(f.buffer);
        if (scan.status === 'phone-found') {
          rejected.push({ name: label, reason: `Shows a phone number (${scan.found.join(', ')}). Remove it and upload again.` });
          continue;
        }
        const name = newName(f.type.ext);
        fs.writeFileSync(path.join(UPLOADS_DIR, name), f.buffer);
        const url = `/uploads/${name}`;
        await Upload.create({ name, url, kind: 'image', owner: req.userId, originalName: label, mime: f.type.mime, size: f.size, scan });
        urls.push(url);
      }
      if (!urls.length) return res.status(422).json({ error: rejected.map((r) => `${r.name}: ${r.reason}`).join(' '), rejected });
      return res.status(201).json({ urls, rejected });
    } catch (e) {
      return next(e);
    }
  });
}

// POST /api/uploads/videos (field "videos") -> { files: [{ url, name, size, mime }] } — private.
export function handleVideoUpload(req, res, next) {
  videoUpload(req, res, async (err) => {
    const files = req.files || [];
    const cleanup = () => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    try {
      if (err) {
        cleanup();
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each video must be 100MB or smaller.' : multerError(err) });
      }
      if (!files.length) return res.status(400).json({ error: 'No videos received.' });
      for (const f of files) {
        const head = Buffer.alloc(16);
        const fd = fs.openSync(f.path, 'r');
        fs.readSync(fd, head, 0, 16, 0);
        fs.closeSync(fd);
        f.type = sniff(head);
        if (!f.type || !f.type.mime.startsWith('video/')) {
          cleanup();
          return res.status(400).json({ error: 'Only MP4, WebM or MOV videos are allowed.' });
        }
      }
      const out = [];
      for (const f of files) {
        const name = newName(f.type.ext);
        fs.renameSync(f.path, path.join(MEDIA_DIR, name));
        const url = `/api/media/${name}`;
        const label = originalName(f, 'video');
        await Upload.create({ name, url, kind: 'video', owner: req.userId, originalName: label, mime: f.type.mime, size: f.size });
        out.push({ url, name: label, size: f.size, mime: f.type.mime });
      }
      return res.status(201).json({ files: out });
    } catch (e) {
      cleanup();
      return next(e);
    }
  });
}

// POST /api/uploads/brochures (field "brochures") -> { files: [{ url, name, size, mime }] } — private PDFs.
export function handleBrochureUpload(req, res, next) {
  brochureUpload(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each brochure must be 25MB or smaller.' : multerError(err) });
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'No brochures received.' });
      if (files.some((f) => sniff(f.buffer)?.mime !== 'application/pdf')) return res.status(400).json({ error: 'Brochures must be PDF files.' });
      const out = [];
      for (const f of files) {
        const name = newName('.pdf');
        fs.writeFileSync(path.join(MEDIA_DIR, name), f.buffer);
        const url = `/api/media/${name}`;
        const label = originalName(f, 'brochure.pdf');
        await Upload.create({ name, url, kind: 'brochure', owner: req.userId, originalName: label, mime: 'application/pdf', size: f.size });
        out.push({ url, name: label, size: f.size, mime: 'application/pdf' });
      }
      return res.status(201).json({ files: out });
    } catch (e) {
      return next(e);
    }
  });
}

// GET /api/media/:name?u=&e=&s= — videos and brochures, through a signed link issued to a signed-in user.
export async function serveMedia(req, res, next) {
  try {
    const name = path.basename(String(req.params.name || ''));
    if (!/^[\w-]+\.(mp4|webm|mov|pdf)$/.test(name)) return res.status(404).json({ error: 'Not found' });
    const userId = verifyMediaSignature(name, req.query);
    if (!userId) return res.status(401).json({ error: 'Sign in to view videos and brochures.' });
    const user = await User.findById(userId).select('status').lean();
    if (!user || user.status === 'suspended') return res.status(403).json({ error: 'Your account cannot view this file.' });
    const full = path.join(MEDIA_DIR, name);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
    res.set('Cache-Control', 'private, max-age=600');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    if (name.endsWith('.pdf')) res.set('Content-Disposition', 'inline');
    return res.sendFile(full); // handles Range requests, so videos can seek
  } catch (err) {
    return next(err);
  }
}

// POST /api/uploads/documents (field "files") -> { files: [{url, name, mime}] }  — private PDFs/images.
export function handleDocumentUpload(req, res) {
  docUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each document must be 10MB or smaller.' : multerError(err) });
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files received.' });
    const out = [];
    for (const f of files) {
      const kind = sniff(f.buffer);
      if (!kind) return res.status(400).json({ error: 'Only PDF or image documents are allowed.' });
      const name = newName(kind.ext);
      fs.writeFileSync(path.join(PRIVATE_DIR, name), f.buffer);
      out.push({ url: `/api/files/${name}`, name: String(f.originalname || 'document').replace(/[^\w.\- ]/g, '').slice(0, 100), mime: kind.mime });
    }
    return res.status(201).json({ files: out });
  });
}

// GET /api/files/:name — only the uploader/listing owner or an admin.
export async function servePrivateFile(req, res, next) {
  try {
    const name = path.basename(String(req.params.name || ''));
    if (!/^[\w-]+\.(pdf|jpg|png|webp|gif|avif)$/.test(name)) return res.status(404).json({ error: 'Not found' });
    const url = `/api/files/${name}`;
    let allowed = req.role === 'admin';
    if (!allowed) {
      allowed = Boolean(
        (await Property.exists({ owner: req.userId, 'documents.url': url })) ||
          (await ReraRecord.exists({ evidence: { $elemMatch: { url, uploadedBy: req.userId } } }))
      );
    }
    if (!allowed) return res.status(403).json({ error: 'You do not have access to this file.' });
    const full = path.join(PRIVATE_DIR, name);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.sendFile(full);
  } catch (err) {
    return next(err);
  }
}
