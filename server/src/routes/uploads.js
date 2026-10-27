import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { handleUpload, handleDocumentUpload } from '../controllers/uploadController.js';

const router = Router();

// POST /api/uploads  (multipart/form-data, field "images") -> { urls: [...] }
router.post('/', requireAuth, writeLimiter, handleUpload);
// POST /api/uploads/documents  (field "files") -> { files: [...] } — private storage
router.post('/documents', requireAuth, writeLimiter, handleDocumentUpload);

export default router;
