import mongoose from 'mongoose';
import { AuditLog } from '../models/index.js';

/** Wraps an async route so rejections reach the error handler. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg);

export const isId = (v) => mongoose.isValidObjectId(v) && String(v).length === 24;

export function requireId(v, what = 'Record') {
  if (!isId(v)) throw notFound(`${what} not found`);
  return v;
}

export const str = (v) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));

/** Finite number or null for absent/non-numeric values. */
export const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : null;
};

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strip control chars and angle brackets from user text; React escapes output, this is defence in depth. */
export function cleanText(v, max = 4000) {
  return String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max);
}

export function paging(q, { defLimit = 12, maxLimit = 50 } = {}) {
  const page = Math.max(1, parseInt(str(q.page), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(str(q.limit), 10) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export async function audit(req, action, targetType, targetId, details = {}) {
  try {
    await AuditLog.create({
      actor: req?.userId || null,
      action,
      targetType,
      targetId: targetId ? String(targetId) : '',
      details,
    });
  } catch (err) {
    console.warn('[audit] failed to write log:', err.message);
  }
}
