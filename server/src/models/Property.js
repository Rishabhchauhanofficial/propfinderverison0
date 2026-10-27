import mongoose from 'mongoose';
import { uniqueSlug } from '../utils/slug.js';

export const PROPERTY_TYPES = [
  'apartment',
  'villa',
  'independent-house',
  'builder-floor',
  'plot',
  'commercial',
  'office',
  'retail-shop',
];
export const COMMERCIAL_TYPES = ['commercial', 'office', 'retail-shop'];
export const LISTING_STATUSES = ['draft', 'active', 'paused', 'archived', 'sold', 'rented'];
export const RERA_STATES = [
  'verified', // Verified against official records
  'found-needs-review', // Registration found, details need review
  'not-verified', // Not yet verified
  'mismatch', // Details do not match official records
  'not-found', // Registration not found in the checked source
  'not-applicable', // Not applicable (with an explanation)
  'not-provided', // No RERA number submitted
];

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, index: true, default: '' },
    description: { type: String, default: '', maxlength: 5000 },

    listingType: { type: String, enum: ['sale', 'rent'], required: true, index: true },
    propertyType: { type: String, enum: PROPERTY_TYPES, required: true, index: true },
    status: { type: String, enum: LISTING_STATUSES, default: 'active', index: true },

    price: { type: Number, required: true, min: 1, index: true }, // INR (total for sale, monthly for rent)
    areaSqft: { type: Number, required: true, min: 1 }, // built-up (or plot area for plots)
    carpetAreaSqft: { type: Number, default: null, min: 0 },
    plotAreaSqft: { type: Number, default: null, min: 0 },
    bedrooms: { type: Number, default: 0, min: 0, max: 20 },
    bathrooms: { type: Number, default: 0, min: 0, max: 20 },
    balconies: { type: Number, default: null, min: 0, max: 20 },
    furnishing: { type: String, enum: ['unfurnished', 'semi-furnished', 'furnished'], default: 'unfurnished' },
    floor: { type: Number, default: null },
    totalFloors: { type: Number, default: null },
    facing: { type: String, default: '' },
    ageYears: { type: Number, default: null, min: 0, max: 150 },
    constructionStatus: { type: String, enum: ['ready', 'under-construction', ''], default: '' },
    possessionDate: { type: Date, default: null },
    maintenanceMonthly: { type: Number, default: null, min: 0 },
    securityDeposit: { type: Number, default: null, min: 0 },

    city: { type: String, required: true, trim: true, index: true },
    locality: { type: String, required: true, trim: true, index: true },
    state: { type: String, trim: true, default: '' },
    pinCode: { type: String, trim: true, default: '', index: true },
    address: { type: String, default: '' },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    // GeoJSON mirror of `location`, kept in sync on save, for 2dsphere queries.
    geo: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },

    amenities: { type: [String], default: [] },
    images: { type: [String], default: [] },
    videoUrl: { type: String, default: '' },

    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    developerName: { type: String, trim: true, default: '', index: true },

    // RERA as submitted by the lister. Verification lives in ReraRecord; the
    // status is denormalised here for filtering.
    rera: {
      number: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      status: { type: String, enum: RERA_STATES, default: 'not-provided', index: true },
    },

    // Supporting documents uploaded by the lister (stored privately).
    documents: [
      {
        _id: false,
        kind: { type: String, default: 'other' },
        url: String,
        name: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    contactPreference: { type: String, enum: ['phone', 'chat', 'both'], default: 'both' },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    postedByRole: { type: String, enum: ['owner', 'agent', 'builder', 'admin'], default: 'owner', index: true },

    // Admin-set only, after reviewing documents.
    listingVerified: { type: Boolean, default: false, index: true },
    verifiedAt: { type: Date, default: null },

    possibleDuplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },

    // Nearest distance (km, straight line) per facility category, written by
    // the nearby-places service. Only present once locality data was fetched.
    nearbySummary: { type: mongoose.Schema.Types.Mixed, default: null },

    isDemo: { type: Boolean, default: false, index: true },
    views: { type: Number, default: 0 },
    leadsCount: { type: Number, default: 0 },
    favoritesCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

propertySchema.index({ title: 'text', description: 'text', locality: 'text', city: 'text', developerName: 'text' });
propertySchema.index({ geo: '2dsphere' });
propertySchema.index({ status: 1, listingType: 1, city: 1, price: 1 });

propertySchema.virtual('pricePerSqft').get(function () {
  if (!this.areaSqft || this.listingType === 'rent') return null;
  return Math.round(this.price / this.areaSqft);
});

propertySchema.set('toJSON', { virtuals: true });
propertySchema.set('toObject', { virtuals: true });

propertySchema.pre('validate', function setDerived(next) {
  if (!this.slug && this.title) this.slug = uniqueSlug(this.title);

  const { lat, lng } = this.location || {};
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    this.geo = { type: 'Point', coordinates: [lng, lat] };
  } else {
    this.geo = undefined;
  }

  if (!this.rera?.number) {
    if (this.rera) this.rera.status = this.rera.status === 'not-applicable' ? 'not-applicable' : 'not-provided';
  } else if (this.rera.status === 'not-provided') {
    this.rera.status = 'not-verified';
  }
  next();
});

export default mongoose.model('Property', propertySchema);
