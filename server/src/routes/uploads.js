import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { handleUpload, handleDocumentUpload, handleVideoUpload, handleBrochureUpload } from '../controllers/uploadController.js';

const router = Router();

// POST /api/uploads  (multipart/form-data, field "images") -> { urls, rejected } — scanned for phone numbers
router.post('/', requireAuth, writeLimiter, handleUpload);
// POST /api/uploads/documents  (field "files") -> { files: [...] } — private storage
router.post('/documents', requireAuth, writeLimiter, handleDocumentUpload);
// POST /api/uploads/videos  (field "videos") and /brochures (field "brochures") — shown to signed-in users only
router.post('/videos', requireAuth, writeLimiter, handleVideoUpload);
router.post('/brochures', requireAuth, writeLimiter, handleBrochureUpload);

export default router;
