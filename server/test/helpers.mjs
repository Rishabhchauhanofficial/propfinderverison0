// Shared test harness: isolated in-memory MongoDB + the real Express app.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT = 'off';
process.env.NEARBY_PROVIDER = process.env.NEARBY_PROVIDER || 'fixture';
process.env.JWT_SECRET = 'test-secret';
// Photo phone-number scan: deterministic stand-in for OCR (text after 'OCRTEXT:' in the file).
process.env.PHONE_SCAN = 'fixture';
delete process.env.AI_API_KEY;
// Never touch a real database from tests.
delete process.env.MONGODB_URI;

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { seedDatabase } = await import('../src/data/seed.js');
const { runMigrations } = await import('../src/data/migrate.js');

export async function startServer({ seed = true } = {}) {
  await connectDB();
  await runMigrations();
  if (seed) await seedDatabase();
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = async (path, { method = 'GET', token, body, headers = {}, raw = false } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };

  const login = async (email, password = 'Passw0rd!') => {
    const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.data)}`);
    return r.data.token;
  };

  const register = async (overrides = {}) => {
    const email = overrides.email || `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.in`;
    const r = await api('/api/auth/register', { method: 'POST', body: { name: 'Test User', email, password: 'Secret123', ...overrides } });
    if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
    return { token: r.data.token, user: r.data.user, email };
  };

  const stop = async () => {
    server.close();
    await disconnectDB();
  };

  return { base, api, login, register, stop };
}

/** Parse a text/event-stream body into [{event, data}]. */
export function parseSSE(text) {
  return text
    .split('\n\n')
    .map((block) => {
      const ev = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      return ev ? { event: ev, data: data ? JSON.parse(data) : null } : null;
    })
    .filter(Boolean);
}

export const sampleListing = (over = {}) => ({
  title: 'Test 3 BHK Apartment in Sector 54',
  description: 'A test listing.',
  listingType: 'sale',
  propertyType: 'apartment',
  price: 25000000,
  areaSqft: 1800,
  carpetAreaSqft: 1350,
  bedrooms: 3,
  bathrooms: 3,
  furnishing: 'semi-furnished',
  city: 'Gurugram',
  locality: 'Sector 54',
  location: { lat: 28.4401, lng: 77.0951 },
  amenities: ['Lift'],
  images: [],
  ...over,
});
