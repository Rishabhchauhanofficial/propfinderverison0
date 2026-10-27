/*
 * Property suitability scoring — the single place to tune the methodology.
 * Every score is 0–100 or null (insufficient data). Missing data never turns
 * into a perfect or a failing score; it is excluded and lowers confidence.
 * The /methodology page renders these values, so keep descriptions accurate.
 */

export const SCORING_VERSION = '2026.10-1';

// Distance bands (km, straight-line) → points. Beyond the last band, `beyond` applies
// when the lookup succeeded but found nothing closer.
export const DISTANCE_BANDS = {
  school: { bands: [[1, 100], [2, 85], [3, 65]], beyond: 25 },
  college: { bands: [[2, 100], [5, 70]], beyond: 30 },
  hospital: { bands: [[1.5, 100], [3, 85], [5, 60]], beyond: 20 },
  clinic: { bands: [[0.75, 100], [1.5, 75], [2, 55]], beyond: 25 },
  pharmacy: { bands: [[0.5, 100], [1, 80], [2, 55]], beyond: 20 },
  supermarket: { bands: [[0.75, 100], [1.5, 75], [2, 55]], beyond: 20 },
  market: { bands: [[1, 100], [2, 70], [3, 50]], beyond: 25 },
  mall: { bands: [[2, 100], [5, 65]], beyond: 30 },
  metro: { bands: [[0.8, 100], [1.5, 85], [3, 60], [5, 35]], beyond: 10 },
  railway: { bands: [[3, 100], [6, 70], [10, 45]], beyond: 20 },
  bus_stop: { bands: [[0.4, 100], [0.8, 75], [1.5, 50]], beyond: 15 },
  airport: { bands: [[10, 100], [20, 75], [30, 55], [40, 35]], beyond: 20 },
  major_road: { bands: [[1, 100], [2, 75], [3, 55]], beyond: 30 },
  park: { bands: [[0.5, 100], [1, 80], [2, 55]], beyond: 20 },
  gym: { bands: [[1, 100], [2, 70]], beyond: 30 },
  restaurant: { bands: [[0.5, 100], [1, 80], [1.5, 60]], beyond: 30 },
  bank: { bands: [[1, 100], [2, 70]], beyond: 25 },
  atm: { bands: [[0.5, 100], [1, 75], [1.5, 55]], beyond: 25 },
  fuel: { bands: [[2, 100], [3, 70]], beyond: 40 },
  ev_charging: { bands: [[2, 100], [5, 70]], beyond: 40 },
  hub: { bands: [[3, 100], [7, 80], [12, 60], [20, 40]], beyond: 20 },
};

// Component weights inside each locality score (they are renormalised over
// available components).
export const COMPONENTS = {
  education: { school: 0.6, college: 0.2, schoolCount: 0.2 },
  healthcare: { hospital: 0.6, clinic: 0.2, pharmacy: 0.2 },
  connectivity: { metro: 0.35, bus_stop: 0.2, railway: 0.15, major_road: 0.15, airport: 0.15 },
  amenities: { supermarket: 0.2, market: 0.15, pharmacy: 0.1, atm: 0.1, bank: 0.1, restaurant: 0.1, park: 0.15, gym: 0.1 },
  location: { hub: 0.5, park: 0.2, mall: 0.15, fuel: 0.075, ev_charging: 0.075 },
};

export const SCORE_DEFS = {
  location: { label: 'Location', weight: 0.15 },
  connectivity: { label: 'Connectivity', weight: 0.18 },
  amenities: { label: 'Neighbourhood amenities', weight: 0.12 },
  education: { label: 'Education access', weight: 0.1 },
  healthcare: { label: 'Healthcare access', weight: 0.1 },
  price: { label: 'Price competitiveness', weight: 0.17 },
  rental: { label: 'Rental potential', weight: 0.06 },
  documentation: { label: 'Documentation & verification', weight: 0.12 },
};

// Multipliers applied to SCORE_DEFS weights when a user picks priorities.
export const PRIORITY_MULTIPLIERS = {
  affordability: { price: 2.2 },
  commute: { connectivity: 2, location: 1.5 },
  family: { education: 2, healthcare: 1.6, amenities: 1.4 },
  rental: { rental: 3, connectivity: 1.3 },
  verification: { documentation: 2.2 },
};

// Comparable-listing rules for price analysis.
export const COMPARABLES = {
  minSample: 3, // below this, no price verdict
  highConfidenceSample: 10,
  mediumConfidenceSample: 5,
  areaTolerance: 0.5, // ±50% of the subject's area for same-type comparables
  maxSample: 40,
  cityRadiusKm: 6,
  fairBandPct: 8, // within ±8% of the median is "near market"
};

// Gross rental yield (%) → rental potential points.
export const YIELD_BANDS = [[4.5, 90], [3.5, 75], [3, 60], [2.5, 45], [2, 30]];
export const YIELD_FLOOR = 15;

export const CONFIDENCE = { high: 0.8, medium: 0.5 }; // share of total weight available

export function bandScore(category, distanceKm) {
  const def = DISTANCE_BANDS[category];
  if (!def) return null;
  if (distanceKm === null || distanceKm === undefined) return def.beyond;
  for (const [maxKm, pts] of def.bands) if (distanceKm <= maxKm) return pts;
  return def.beyond;
}

/*
 * Approximate centroids of major employment hubs. Curated by hand, so treat
 * distances as indicative only. Extend per city as coverage grows.
 */
export const EMPLOYMENT_HUBS = [
  { name: 'Cyber City, Gurugram', city: 'Gurugram', lat: 28.495, lng: 77.089 },
  { name: 'Golf Course Road business district, Gurugram', city: 'Gurugram', lat: 28.4425, lng: 77.1015 },
  { name: 'Connaught Place, Delhi', city: 'Delhi', lat: 28.6315, lng: 77.2167 },
  { name: 'Nehru Place, Delhi', city: 'Delhi', lat: 28.5491, lng: 77.2513 },
  { name: 'Aerocity, Delhi', city: 'Delhi', lat: 28.5494, lng: 77.12 },
  { name: 'Sector 62 IT hub, Noida', city: 'Noida', lat: 28.627, lng: 77.365 },
  { name: 'Noida Expressway offices (Sector 125–135)', city: 'Noida', lat: 28.53, lng: 77.36 },
  { name: 'Bandra Kurla Complex, Mumbai', city: 'Mumbai', lat: 19.066, lng: 72.868 },
  { name: 'Lower Parel, Mumbai', city: 'Mumbai', lat: 18.996, lng: 72.83 },
  { name: 'Powai business district, Mumbai', city: 'Mumbai', lat: 19.119, lng: 72.907 },
  { name: 'Nariman Point, Mumbai', city: 'Mumbai', lat: 18.9256, lng: 72.8242 },
  { name: 'Whitefield / ITPL, Bengaluru', city: 'Bengaluru', lat: 12.986, lng: 77.737 },
  { name: 'Electronic City, Bengaluru', city: 'Bengaluru', lat: 12.8452, lng: 77.6602 },
  { name: 'Outer Ring Road (Bellandur), Bengaluru', city: 'Bengaluru', lat: 12.926, lng: 77.682 },
  { name: 'MG Road CBD, Bengaluru', city: 'Bengaluru', lat: 12.975, lng: 77.606 },
  { name: 'Manyata Tech Park, Bengaluru', city: 'Bengaluru', lat: 13.045, lng: 77.62 },
  { name: 'Hinjewadi IT Park, Pune', city: 'Pune', lat: 18.591, lng: 73.738 },
  { name: 'Kharadi IT cluster, Pune', city: 'Pune', lat: 18.552, lng: 73.95 },
  { name: 'Magarpatta, Pune', city: 'Pune', lat: 18.515, lng: 73.926 },
  { name: 'HITEC City, Hyderabad', city: 'Hyderabad', lat: 17.4474, lng: 78.3762 },
  { name: 'Financial District, Hyderabad', city: 'Hyderabad', lat: 17.414, lng: 78.342 },
  { name: 'OMR IT corridor, Chennai', city: 'Chennai', lat: 12.989, lng: 80.248 },
];
