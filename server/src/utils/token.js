import jwt from 'jsonwebtoken';

// Read lazily so that dotenv has loaded before the first call.
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return secret || 'dev-secret';
};

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, getSecret(), { expiresIn: '7d' });
}

// Returns the decoded payload or throws (TokenExpiredError / JsonWebTokenError).
export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
