const PROPERTY_TYPE_LABELS = {
  apartment: 'Apartment',
  villa: 'Villa',
  'independent-house': 'Independent House',
  'builder-floor': 'Builder Floor',
  'retail-shop': 'Retail Shop',
  plot: 'Plot',
  commercial: 'Commercial Space',
  office: 'Office Space',
};

export function propertyTypeLabel(type) {
  return PROPERTY_TYPE_LABELS[type] || 'Property';
}

const trimDecimals = (n) => Number(n.toFixed(2)).toString();

// Indian numbering: 7500000 -> "₹75 Lakh", 25000000 -> "₹2.5 Crore", 15000 -> "₹15,000"
export function formatINR(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${trimDecimals(n / 1e7)} Crore`;
  if (abs >= 1e5) return `₹${trimDecimals(n / 1e5)} Lakh`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function formatPerSqft(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// 3 -> "3 BHK"; 0 (plots, offices, commercial) -> ""
export function bhkLabel(bedrooms) {
  const n = Number(bedrooms);
  return n > 0 ? `${n} BHK` : '';
}
