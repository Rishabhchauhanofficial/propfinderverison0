import { Router } from 'express';
import Property from '../models/Property.js';
import { Project } from '../models/index.js';

const router = Router();

const siteUrl = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = siteUrl();
    const [properties, localities, projects] = await Promise.all([
      Property.find({ status: 'active' }).select('_id slug updatedAt').sort({ updatedAt: -1 }).lean(),
      Property.aggregate([
        {
          $match: {
            status: 'active',
            city: { $nin: [null, ''] },
            locality: { $nin: [null, ''] },
          },
        },
        { $group: { _id: { city: '$city', locality: '$locality' } } },
        { $sort: { '_id.city': 1, '_id.locality': 1 } },
      ]),
      Project.find().select('slug updatedAt').lean(),
    ]);

    const urls = ['/', '/buy', '/rent', '/commercial', '/projects', '/methodology', '/rera'].map((p) => ({ loc: `${base}${p}` }));
    for (const p of projects) urls.push({ loc: `${base}/projects/${p.slug}`, lastmod: p.updatedAt });
    for (const p of properties) {
      urls.push({ loc: `${base}/property/${p.slug || p._id}`, lastmod: p.updatedAt });
    }
    for (const l of localities) {
      const city = encodeURIComponent(l._id.city);
      const locality = encodeURIComponent(l._id.locality);
      urls.push({ loc: `${base}/locality/${city}/${locality}` });
    }

    const body = urls
      .map((u) => {
        const lastmod = u.lastmod ? `\n    <lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : '';
        return `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>${lastmod}\n  </url>`;
      })
      .join('\n');

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      `${body}\n` +
      '</urlset>\n';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    return res.send(xml);
  } catch (err) {
    return next(err);
  }
});

router.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(`User-agent: *\nAllow: /\n\nSitemap: ${siteUrl()}/sitemap.xml\n`);
});

export default router;
