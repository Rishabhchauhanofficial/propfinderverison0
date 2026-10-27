export const LISTING_TYPES = [
  { value: 'sale', label: 'Buy' },
  { value: 'rent', label: 'Rent' },
];

export const PROPERTY_TYPES = [
  { value: 'apartment', label: 'Apartment / Flat' },
  { value: 'independent-house', label: 'Independent House' },
  { value: 'villa', label: 'Villa' },
  { value: 'builder-floor', label: 'Builder Floor' },
  { value: 'plot', label: 'Plot / Land' },
  { value: 'commercial', label: 'Commercial Space' },
  { value: 'office', label: 'Office Space' },
  { value: 'retail-shop', label: 'Retail Shop' },
];

export const COMMERCIAL_TYPES = ['commercial', 'office', 'retail-shop'];

export const FURNISHING_OPTIONS = [
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'semi-furnished', label: 'Semi-furnished' },
  { value: 'furnished', label: 'Furnished' },
];

export const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
  { value: 'sold', label: 'Sold' },
  { value: 'rented', label: 'Rented' },
];

export const BHK_OPTIONS = [1, 2, 3, 4, 5];

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'ppsf_asc', label: '₹/sq ft: low to high' },
  { value: 'ppsf_desc', label: '₹/sq ft: high to low' },
  { value: 'area_desc', label: 'Area: largest first' },
];

export const AMENITIES = [
  'Lift', 'Power Backup', 'Covered Parking', 'Gymnasium', 'Swimming Pool', '24x7 Security', 'Clubhouse',
  'Children Play Area', 'Park', 'Intercom', 'Gated Community', 'Water Supply 24x7', 'Rainwater Harvesting', 'EV Charging',
];

/** Price dropdown steps (INR). 0 means "any". */
export const SALE_PRICE_STEPS = [
  0, 2500000, 5000000, 7500000, 10000000, 15000000, 20000000, 30000000, 50000000, 100000000,
];

export const RENT_PRICE_STEPS = [0, 5000, 10000, 15000, 20000, 30000, 40000, 50000, 75000, 100000, 200000];

export const PRIORITIES = [
  { value: 'affordability', label: 'Affordability', hint: 'Weights price competitiveness' },
  { value: 'commute', label: 'Commute', hint: 'Weights connectivity and location' },
  { value: 'family', label: 'Family needs', hint: 'Weights schools, healthcare and amenities' },
  { value: 'rental', label: 'Rental income', hint: 'Weights rental potential' },
  { value: 'verification', label: 'Verified documents', hint: 'Weights documentation & RERA' },
];

export const PUBLIC_ROLES = [
  { value: 'buyer', label: 'Buyer', hint: 'Looking to buy a home or investment' },
  { value: 'tenant', label: 'Tenant', hint: 'Looking for a place to rent' },
  { value: 'owner', label: 'Property owner', hint: 'Sell or rent out your own property' },
  { value: 'agent', label: 'Agent / Realtor', hint: 'List properties and manage leads' },
  { value: 'builder', label: 'Builder / Developer', hint: 'Showcase projects and inventory' },
];

export const LISTER_ROLES = ['owner', 'agent', 'builder', 'admin'];

export const RERA_STATE_OPTIONS = [
  ['HR', 'Haryana'], ['DL', 'Delhi'], ['UP', 'Uttar Pradesh'], ['MH', 'Maharashtra'], ['KA', 'Karnataka'],
  ['TG', 'Telangana'], ['TN', 'Tamil Nadu'], ['GJ', 'Gujarat'], ['WB', 'West Bengal'], ['RJ', 'Rajasthan'],
  ['PB', 'Punjab'], ['MP', 'Madhya Pradesh'], ['KL', 'Kerala'], ['AP', 'Andhra Pradesh'], ['GA', 'Goa'], ['BR', 'Bihar'],
];

/** Default map centre: India. */
export const INDIA_CENTER = [20.5937, 78.9629];
