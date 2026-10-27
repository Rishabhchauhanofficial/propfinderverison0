import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Roles a person can pick at sign-up. 'admin' is never self-assignable.
export const PUBLIC_ROLES = ['buyer', 'tenant', 'owner', 'agent', 'builder'];
// 'user' is the legacy role from v1 data and is treated like 'buyer'.
export const ALL_ROLES = [...PUBLIC_ROLES, 'admin', 'user'];
// Roles allowed to publish listings and receive leads.
export const LISTER_ROLES = ['owner', 'agent', 'builder', 'admin', 'user'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ALL_ROLES, default: 'buyer', index: true },
    phone: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    company: { type: String, trim: true, default: '' }, // agency / developer name
    city: { type: String, trim: true, default: '' },

    notificationPrefs: {
      leads: { type: Boolean, default: true },
      siteVisits: { type: Boolean, default: true },
      savedSearches: { type: Boolean, default: true },
      reviews: { type: Boolean, default: true },
    },

    // Last 20 viewed properties (most recent first).
    recentlyViewed: [
      {
        _id: false,
        property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
        viewedAt: { type: Date, default: Date.now },
      },
    ],

    // Password reset: only a SHA-256 hash of the token is stored.
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpires: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, 10);
};

userSchema.methods.checkPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role === 'user' ? 'buyer' : this.role,
    phone: this.phone,
    status: this.status,
    company: this.company,
    city: this.city,
    notificationPrefs: this.notificationPrefs,
    createdAt: this.createdAt,
  };
};

export default mongoose.model('User', userSchema);
