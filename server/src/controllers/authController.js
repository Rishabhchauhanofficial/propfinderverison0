import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import User, { PUBLIC_ROLES } from '../models/User.js';
import Otp from '../models/Otp.js';
import { signToken } from '../utils/token.js';
import { audit, cleanText } from '../utils/http.js';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const normalizePhone = (p) => String(p || '').replace(/[^\d+]/g, '').trim();
const digitsOnly = (p) => String(p || '').replace(/\D/g, '');
const OTP_TTL_MIN = 10;
const RESET_TTL_MIN = 30;
const isProd = () => process.env.NODE_ENV === 'production';
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Password must include at least one letter and one number.';
  return null;
}

export async function register(req, res, next) {
  try {
    const { name, email, password, phone, role, company, city } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    if (!EMAIL_RX.test(String(email).trim())) return res.status(400).json({ error: 'Enter a valid email address.' });
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const normalized = normalizeEmail(email);
    if (await User.exists({ email: normalized })) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = new User({
      name: cleanText(name, 120),
      email: normalized,
      phone: phone ? cleanText(phone, 30) : undefined,
      // Admin can never be self-assigned.
      role: PUBLIC_ROLES.includes(role) ? role : 'buyer',
      company: cleanText(company, 120),
      city: cleanText(city, 60),
    });
    await user.setPassword(String(password));
    await user.save();

    return res.status(201).json({ token: signToken(user.id), user: user.toSafeJSON() });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    if (err?.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user || !(await user.checkPassword(String(password)))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.status === 'suspended') return res.status(403).json({ error: 'This account is suspended. Contact support.' });

    user.lastLoginAt = new Date();
    await user.save();
    return res.json({ token: signToken(user.id), user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

// ---- Password reset ----
// No email transport is configured in this build. Outside production the
// reset link is returned in the response so the flow can be tested; in
// production it is never returned or logged.

export async function forgotPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email);
    const generic = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };
    if (!EMAIL_RX.test(email)) return res.json(generic);

    const user = await User.findOne({ email });
    if (!user || user.status === 'suspended') return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MIN * 60000);
    await user.save();

    const base = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const link = `${base}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    const payload = { ...generic, emailDelivery: 'not-configured' };
    if (!isProd()) payload.devResetUrl = link;
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.token || '');
    const pwError = validatePassword(req.body?.password);
    if (pwError) return res.status(400).json({ error: pwError });

    const user = await User.findOne({ email }).select('+resetTokenHash +resetTokenExpires');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    if (
      !user ||
      !user.resetTokenHash ||
      user.resetTokenExpires < new Date() ||
      !crypto.timingSafeEqual(Buffer.from(user.resetTokenHash), Buffer.from(hash))
    ) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }
    await user.setPassword(String(req.body.password));
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    await user.save();
    await audit({ userId: user.id }, 'auth.password-reset', 'user', user.id);
    return res.json({ ok: true, token: signToken(user.id), user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

// ---- Phone + OTP (demo: the code is returned/logged instead of sent by SMS) ----

export async function otpRequest(req, res, next) {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (digitsOnly(phone).length < 10) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
    }

    const code = String(crypto.randomInt(1000, 10000)); // 4-digit demo OTP
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

    await Otp.findOneAndUpdate(
      { phone },
      { phone, codeHash, expiresAt, attempts: 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const payload = { sent: true, phone, expiresInSec: OTP_TTL_MIN * 60, smsDelivery: 'not-configured' };
    // DEMO ONLY: no SMS gateway is wired, so outside production the code is returned for the UI.
    if (!isProd()) payload.devCode = code;
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function otpVerify(req, res, next) {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    const name = req.body?.name ? cleanText(req.body.name, 120) : '';
    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone and code are required.' });
    }

    const otp = await Otp.findOne({ phone });
    if (!otp || otp.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (otp.attempts >= 5) {
      await Otp.deleteOne({ phone });
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    }

    const ok = await bcrypt.compare(code, otp.codeHash);
    if (!ok) {
      otp.attempts += 1;
      await otp.save();
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    await Otp.deleteOne({ phone });

    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({
        name: name || `User ${digitsOnly(phone).slice(-4)}`,
        phone,
        email: `${digitsOnly(phone)}@phone.propfinder.local`,
      });
      await user.setPassword(crypto.randomBytes(24).toString('hex'));
      await user.save();
    }
    if (user.status === 'suspended') return res.status(403).json({ error: 'This account is suspended. Contact support.' });

    return res.json({ token: signToken(user.id), user: user.toSafeJSON() });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'This phone is linked to another account.' });
    }
    return next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    const b = req.body || {};
    if (b.name !== undefined) user.name = cleanText(b.name, 120) || user.name;
    if (b.phone !== undefined) user.phone = cleanText(b.phone, 30);
    if (b.company !== undefined) user.company = cleanText(b.company, 120);
    if (b.city !== undefined) user.city = cleanText(b.city, 60);
    // Buyers/tenants/owners/agents/builders may switch among public roles; admin is never self-assigned.
    if (b.role !== undefined && user.role !== 'admin') {
      if (!PUBLIC_ROLES.includes(b.role)) return res.status(400).json({ error: 'Invalid role.' });
      user.role = b.role;
    }
    if (b.notificationPrefs && typeof b.notificationPrefs === 'object') {
      for (const k of ['leads', 'siteVisits', 'savedSearches', 'reviews']) {
        if (typeof b.notificationPrefs[k] === 'boolean') user.notificationPrefs[k] = b.notificationPrefs[k];
      }
    }
    await user.save();
    return res.json({ user: user.toSafeJSON() });
  } catch (err) {
    return next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!(await user.checkPassword(String(req.body?.currentPassword || '')))) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    const pwError = validatePassword(req.body?.newPassword);
    if (pwError) return res.status(400).json({ error: pwError });
    await user.setPassword(String(req.body.newPassword));
    await user.save();
    await audit(req, 'auth.password-change', 'user', user.id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
