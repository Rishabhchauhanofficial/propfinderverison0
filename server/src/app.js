import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';

import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/properties.js';
import localityRoutes from './routes/localities.js';
import aiRoutes from './routes/ai.js';
import seoRoutes from './routes/seo.js';
import uploadRoutes from './routes/uploads.js';
import apiRoutes from './routes/api.js';
import { UPLOADS_DIR } from './controllers/uploadController.js';
import { apiLimiter } from './middleware/rateLimit.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON and images only; the SPA sets its own CSP.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  const origins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim());
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '1mb' }));
  // Never log query strings or bodies (they can contain personal data or tokens).
  morgan.token('path', (req) => req.originalUrl.split('?')[0]);
  if (process.env.NODE_ENV !== 'test') app.use(morgan(':method :path :status :response-time ms'));

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'propfinder-api' }));

  // Public listing photos only. Private documents are served by /api/files with auth.
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', dotfiles: 'deny', index: false }));

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/properties', propertyRoutes);
  app.use('/api/localities', localityRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api', apiRoutes);

  // SEO routes served at root for crawlers (sitemap.xml, robots.txt)
  app.use('/', seoRoutes);

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler: client errors carry their message; server errors are generic.
   
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    if (err.name === 'ValidationError' || err.name === 'CastError') status = 400;
    if (err.type === 'entity.parse.failed') status = 400;
    if (status >= 500) console.error('[error]', req.method, req.path, err.message);
    const message = status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message || 'Bad request';
    res.status(status).json({ error: message });
  });

  return app;
}
