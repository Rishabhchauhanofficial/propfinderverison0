import mongoose from 'mongoose';

// One active OTP per phone (upserted on each request). Expires via TTL index.
const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// TTL: Mongo removes the doc shortly after expiresAt.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('Otp', otpSchema);
