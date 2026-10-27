import { Router } from 'express';
import { getOne, preview, search } from '../controllers/locationController.js';

const router = Router();

router.get('/search', search);
router.get('/appears-on', preview);
router.get('/:slug', getOne);

export default router;
