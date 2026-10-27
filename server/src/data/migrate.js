/*
 * Idempotent startup migrations (safe to run on every boot; never deletes documents).
 *  1. Sync indexes for all models (adds 2dsphere/compound indexes, replaces the v1 text index).
 *  2. Backfill the GeoJSON `geo` point from `location` for pre-v2 listings.
 *  3. Label v1 seed listings (owned by the demo accounts) as demo data.
 *  4. Load the shipped location tree and attach listings/projects that have no locationId yet.
 */
import mongoose from 'mongoose';
import Property from '../models/Property.js';
import User from '../models/User.js';
import '../models/index.js';
import '../models/Location.js';
import { backfillListingLocations, seedLocations } from '../services/locationService.js';

const LEGACY_DEMO_EMAILS = ['agent@propfinder.in', 'priya@example.com', 'demo@propfinder.in'];

export async function runMigrations() {
  for (const name of mongoose.modelNames()) {
    try {
      await mongoose.model(name).syncIndexes();
    } catch (err) {
      console.warn(`[migrate] index sync for ${name} failed: ${err.message}`);
    }
  }

  const geo = await Property.updateMany(
    { 'location.lat': { $type: 'number' }, 'location.lng': { $type: 'number' }, 'geo.coordinates': { $exists: false } },
    [{ $set: { geo: { type: 'Point', coordinates: ['$location.lng', '$location.lat'] } } }]
  );

  const demoOwners = await User.find({ email: { $in: LEGACY_DEMO_EMAILS } }).select('_id').lean();
  const demo = await Property.updateMany(
    { owner: { $in: demoOwners.map((u) => u._id) }, isDemo: { $ne: true }, images: { $elemMatch: { $regex: '^https://picsum\\.photos/seed/pf-' } } },
    { $set: { isDemo: true } }
  );

  // Projects gained a GeoJSON point in v2.1.
  const { Project } = await import('../models/index.js');
  await Project.updateMany(
    { 'location.lat': { $type: 'number' }, 'location.lng': { $type: 'number' }, 'geo.coordinates': { $exists: false } },
    [{ $set: { geo: { type: 'Point', coordinates: ['$location.lng', '$location.lat'] } } }]
  );

  const tree = await seedLocations();
  const attached = await backfillListingLocations();
  if (tree.inserted || attached.properties || attached.projects) {
    console.log(`[migrate] locations added: ${tree.inserted}; attached ${attached.properties} listings, ${attached.projects} projects (${attached.unresolved} unresolved)`);
  }

  if (geo.modifiedCount || demo.modifiedCount) {
    console.log(`[migrate] geo backfilled: ${geo.modifiedCount}, legacy demo labelled: ${demo.modifiedCount}`);
  }
}
