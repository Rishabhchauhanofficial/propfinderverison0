import { verifyToken } from '../utils/token.js';
import User from '../models/User.js';

function readToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

async function attachUser(req, token) {
  const payload = verifyToken(token);
  const user = await User.findById(payload.sub).select('name email role status phone company activitySharing');
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });
  if (user.status === 'suspended') throw Object.assign(new Error('This account is suspended.'), { status: 403 });
  req.userId = String(user._id);
  req.user = user;
  // Legacy 'user' role behaves as 'buyer' everywhere else, but keeps listing rights.
  req.role = user.role;
}

/** Rejects the request unless a valid, active user's token is present. */
export default async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    await attachUser(req, token);
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.status === 403 ? err.message : 'Invalid token' });
  }
}

/** Attaches the user when a valid token is present; never rejects. */
export async function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    await attachUser(req, token);
  } catch {
    // Anonymous on any token problem.
  }
  return next();
}

/** Use after requireAuth. Server-side role gate. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    return next();
  };
}

export const isAdmin = (req) => req.role === 'admin';
