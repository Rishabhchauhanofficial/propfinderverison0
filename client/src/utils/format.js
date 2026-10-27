/* ---------- money ---------- */

const trimDecimals = (n) => String(Number(n.toFixed(2)));

/**
 * Indian-style compact price.
 *   7500000  -> "₹75 Lakh"
 *   25000000 -> "₹2.5 Crore"
 *   45000    -> "₹45,000"
 * Pass listingType="rent" to get a "/mo" suffix.
 */
export function formatINR(amount, listingType) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';

  const abs = Math.abs(n);
  let body;
  if (abs >= 1e7) body = `₹${trimDecimals(n / 1e7)} Crore`;
  else if (abs >= 1e5) body = `₹${trimDecimals(n / 1e5)} Lakh`;
  else body = `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return listingType === 'rent' ? `${body}/mo` : body;
}

/** Full rupee figure, e.g. "₹75,00,000". */
export function formatFullINR(amount) {
  const n = Number(amount);
  if (amount === null || amount === undefined || Number.isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** "₹5,432/sq ft" */
export function formatPerSqft(value) {
  const n = Number(value);
  if (!value || Number.isNaN(n)) return null;
  return `₹${Math.round(n).toLocaleString('en-IN')}/sq ft`;
}

/* ---------- misc ---------- */

export function formatArea(sqft) {
  const n = Number(sqft);
  if (!n || Number.isNaN(n)) return '—';
  return `${Math.round(n).toLocaleString('en-IN')} sq ft`;
}

/** "independent-house" -> "Independent House" */
export function labelize(value) {
  if (!value) return '';
  return String(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Works with both API shapes: `id` (toJSON virtual) or `_id`. */
export function propertyId(property) {
  return property?.id || property?._id;
}

/** SEO-friendly link to a listing: prefers the slug, falls back to id. */
export function propertyPath(property) {
  return `/property/${property?.slug || propertyId(property)}`;
}

export function hasCoords(property) {
  const loc = property?.location;
  return loc && loc.lat !== null && loc.lat !== undefined && loc.lng !== null && loc.lng !== undefined;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
