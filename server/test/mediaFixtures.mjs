// Builds real test media: MP4s from fixture images (ffmpeg) and minimal PDFs (text or a scanned image).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const OCR_DIR = path.join(here, 'fixtures', 'ocr');
const OUT = path.resolve(here, '../.tmp/test-media');

/** An H.264 MP4 showing each image for `seconds`, one after another. */
export function videoFrom(images, seconds = 3) {
  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, `${images.join('+')}-${seconds}.mp4`);
  if (!fs.existsSync(out)) {
    const inputs = images.flatMap((img) => ['-loop', '1', '-t', String(seconds), '-i', path.join(OCR_DIR, `${img}.jpg`)]);
    const filter = `${images.map((_, i) => `[${i}:v]scale=1200:800,setsar=1[v${i}]`).join(';')};${images.map((_, i) => `[v${i}]`).join('')}concat=n=${images.length}:v=1:a=0[out]`;
    const r = spawnSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-r', '10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', out]);
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  }
  return fs.readFileSync(out);
}

function pdf(objects) {
  // objects: array of Buffers/strings, object i+1. Builds a valid xref table.
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let len = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(len);
    const body = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from('\nendobj\n')]);
    parts.push(body);
    len += body.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** A one-page PDF with real text (Helvetica). */
export function textPdf(lines) {
  const content = `BT /F1 20 Tf 40 250 Td 26 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ')} ET`;
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

/** A one-page "scanned" PDF: the fixture image as the whole page, no text layer. */
export async function imagePdf(image) {
  const jpg = await sharp(path.join(OCR_DIR, `${image}.jpg`)).jpeg({ quality: 85 }).toBuffer();
  const { width, height } = await sharp(jpg).metadata();
  const content = `q 600 0 0 400 0 0 cm /Im1 Do Q`;
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`),
      jpg,
      Buffer.from('\nendstream'),
    ]),
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

export const fixtureImage = (name) => fs.readFileSync(path.join(OCR_DIR, `${name}.jpg`));
