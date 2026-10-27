import mongoose from 'mongoose';

// Country → state → district → city/town → locality/village. Not every branch has every level
// (Delhi goes state → district → locality; Pune goes state → city → locality).
export const LOCATION_TYPES = ['country', 'state', 'district', 'city', 'town', 'locality', 'village'];

const { Schema } = mongoose;

const locationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true },
    type: { type: String, enum: LOCATION_TYPES, required: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    // Every ancestor id, root first (India, state, district, …). Excludes the node itself.
    ancestors: { type: [Schema.Types.ObjectId], default: [], index: true },

    aliases: { type: [String], default: [] }, // "Gurgaon", "Cawnpore", "Bangalore"
    // Normalised name and aliases (see normalizeName) for exact, case- and punctuation-insensitive lookups.
    nameKey: { type: String, required: true },
    aliasKeys: { type: [String], default: [] },

    geo: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    // True when the point is borrowed from a parent because the source had no coordinates
    // for this place, so distances to it are rough.
    approxGeo: { type: Boolean, default: false },

    population: { type: Number, default: null },
    priority: { type: Number, default: 0 }, // higher wins when names tie
    codes: {
      geonames: { type: Number, default: undefined },
      lgd: { type: String, default: undefined },
    },

    // seed = shipped with the app, import = GeoNames import, listing = created when a listing named
    // a locality the tree did not know (needs review), admin = added by an admin.
    source: { type: String, enum: ['seed', 'import', 'listing', 'admin'], default: 'seed' },
    reviewed: { type: Boolean, default: true },
  },
  { timestamps: true }
);

locationSchema.index({ geo: '2dsphere' });
locationSchema.index({ nameKey: 1, type: 1 });
locationSchema.index({ aliasKeys: 1 });
locationSchema.index({ 'codes.geonames': 1 }, { unique: true, partialFilterExpression: { 'codes.geonames': { $type: 'number' } } });

export default mongoose.model('Location', locationSchema);
