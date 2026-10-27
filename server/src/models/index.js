// Smaller models live together here; User and Property have their own files.
import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });

/* ---------------- developers & projects ---------------- */

const developerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    website: { type: String, default: '' },
    description: { type: String, default: '' }, // supplied by the developer — a claim, not a verified fact
    foundedYear: { type: Number, default: null },
    account: ref('User', { default: null }), // builder account that manages this developer
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);
export const Developer = model('Developer', developerSchema);

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    developer: ref('Developer', { default: null }),
    developerName: { type: String, default: '' },
    city: { type: String, required: true, index: true },
    locality: { type: String, required: true },
    state: { type: String, default: '' },
    description: { type: String, default: '' },
    status: { type: String, enum: ['pre-launch', 'under-construction', 'ready', 'completed'], default: 'under-construction', index: true },
    launchDate: { type: Date, default: null },
    possessionDate: { type: Date, default: null }, // as declared by the developer
    totalUnits: { type: Number, default: null },
    landAreaSqm: { type: Number, default: null },
    configurations: { type: [String], default: [] }, // e.g. "2 BHK", "3 BHK"
    priceFrom: { type: Number, default: null },
    priceTo: { type: Number, default: null },
    amenities: { type: [String], default: [] },
    images: { type: [String], default: [] },
    // Uploaded videos and brochures. Stored privately and shown only to signed-in users (see mediaService).
    videos: [{ _id: false, url: String, name: String, size: Number }],
    brochures: [{ _id: false, url: String, name: String, size: Number }],
    videoUrl: { type: String, default: '' },
    location: { lat: { type: Number, default: null }, lng: { type: Number, default: null } },
    // GeoJSON mirror of `location` for distance queries; kept in sync on validate.
    geo: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },
    locationId: ref('Location', { default: null, index: true }),
    ancestors: { type: [Schema.Types.ObjectId], default: [], index: true },
    rera: {
      number: { type: String, default: '' },
      state: { type: String, default: '' },
      status: { type: String, default: 'not-provided' },
    },
    createdBy: ref('User', { default: null }),
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);
projectSchema.index({ geo: '2dsphere' });
projectSchema.pre('validate', function syncGeo(next) {
  const { lat, lng } = this.location || {};
  this.geo = Number.isFinite(lat) && Number.isFinite(lng) ? { type: 'Point', coordinates: [lng, lat] } : undefined;
  next();
});
export const Project = model('Project', projectSchema);

/* ---------------- RERA verification ---------------- */

const reraRecordSchema = new Schema(
  {
    property: ref('Property', { default: null, index: true }),
    project: ref('Project', { default: null, index: true }),
    registrationNumber: { type: String, required: true, trim: true, index: true },
    state: { type: String, required: true }, // state/UT code, e.g. "HR"
    authority: { type: String, default: '' },
    officialUrl: { type: String, default: '' }, // authority search page or the project's official page
    status: {
      type: String,
      enum: ['verified', 'found-needs-review', 'not-verified', 'mismatch', 'not-found', 'not-applicable'],
      default: 'not-verified',
      index: true,
    },
    statusNote: { type: String, default: '' },
    method: { type: String, enum: ['not-checked', 'official-api', 'manual-review'], default: 'not-checked' },
    // What the lister claims.
    submitted: {
      projectName: { type: String, default: '' },
      promoterName: { type: String, default: '' },
      possessionDate: { type: Date, default: null },
    },
    // What the official record says (entered by a reviewer or returned by an official feed).
    official: {
      projectName: { type: String, default: '' },
      promoterName: { type: String, default: '' },
      registrationStatus: { type: String, default: '' },
      registeredOn: { type: Date, default: null },
      validUntil: { type: Date, default: null },
      declaredCompletion: { type: Date, default: null },
      sourceUrl: { type: String, default: '' },
    },
    discrepancies: { type: [String], default: [] },
    evidence: [
      {
        url: String,
        name: String,
        mime: String,
        uploadedBy: ref('User'),
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    lastVerifiedAt: { type: Date, default: null },
    verifiedBy: ref('User', { default: null }),
    history: [
      {
        _id: false,
        status: String,
        note: String,
        by: ref('User'),
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);
export const ReraRecord = model('ReraRecord', reraRecordSchema);

/* ---------------- reviews & moderation ---------------- */

const RATING_KEYS = ['construction', 'amenities', 'maintenance', 'location', 'connectivity', 'valueForMoney', 'overall'];
const ratingFields = Object.fromEntries(RATING_KEYS.map((k) => [k, { type: Number, min: 1, max: 5, default: null }]));

const reviewSchema = new Schema(
  {
    targetType: { type: String, enum: ['property', 'project', 'locality', 'developer'], required: true },
    // property/project/developer id, or "city|locality" for localities (lower-cased).
    targetKey: { type: String, required: true, index: true },
    author: ref('User', { required: true, index: true }),
    ratings: ratingFields,
    title: { type: String, trim: true, maxlength: 140, default: '' },
    body: { type: String, trim: true, maxlength: 4000, required: true },
    // What the author says about themselves — displayed as self-declared.
    relationship: { type: String, enum: ['resident', 'tenant', 'owner', 'visitor', 'other'], default: 'other' },
    // Only set by an admin after checking evidence.
    verifiedRelationship: { type: Boolean, default: false },
    photos: { type: [String], default: [] },
    status: { type: String, enum: ['pending', 'published', 'rejected', 'hidden'], default: 'pending', index: true },
    moderationNote: { type: String, default: '' },
    autoFlags: { type: [String], default: [] }, // e.g. 'duplicate-text', 'link-spam', 'self-review'
    contentHash: { type: String, index: true },
    reportsCount: { type: Number, default: 0 },
    replies: [
      {
        author: ref('User'),
        authorName: String,
        authorRole: String,
        body: { type: String, maxlength: 2000 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
reviewSchema.index({ targetKey: 1, author: 1 }, { unique: true }); // one review per target per person
export const Review = model('Review', reviewSchema);
export const REVIEW_RATING_KEYS = RATING_KEYS;

const reportSchema = new Schema(
  {
    targetType: { type: String, enum: ['property', 'review'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    reporter: ref('User', { required: true }),
    reason: {
      type: String,
      enum: ['misleading', 'wrong-price', 'already-sold', 'duplicate', 'fraud', 'abusive', 'spam', 'fake-review', 'other'],
      required: true,
    },
    details: { type: String, maxlength: 2000, default: '' },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open', index: true },
    resolution: { type: String, default: '' },
    resolvedBy: ref('User', { default: null }),
  },
  { timestamps: true }
);
reportSchema.index({ targetId: 1, reporter: 1 }, { unique: true });
export const Report = model('Report', reportSchema);

/* ---------------- personalisation ---------------- */

const favoriteSchema = new Schema(
  { user: ref('User', { required: true, index: true }), property: ref('Property', { required: true }) },
  { timestamps: true }
);
favoriteSchema.index({ user: 1, property: 1 }, { unique: true });
export const Favorite = model('Favorite', favoriteSchema);

const savedSearchSchema = new Schema(
  {
    user: ref('User', { required: true, index: true }),
    name: { type: String, required: true, maxlength: 120 },
    params: { type: Schema.Types.Mixed, default: {} },
    notify: { type: Boolean, default: true },
    lastCheckedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
export const SavedSearch = model('SavedSearch', savedSearchSchema);

/* ---------------- leads, site visits, notifications ---------------- */

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'site-visit', 'negotiation', 'won', 'lost'];

const leadSchema = new Schema(
  {
    property: ref('Property', { required: true, index: true }),
    listingOwner: ref('User', { required: true, index: true }),
    buyer: ref('User', { default: null, index: true }),
    name: { type: String, required: true, maxlength: 120 },
    phone: { type: String, default: '', maxlength: 30 },
    email: { type: String, default: '', maxlength: 160 },
    message: { type: String, default: '', maxlength: 2000 },
    requirements: {
      budgetMax: { type: Number, default: null },
      bedrooms: { type: Number, default: null },
      moveInBy: { type: Date, default: null },
      purpose: { type: String, enum: ['self-use', 'investment', 'rental', ''], default: '' },
    },
    source: { type: String, enum: ['contact-form', 'chat', 'site-visit', 'phone-reveal'], default: 'contact-form' },
    status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
    notes: [{ _id: false, body: String, at: { type: Date, default: Date.now } }],
    followUpAt: { type: Date, default: null },
  },
  { timestamps: true }
);
export const Lead = model('Lead', leadSchema);

const siteVisitSchema = new Schema(
  {
    property: ref('Property', { required: true, index: true }),
    lead: ref('Lead', { default: null }),
    requester: ref('User', { required: true, index: true }),
    listingOwner: ref('User', { required: true, index: true }),
    scheduledAt: { type: Date, required: true },
    status: { type: String, enum: ['requested', 'confirmed', 'completed', 'cancelled'], default: 'requested', index: true },
    note: { type: String, maxlength: 1000, default: '' },
  },
  { timestamps: true }
);
export const SiteVisit = model('SiteVisit', siteVisitSchema);

const notificationSchema = new Schema(
  {
    user: ref('User', { required: true, index: true }),
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '' },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);
export const Notification = model('Notification', notificationSchema);

/* ---------------- AI, caches, chat ---------------- */

const analysisReportSchema = new Schema(
  {
    property: ref('Property', { required: true, unique: true }),
    inputHash: { type: String, required: true },
    report: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['ok', 'partial', 'failed'], default: 'ok' },
    error: { type: String, default: '' },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);
export const AnalysisReport = model('AnalysisReport', analysisReportSchema);

const nearbyCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // provider|lat|lng|radius
    provider: String,
    status: { type: String, enum: ['ok', 'empty', 'error'], default: 'ok' },
    places: { type: [Schema.Types.Mixed], default: [] },
    error: { type: String, default: '' },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
export const NearbyCache = model('NearbyCache', nearbyCacheSchema);

const conversationSchema = new Schema(
  {
    user: ref('User', { default: null, index: true }),
    sessionId: { type: String, required: true, index: true },
    contextPropertyId: { type: String, default: '' },
    messages: [
      {
        _id: false,
        role: { type: String, enum: ['user', 'assistant'] },
        content: String,
        cards: { type: [Schema.Types.Mixed], default: [] },
        citations: { type: [Schema.Types.Mixed], default: [] },
        source: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);
export const Conversation = model('Conversation', conversationSchema);

/* ---------------- ops ---------------- */

const auditLogSchema = new Schema(
  {
    actor: ref('User', { default: null, index: true }),
    action: { type: String, required: true, index: true },
    targetType: String,
    targetId: String,
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
export const AuditLog = model('AuditLog', auditLogSchema);

// Aggregate search analytics: filter keys only, no user ids or free text beyond 60 chars.
const searchEventSchema = new Schema(
  {
    listingType: String,
    city: String,
    propertyType: String,
    hasQuery: Boolean,
    filters: [String],
    results: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
searchEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }); // keep 90 days
export const SearchEvent = model('SearchEvent', searchEventSchema);

const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    email: { type: String, required: true, maxlength: 160 },
    topic: { type: String, enum: ['general', 'listing', 'account', 'rera', 'report', 'partnership'], default: 'general' },
    message: { type: String, required: true, maxlength: 4000 },
    user: ref('User', { default: null }),
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
  },
  { timestamps: true }
);
export const ContactMessage = model('ContactMessage', contactMessageSchema);

// In-process record of integration failures so admins can see health.
const integrationEventSchema = new Schema(
  {
    service: { type: String, index: true },
    ok: Boolean,
    message: String,
    latencyMs: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
integrationEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });
export const IntegrationEvent = model('IntegrationEvent', integrationEventSchema);

/* ---------------- uploads ---------------- */

// One row per uploaded file: who uploaded it, and for photos the phone-number scan result.
// Listings may only reference files their owner uploaded, and never a photo that failed the scan.
const uploadSchema = new Schema(
  {
    name: { type: String, required: true, unique: true }, // stored file name
    url: { type: String, required: true, index: true },
    kind: { type: String, enum: ['image', 'video', 'brochure'], required: true },
    owner: ref('User', { required: true, index: true }),
    originalName: { type: String, default: '' },
    mime: { type: String, default: '' },
    size: { type: Number, default: 0 },
    scan: {
      status: { type: String, enum: ['clean', 'phone-found', 'unscanned'], default: 'unscanned' },
      found: { type: [String], default: [] }, // masked numbers, e.g. 98••••••10
      engine: { type: String, default: '' },
    },
  },
  { timestamps: true }
);
export const Upload = model('Upload', uploadSchema);

/* ---------------- buyer activity (opt-in) ---------------- */

// Recorded only for users who opted in to sharing; deleted after 30 days or when they opt out.
// meta is a snapshot of the property (or search filters) at the time, so the summary stays
// readable even if the listing changes, and other listers' properties can be described generally.
export const ACTIVITY_TYPES = ['view', 'save', 'unsave', 'compare', 'contact', 'visit', 'search', 'saved-search'];
const activityEventSchema = new Schema({
  user: ref('User', { required: true, index: true }),
  type: { type: String, enum: ACTIVITY_TYPES, required: true },
  property: ref('Property', { default: null }),
  owner: ref('User', { default: null }), // lister of that property
  meta: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});
activityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
activityEventSchema.index({ user: 1, createdAt: -1 });
export const ActivityEvent = model('ActivityEvent', activityEventSchema);
