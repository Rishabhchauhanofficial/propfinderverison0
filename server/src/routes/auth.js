import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import * as auth from '../controllers/authController.js';

const router = Router();

router.post('/register', authLimiter, auth.register);
router.post('/login', authLimiter, auth.login);
router.post('/otp/request', authLimiter, auth.otpRequest);
router.post('/otp/verify', authLimiter, auth.otpVerify);
router.post('/forgot-password', authLimiter, auth.forgotPassword);
router.post('/reset-password', authLimiter, auth.resetPassword);
router.get('/me', requireAuth, auth.me);
router.patch('/me', requireAuth, auth.updateProfile);
router.post('/change-password', requireAuth, authLimiter, auth.changePassword);

export default router;
