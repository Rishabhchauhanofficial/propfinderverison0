import { Router } from 'express';
import requireAuth, { optionalAuth, requireRole } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { LISTER_ROLES } from '../models/User.js';
import * as ai from '../controllers/aiController.js';

const router = Router();

router.get('/properties/:id/report', aiLimiter, optionalAuth, ai.getReport);
router.get('/properties/:id/analysis', aiLimiter, optionalAuth, ai.getAnalysis);
router.get('/properties/:id/marketing', aiLimiter, optionalAuth, ai.getMarketing);
router.post('/compare', aiLimiter, optionalAuth, ai.compare);
router.post('/draft-description', aiLimiter, requireAuth, requireRole(...LISTER_ROLES), ai.draft);

export default router;
