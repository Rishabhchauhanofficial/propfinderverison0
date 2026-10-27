import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import Property from '../models/Property.js';
import { ReraRecord } from '../models/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/controllers -> server/uploads (public photos) and server/uploads-private (documents)
export const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.resolve(__dirname, '../../uploads'));
export const PRIVATE_DIR = path.resolve(process.env.PRIVATE_UPLOADS_DIR || path.resolve(__dirname, '../../uploads-private'));

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_DIR, { recursive: true });

// Detect type from file content, not the client-supplied mimetype/extension.
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') return { mime: 'image/gif', ext: '.gif' };
  if (buf.slice(4, 12).toString('ascii') === 'ftypavif') return { mime: 'image/avif', ext: '.avif' };
  if (buf.slice(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  return null;
}

const memory = (maxFiles, maxMb) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles } });

const imageUpload = memory(12, 5).array('images', 12);
const docUpload = memory(5, 10).array('files', 5);

const newName = (ext) => `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

function multerError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return 'File is too large.';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return 'Too many files.';
  return err.message;
}

// POST /api/uploads (field "images") -> { urls: [...] }  — public listing photos.
export function handleUpload(req, res) {
  imageUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5MB or smaller.' : multerError(err) });
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No images received.' });
    const urls = [];
    for (const f of files) {
      const kind = sniff(f.buffer);
      if (!kind || !kind.mime.startsWith('image/')) {
        return res.status(400).json({ error: 'Only image files (jpg, png, webp, gif, avif) are allowed.' });
      }
      const name = newName(kind.ext);
      fs.writeFileSync(path.join(UPLOADS_DIR, name), f.buffer);
      urls.push(`/uploads/${name}`);
    }
    return res.status(201).json({ urls });
  });
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
