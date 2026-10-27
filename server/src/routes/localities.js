import { Router } from 'express';
import { listLocalities } from '../controllers/localityController.js';

const router = Router();

router.get('/', listLocalities);

export default router;
