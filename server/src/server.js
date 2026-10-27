import 'dotenv/config';
import { createApp } from './app.js';
import { connectDB, disconnectDB, isMemoryDB } from './config/db.js';
import Property from './models/Property.js';
import { seedDatabase } from './data/seed.js';
import { runMigrations } from './data/migrate.js';

const PORT = process.env.PORT || 5000;

async function start() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  await connectDB();
  await runMigrations();

  // Auto-seed demo data on first run so the app is never empty.
  // Runs when the properties collection is empty (e.g. the in-memory DB, or a
  // fresh database). Disable with AUTO_SEED=false.
  if (process.env.AUTO_SEED !== 'false') {
    const count = await Property.countDocuments();
    if (count === 0) {
      const where = isMemoryDB() ? 'in-memory' : 'empty';
      console.log(`[seed] ${where} database detected — loading demo data…`);
      const r = await seedDatabase();
      console.log(`[seed] loaded ${r.properties} demo properties, ${r.projects} demo projects, ${r.users} users`);
    }
  }

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[server] PropFinder API listening on http://localhost:${PORT}`);
  });

  // Shut down cleanly (Ctrl+C, nodemon restarts) so the in-memory DB removes its temp files.
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} received — shutting down`);
    server.close();
    try {
      await disconnectDB();
    } finally {
      process.exit(0);
    }
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGUSR2']) process.once(sig, () => shutdown(sig));
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
