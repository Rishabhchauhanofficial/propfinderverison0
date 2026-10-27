import { Router } from 'express';
import requireAuth, { optionalAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import * as propertyController from '../controllers/propertyController.js';

const router = Router();

// Static paths must be registered before "/:id".
router.get('/mine', requireAuth, propertyController.mine);
router.get('/suggest', propertyController.suggest);
router.get('/', optionalAuth, propertyController.list);
router.post('/', requireAuth, writeLimiter, propertyController.create);

router.get('/:id', optionalAuth, propertyController.getOne);
router.put('/:id', requireAuth, writeLimiter, propertyController.update);
router.patch('/:id/status', requireAuth, writeLimiter, propertyController.setStatus);
router.delete('/:id', requireAuth, propertyController.remove);
router.post('/:id/contact', requireAuth, writeLimiter, propertyController.contact);

export default router;
