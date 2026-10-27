import rateLimit from 'express-rate-limit';

// Tests and local scripts can opt out with RATE_LIMIT=off.
const disabled = () => process.env.RATE_LIMIT === 'off';

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: disabled,
    message: { error: message },
  });

export const apiLimiter = make(60 * 1000, 300, 'Too many requests. Please slow down.');
export const authLimiter = make(15 * 60 * 1000, 30, 'Too many sign-in attempts. Try again in a few minutes.');
export const writeLimiter = make(60 * 1000, 40, 'Too many changes in a short time. Please wait a moment.');
export const chatLimiter = make(60 * 1000, 20, 'The assistant is getting a lot of messages from you. Please wait a minute.');
export const aiLimiter = make(60 * 1000, 30, 'Too many AI analysis requests. Please wait a minute.');
