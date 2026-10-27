/*
 * Finds phone numbers in listing photos (OCR) and text, so contact details can't bypass
 * PropFinder's lead flow. Indian mobiles, landlines with STD code and 1800 toll-free numbers.
 *
 * PHONE_SCAN=ocr (default) uses Tesseract (tesseract.js; English language data is downloaded once
 * and cached in server/.tmp/tesseract). PHONE_SCAN=off skips the check (images are marked
 * "unscanned"). PHONE_SCAN=fixture is for tests: the "OCR text" is whatever follows
 * "OCRTEXT:" at the end of the file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(process.env.OCR_CACHE_DIR || path.resolve(__dirname, '../../.tmp/tesseract'));
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 20000;

// Characters OCR commonly reads in place of digits.
const CONFUSABLE = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', i: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', z: '2' };

function asDigits(token) {
  const t = token.replace(/^\+/, '');
  if (!t) return null;
  let digits = 0;
  let out = '';
  for (const ch of t) {
    if (ch >= '0' && ch <= '9') {
      digits++;
      out += ch;
    } else if (CONFUSABLE[ch]) out += CONFUSABLE[ch];
    else return null;
  }
  // Mostly real digits, so words like "Sole" or "Oil" never turn into numbers.
  return digits >= Math.ceil(t.length * 0.6) ? out : null;
}

/** The number without country code or trunk 0 when d is a phone number; otherwise null. */
function asPhone(d) {
  let n = d;
  if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
  else if (n.length === 13 && n.startsWith('091')) n = n.slice(3);
  if (/^0?[6-9]\d{9}$/.test(n)) return n.slice(-10); // mobile
  if (/^0[1-9]\d{9}$/.test(n)) return n; // landline with STD code, e.g. 011 2345 6789
  if (/^1800\d{6,7}$/.test(n)) return n; // toll-free
  return null;
}

export const maskPhone = (d) => `${d.slice(0, 2)}${'•'.repeat(Math.max(0, d.length - 4))}${d.slice(-2)}`;

/**
 * Phone numbers in free text, masked ("98••••••10"). Groups of up to 4 adjacent numeric tokens
 * are joined, so "98765 43210", "+91-98765-43210" and "98765.43210" are all found, but only when
 * the whole group is a phone number (a 10-digit run inside a longer number does not count).
 */
export function findPhoneNumbers(text) {
  const tokens = String(text || '').split(/[^0-9A-Za-z+|]+/).filter(Boolean);
  const nums = tokens.map(asDigits);
  const found = new Set();
  for (let i = 0; i < nums.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(nums.length, i + 4) && nums[j] !== null; j++) {
      joined += nums[j];
      if (joined.length > 13) break;
      const phone = asPhone(joined);
      if (phone) {
        found.add(maskPhone(phone));
        i = j; // continue after this number
        break;
      }
    }
  }
  return [...found];
}

export const containsPhone = (text) => findPhoneNumbers(text).length > 0;

/* ---------------- OCR ---------------- */

let workerPromise = null;
let customExtractor = null;

/** Tests can swap the OCR engine for a function (buffer) => text. */
export function setTextExtractor(fn) {
  customExtractor = fn;
}

async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, { cachePath: CACHE_DIR });
    })().catch((err) => {
      workerPromise = null; // retry on the next upload
      throw err;
    });
  }
  return workerPromise;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('OCR timed out')), ms)))]).finally(() =>
    clearTimeout(timer)
  );
}

async function extractText(buffer) {
  if (customExtractor) return customExtractor(buffer);
  const mode = process.env.PHONE_SCAN || 'ocr';
  if (mode === 'fixture') {
    const s = buffer.toString('latin1');
    const at = s.lastIndexOf('OCRTEXT:');
    return at === -1 ? '' : s.slice(at + 8);
  }
  const worker = await ocrWorker();
  const { data } = await withTimeout(worker.recognize(buffer), OCR_TIMEOUT_MS);
  return data?.text || '';
}

/**
 * Scan one image. Returns { status, found, engine }:
 *   clean | phone-found | unscanned (scanning switched off, or OCR failed — logged, not blocking).
 */
export async function scanImage(buffer) {
  const mode = process.env.PHONE_SCAN || 'ocr';
  if (mode === 'off' && !customExtractor) return { status: 'unscanned', found: [], engine: 'off' };
  try {
    const found = findPhoneNumbers(await extractText(buffer));
    return { status: found.length ? 'phone-found' : 'clean', found, engine: customExtractor ? 'custom' : mode };
  } catch (err) {
    console.warn(`[phoneScan] OCR unavailable, image accepted unscanned: ${err.message}`);
    return { status: 'unscanned', found: [], engine: mode, error: err.message };
  }
}

export async function stopOcr() {
  if (!workerPromise) return;
  try {
    await (await workerPromise).terminate();
  } catch {
    /* already gone */
  }
  workerPromise = null;
}
