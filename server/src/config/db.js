import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

let memoryServer = null;
let memoryDbPath = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In-memory MongoDB writes its temporary data here (inside the project, not the OS temp
// folder) so it stays on the project's drive and is easy to clean up.
const MEMORY_TMP = path.resolve(process.env.MEMORY_DB_TMP || path.resolve(__dirname, '../../.tmp/mongo'));

/** Remove data folders left behind by runs that were killed before they could clean up. */
function sweepStaleMemoryDirs() {
  if (!fs.existsSync(MEMORY_TMP)) return;
  for (const name of fs.readdirSync(MEMORY_TMP)) {
    const dir = path.join(MEMORY_TMP, name);
    try {
      // mongod.lock holds the pid of a running instance; skip folders whose mongod is still alive.
      const lock = path.join(dir, 'mongod.lock');
      const pid = fs.existsSync(lock) ? parseInt(fs.readFileSync(lock, 'utf8'), 10) : NaN;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          continue; // still running
        } catch {
          /* process gone: folder is stale */
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* in use or already gone */
    }
  }
}

/**
 * Connect to MongoDB.
 * - If MONGODB_URI is set, connect to it.
 * - Otherwise, spin up an in-memory MongoDB (mongodb-memory-server) so the
 *   app runs with zero external setup. Great for dev/demo/tests.
 */
export async function connectDB() {
  let uri = process.env.MONGODB_URI;

  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    fs.mkdirSync(MEMORY_TMP, { recursive: true });
    sweepStaleMemoryDirs();
    memoryDbPath = fs.mkdtempSync(path.join(MEMORY_TMP, 'run-'));
    memoryServer = await MongoMemoryServer.create({ instance: { dbPath: memoryDbPath } });
    uri = memoryServer.getUri();
    console.log('[db] No MONGODB_URI set — started in-memory MongoDB');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: 'propfinder' });
  console.log(`[db] Connected to MongoDB (${memoryServer ? 'in-memory' : 'external'})`);
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  if (memoryDbPath) {
    // mongod can hold file locks briefly after stopping (Windows), so retry.
    fs.rmSync(memoryDbPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    memoryDbPath = null;
  }
}

export function isMemoryDB() {
  return !!memoryServer;
}
