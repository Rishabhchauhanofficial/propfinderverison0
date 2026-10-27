/*
 * Finds phone numbers in listing photos, brochures (PDF), videos and text, so contact details can't
 * bypass PropFinder's lead flow. Indian mobiles, landlines with STD code and 1800 toll-free numbers.
 *
 *  - Photos: OCR (Tesseract via tesseract.js) on several cleaned-up versions of the image: enlarged
 *    so small text is readable, contrast-stretched, and inverted for light-on-dark text.
 *  - Brochures: the PDF's text layer on every page, plus OCR of rendered pages (scanned brochures
 *    and numbers inside images).
 *  - Videos: frames spread evenly through the video (ffmpeg), each read with OCR.
 *
 * PHONE_SCAN=ocr (default). The English language data ships with the app (@tesseract.js-data/eng), so
 * no download is needed. If OCR cannot run, scans return status "error" and uploads are refused with
 * "try again" rather than let through unchecked. PHONE_SCAN=off skips the check (files marked
 * "unscanned"). PHONE_SCAN=fixture is for tests: a photo's "OCR text" is whatever follows "OCRTEXT:".
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(process.env.OCR_CACHE_DIR || path.resolve(__dirname, '../../.tmp/tesseract'));
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 20000;
const PDF_TEXT_PAGES = 200; // text layer is cheap: check this many pages
const PDF_OCR_PAGES = Number(process.env.PDF_OCR_PAGES) || 30; // rendering + OCR is not: cap it
const VIDEO_FRAMES = Number(process.env.VIDEO_SCAN_FRAMES) || 40;
const VIDEO_TIMEOUT_MS = 180000;
// Video frames are extracted next to the app (not the OS temp folder) and deleted after each scan.
const FRAMES_DIR = path.resolve(process.env.SCAN_TMP_DIR || path.resolve(__dirname, '../../.tmp/frames'));

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


/* ---------------- OCR engine ---------------- */

// Two OCR engines run passes side by side (each is single-threaded).
const WORKERS = Math.max(1, Math.min(2, Number(process.env.OCR_WORKERS) || 2));
let workerPromise = null;
let customExtractor = null;
const mode = () => process.env.PHONE_SCAN || 'ocr';

/** Tests can swap the OCR engine for a function (imageBuffer) => text. */
export function setTextExtractor(fn) {
  customExtractor = fn;
}

function langPath() {
  // Bundled language data: node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz
  return path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
}

async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const { createWorker } = await import('tesseract.js');
      const opts = { langPath: langPath(), cachePath: CACHE_DIR, gzip: true };
      return Promise.all(Array.from({ length: WORKERS }, () => createWorker('eng', 1, opts)));
    })().catch((err) => {
      workerPromise = null; // retry on the next upload
      throw err;
    });
  }
  return workerPromise;
}

/** Start the OCR engine at boot so the first upload isn't slow and a broken install shows up in the log. */
export async function warmUpOcr() {
  if (mode() !== 'ocr') return;
  try {
    await ocrWorker();
    console.log('[phoneScan] OCR ready');
  } catch (err) {
    console.error(`[phoneScan] OCR failed to start; photo, video and brochure uploads will be refused until it works: ${err.message}`);
  }
}

function withTimeout(promise, ms, what = 'OCR') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms)))]).finally(() =>
    clearTimeout(timer)
  );
}

// Tesseract page-segmentation modes: 3 = automatic layout, 11 = sparse text (scattered words in photos).
async function ocr(buffer, psm = '3', slot = 0) {
  const worker = (await ocrWorker())[slot % WORKERS];
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await withTimeout(worker.recognize(buffer), OCR_TIMEOUT_MS);
  return data?.text || '';
}

/**
 * Versions of an image that OCR reads better, as lazy PNG builders, cheapest and most useful first:
 *  - the photo as uploaded, then grey + contrast-stretched at ~2000px (enlarges tiny text);
 *  - white text isolated (bright pixels only, inverted to black-on-white): numbers painted over photos;
 *  - dark text isolated: dark numbers over busy backgrounds;
 *  - both isolations straightened by ±10° for slanted overlays.
 * Measured on test/fixtures/ocr: each pass rescued a case the others missed.
 */
async function variants(buffer, { quick = false } = {}) {
  const { default: sharp } = await import('sharp');
  const src = sharp(buffer, { limitInputPixels: 50_000_000 }).rotate();
  const width = (await src.metadata()).width || 1000;
  const target = Math.round(Math.min(2400, Math.max(1000, width < 2000 ? Math.min(width * 3, 2000) : 2000)));
  const grey = (angle = 0) => {
    const img = angle ? sharp(buffer, { limitInputPixels: 50_000_000 }).rotate().rotate(angle, { background: '#808080' }) : src.clone();
    return img.resize({ width: target }).grayscale();
  };
  const white = (angle) => grey(angle).threshold(200).negate({ alpha: false }).png().toBuffer();
  const dark = (angle) => grey(angle).negate({ alpha: false }).threshold(185).negate({ alpha: false }).png().toBuffer();
  const list = [
    { psm: '11', make: () => grey().normalise().png().toBuffer() },
    { psm: '11', make: () => white(0) },
    { psm: '11', make: () => dark(0) },
  ];
  if (quick) return list;
  return [
    { psm: '3', make: async () => buffer },
    ...list,
    { psm: '11', make: () => white(10) },
    { psm: '11', make: () => white(-10) },
    { psm: '11', make: () => dark(10) },
    { psm: '11', make: () => dark(-10) },
  ];
}

/** OCR an image in several passes (two at a time), stopping as soon as one finds a number. */
async function phonesInImage(buffer, { passes = 'all' } = {}) {
  if (customExtractor) return findPhoneNumbers(await customExtractor(buffer));
  if (mode() === 'fixture') {
    const s = buffer.toString('latin1');
    const at = s.lastIndexOf('OCRTEXT:');
    return findPhoneNumbers(at === -1 ? '' : s.slice(at + 8));
  }
  const list = await variants(buffer, { quick: passes === 'quick' });
  for (let i = 0; i < list.length; i += WORKERS) {
    const batch = list.slice(i, i + WORKERS);
    const results = await Promise.all(batch.map(async (v, j) => findPhoneNumbers(await ocr(await v.make(), v.psm, j))));
    const found = results.find((r) => r.length);
    if (found) return found;
  }
  return [];
}

const result = (found, engine, extra = {}) => ({ status: found.length ? 'phone-found' : 'clean', found, engine, ...extra });
const failed = (err) => {
  console.warn(`[phoneScan] scan failed: ${err.message}`);
  return { status: 'error', found: [], engine: mode(), error: err.message };
};
const off = () => mode() === 'off' && !customExtractor;

/**
 * Scan one photo. Returns { status, found, engine }:
 *   clean | phone-found | error (OCR could not run: refuse and ask to retry) | unscanned (PHONE_SCAN=off).
 */
export async function scanImage(buffer) {
  if (off()) return { status: 'unscanned', found: [], engine: 'off' };
  try {
    return result(await phonesInImage(buffer), customExtractor ? 'custom' : mode());
  } catch (err) {
    return failed(err);
  }
}

/* ---------------- brochures (PDF) ---------------- */

async function loadPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Untrusted input: no eval, no system fonts, no network.
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  return { task, doc: await task.promise };
}

/**
 * Scan a PDF: the text layer of every page (up to 200), then OCR of the first 30 rendered pages so
 * numbers in scanned pages and images are caught too. Returns { status, found, pages } (1-based).
 */
export async function scanPdf(buffer) {
  if (off()) return { status: 'unscanned', found: [], engine: 'off', pages: [] };
  try {
    const { task, doc } = await loadPdf(buffer);
    const found = new Set();
    const pages = new Set();
    const n = Math.min(doc.numPages, PDF_TEXT_PAGES);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const text = (await page.getTextContent()).items.map((it) => `${it.str}${it.hasEOL ? '\n' : ' '}`).join('');
      const hits = findPhoneNumbers(text);
      hits.forEach((h) => found.add(h));
      if (hits.length) pages.add(i);
    }
    if (mode() === 'ocr' || customExtractor) {
      const { createCanvas } = await import('@napi-rs/canvas');
      for (let i = 1; i <= Math.min(doc.numPages, PDF_OCR_PAGES); i++) {
        if (pages.has(i)) continue;
        const page = await doc.getPage(i);
        // About 2000px wide: small type stays legible without huge canvases.
        const vp = page.getViewport({ scale: Math.min(3, 2000 / page.getViewport({ scale: 1 }).width) });
        const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
        const hits = await phonesInImage(canvas.toBuffer('image/png'), { passes: 'quick' });
        hits.forEach((h) => found.add(h));
        if (hits.length) pages.add(i);
      }
    }
    const pageCount = doc.numPages;
    await task.destroy();
    return result([...found], mode(), { pages: [...pages].sort((a, b) => a - b), pageCount });
  } catch (err) {
    if (/Invalid PDF|password/i.test(err.message)) return { status: 'invalid', found: [], engine: mode(), error: err.message };
    return failed(err);
  }
}

/* ---------------- videos ---------------- */

const ffmpegPath = () => process.env.FFMPEG_PATH || require('ffmpeg-static');

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => {
      if (err.length < 20000) err += d;
    });
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('ffmpeg timed out'));
    }, timeoutMs);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr: err });
    });
  });
}

/**
 * Scan a video file: up to 40 frames spread evenly across its length (at least one every 2 seconds
 * for short videos), each read with OCR. Returns { status, found, seconds } (timestamps of hits).
 * Not covered: numbers shown for less than the gap between frames, and spoken numbers.
 */
export async function scanVideo(filePath) {
  if (off()) return { status: 'unscanned', found: [], engine: 'off', seconds: [] };
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FRAMES_DIR, 'scan-'));
  try {
    const probe = await run(ffmpegPath(), ['-hide_banner', '-i', filePath], 30000);
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr);
    if (!m) return { status: 'invalid', found: [], engine: mode(), error: 'Not a readable video.' };
    const duration = Math.max(0.5, Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    const step = Math.max(duration / VIDEO_FRAMES, Math.min(2, duration / 2));
    const out = await run(
      ffmpegPath(),
      ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-an', '-sn', '-vf', `fps=1/${step.toFixed(3)},scale='min(1600,iw)':-2`, '-frames:v', String(VIDEO_FRAMES), path.join(dir, 'f%03d.png')],
      VIDEO_TIMEOUT_MS
    );
    const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    if (out.code !== 0 && !frames.length) return { status: 'invalid', found: [], engine: mode(), error: 'Not a readable video.' };
    const found = new Set();
    const seconds = [];
    for (const [i, f] of frames.entries()) {
      const hits = await phonesInImage(fs.readFileSync(path.join(dir, f)), { passes: 'quick' });
      if (hits.length) {
        hits.forEach((h) => found.add(h));
        seconds.push(Math.round(i * step));
      }
    }
    return result([...found], mode(), { seconds, frames: frames.length });
  } catch (err) {
    return failed(err);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function stopOcr() {
  if (!workerPromise) return;
  try {
    await Promise.all((await workerPromise).map((w) => w.terminate()));
  } catch {
    /* already gone */
  }
  workerPromise = null;
}
