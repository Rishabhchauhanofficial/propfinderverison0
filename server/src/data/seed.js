import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import Property from '../models/Property.js';
import { Developer, Project, ReraRecord, Favorite, Lead, SiteVisit, AnalysisReport } from '../models/index.js';
import { bhkLabel, propertyTypeLabel } from '../utils/format.js';
import { slugify } from '../utils/slug.js';
import { authorityFor, stateCodeFor } from '../services/reraService.js';

/*
 * DEMO DATA. Every property, project and developer created here has
 * isDemo: true and is labelled "Demo" in the UI. Prices are illustrative,
 * developer names are fictional, RERA numbers contain "DEMO" and are never
 * marked verified. Photos are random placeholder images (picsum.photos).
 *
 * Re-running the seed replaces demo records only — real users and listings
 * are left untouched.
 */

const PASSWORD = 'Passw0rd!';

const USERS = [
  { key: 'admin', name: 'PropFinder Admin', email: 'admin@propfinder.in', phone: '+91 98100 00000', role: 'admin' },
  { key: 'agent', name: 'Demo Realty (Agent)', email: 'agent@propfinder.in', phone: '+91 98100 00001', role: 'agent', company: 'Demo Realty' },
  { key: 'priya', name: 'Priya Sharma (Demo Owner)', email: 'priya@example.com', phone: '+91 98100 00002', role: 'owner' },
  { key: 'demo', name: 'Demo Buyer', email: 'demo@propfinder.in', phone: '+91 98100 00003', role: 'buyer' },
  { key: 'builder', name: 'Demo Habitat Developers', email: 'builder@propfinder.in', phone: '+91 98100 00004', role: 'builder', company: 'Demo Habitat Developers' },
];
export const DEMO_EMAILS = USERS.map((u) => u.email);

// Approximate centre of each locality; each listing gets a small deterministic offset.
// [lat, lng, saleRatePerSqft, rentRatePerSqftMonth, pinCode]  — rates are illustrative demo values.
const LOCALITIES = {
  'Gurugram|DLF Phase 2': [28.4795, 77.0895, 15000, 45, '122002'],
  'Gurugram|Sector 54': [28.4398, 77.0944, 14000, 42, ''],
  'Gurugram|Golf Course Road': [28.4418, 77.1002, 18000, 55, ''],
  'Delhi|Dwarka': [28.5921, 77.046, 9000, 28, ''],
  'Delhi|Saket': [28.5244, 77.2066, 17000, 55, '110017'],
  'Delhi|Rohini': [28.7495, 77.0565, 8000, 22, '110085'],
  'Noida|Sector 62': [28.6272, 77.3649, 9000, 28, ''],
  'Noida|Sector 137': [28.513, 77.401, 6500, 22, ''],
  'Bengaluru|Whitefield': [12.9698, 77.75, 8500, 34, '560066'],
  'Bengaluru|Koramangala': [12.9352, 77.6245, 14000, 42, '560034'],
  'Bengaluru|HSR Layout': [12.9116, 77.6389, 12000, 38, '560102'],
  'Mumbai|Andheri West': [19.1364, 72.8296, 27000, 85, ''],
  'Mumbai|Powai': [19.1176, 72.906, 22000, 70, '400076'],
  'Mumbai|Bandra': [19.0596, 72.8295, 40000, 120, '400050'],
  'Pune|Hinjewadi': [18.5912, 73.7389, 7500, 28, '411057'],
  'Pune|Baner': [18.559, 73.7868, 10000, 32, '411045'],
  'Pune|Kothrud': [18.5074, 73.8077, 9500, 30, '411038'],
};

const AMENITY_POOL = [
  'Lift', 'Power Backup', 'Covered Parking', 'Gymnasium', 'Swimming Pool', '24x7 Security', 'Clubhouse',
  'Children Play Area', 'Park', 'Intercom', 'Gated Community', 'Water Supply 24x7', 'Rainwater Harvesting', 'EV Charging',
];

/*
 * Hand-written rows: [listingType, propertyType, city, locality, beds, baths, areaSqft, priceFactor, furnishing, ownerKey, extra]
 * priceFactor scales the locality's demo rate (1 = locality rate). Rent rows use the rent rate.
 */
const ROWS = [
  ['sale', 'apartment', 'Gurugram', 'DLF Phase 2', 3, 3, 1850, 1.02, 'semi-furnished', 'agent'],
  ['sale', 'apartment', 'Gurugram', 'DLF Phase 2', 2, 2, 1300, 0.93, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Gurugram', 'DLF Phase 2', 3, 3, 1700, 1.1, 'furnished', 'agent'],
  ['sale', 'builder-floor', 'Gurugram', 'DLF Phase 2', 3, 3, 1950, 0.88, 'semi-furnished', 'priya'],
  ['rent', 'apartment', 'Gurugram', 'DLF Phase 2', 3, 2, 1700, 1.05, 'furnished', 'agent'],
  ['rent', 'apartment', 'Gurugram', 'DLF Phase 2', 2, 2, 1250, 0.95, 'semi-furnished', 'priya'],
  ['rent', 'apartment', 'Gurugram', 'DLF Phase 2', 3, 3, 1800, 1.0, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Gurugram', 'Sector 54', 2, 2, 1250, 0.97, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Gurugram', 'Sector 54', 3, 3, 1900, 1.05, 'semi-furnished', 'agent'],
  ['sale', 'apartment', 'Gurugram', 'Sector 54', 4, 4, 2600, 1.12, 'furnished', 'agent'],
  ['sale', 'plot', 'Gurugram', 'Sector 54', 0, 0, 1800, 0.75, 'unfurnished', 'priya'],
  ['sale', 'independent-house', 'Gurugram', 'Sector 54', 4, 4, 3100, 0.95, 'semi-furnished', 'priya'],
  ['rent', 'apartment', 'Gurugram', 'Golf Course Road', 4, 4, 2900, 1.1, 'furnished', 'agent'],
  ['sale', 'villa', 'Gurugram', 'Golf Course Road', 5, 5, 4200, 1.0, 'furnished', 'agent'],
  ['rent', 'office', 'Gurugram', 'Golf Course Road', 0, 2, 2200, 1.4, 'semi-furnished', 'agent'],
  ['sale', 'commercial', 'Gurugram', 'DLF Phase 2', 0, 1, 900, 1.15, 'unfurnished', 'agent'],
  ['sale', 'retail-shop', 'Gurugram', 'Sector 54', 0, 1, 450, 1.6, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Delhi', 'Dwarka', 2, 2, 1150, 0.92, 'semi-furnished', 'agent'],
  ['sale', 'apartment', 'Delhi', 'Dwarka', 3, 2, 1500, 1.0, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Delhi', 'Dwarka', 3, 3, 1650, 1.08, 'semi-furnished', 'agent'],
  ['sale', 'villa', 'Delhi', 'Dwarka', 4, 4, 3600, 1.4, 'semi-furnished', 'priya'],
  ['sale', 'apartment', 'Delhi', 'Saket', 3, 3, 1950, 1.02, 'furnished', 'priya'],
  ['sale', 'builder-floor', 'Delhi', 'Saket', 3, 3, 1800, 0.96, 'semi-furnished', 'agent'],
  ['sale', 'builder-floor', 'Delhi', 'Saket', 4, 4, 2400, 1.05, 'semi-furnished', 'agent'],
  ['rent', 'apartment', 'Delhi', 'Saket', 1, 1, 650, 1.05, 'furnished', 'agent'],
  ['rent', 'commercial', 'Delhi', 'Saket', 0, 2, 1500, 1.15, 'unfurnished', 'agent'],
  ['rent', 'apartment', 'Delhi', 'Rohini', 2, 2, 1050, 0.95, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Delhi', 'Rohini', 2, 2, 950, 0.95, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Delhi', 'Rohini', 3, 2, 1300, 1.0, 'semi-furnished', 'agent'],
  ['sale', 'plot', 'Delhi', 'Rohini', 0, 0, 1200, 0.9, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Noida', 'Sector 62', 3, 3, 1800, 1.0, 'semi-furnished', 'agent'],
  ['sale', 'apartment', 'Noida', 'Sector 62', 2, 2, 1150, 0.94, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Noida', 'Sector 62', 3, 2, 1550, 1.06, 'furnished', 'agent'],
  ['rent', 'apartment', 'Noida', 'Sector 62', 2, 2, 1250, 1.0, 'furnished', 'priya'],
  ['sale', 'office', 'Noida', 'Sector 62', 0, 2, 1600, 1.3, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Noida', 'Sector 137', 2, 2, 1200, 0.95, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Noida', 'Sector 137', 3, 3, 1650, 1.0, 'semi-furnished', 'priya'],
  ['rent', 'independent-house', 'Noida', 'Sector 137', 4, 4, 2800, 0.9, 'unfurnished', 'priya'],
  ['sale', 'plot', 'Noida', 'Sector 137', 0, 0, 2400, 0.7, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Bengaluru', 'Whitefield', 3, 3, 1750, 1.0, 'semi-furnished', 'agent'],
  ['sale', 'apartment', 'Bengaluru', 'Whitefield', 2, 2, 1200, 0.93, 'unfurnished', 'priya'],
  ['sale', 'apartment', 'Bengaluru', 'Whitefield', 3, 2, 1500, 1.07, 'furnished', 'agent'],
  ['rent', 'apartment', 'Bengaluru', 'Whitefield', 2, 2, 1100, 1.05, 'furnished', 'priya'],
  ['rent', 'apartment', 'Bengaluru', 'Whitefield', 3, 3, 1600, 0.95, 'semi-furnished', 'agent'],
  ['rent', 'apartment', 'Bengaluru', 'Whitefield', 2, 2, 1150, 1.0, 'unfurnished', 'priya'],
  ['sale', 'commercial', 'Bengaluru', 'Whitefield', 0, 1, 1100, 1.4, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Bengaluru', 'Koramangala', 2, 2, 1300, 1.0, 'furnished', 'priya'],
  ['sale', 'apartment', 'Bengaluru', 'Koramangala', 3, 3, 1700, 1.06, 'semi-furnished', 'agent'],
  ['sale', 'apartment', 'Bengaluru', 'Koramangala', 2, 2, 1150, 0.94, 'unfurnished', 'agent'],
  ['rent', 'apartment', 'Bengaluru', 'Koramangala', 1, 1, 700, 1.1, 'furnished', 'agent'],
  ['sale', 'villa', 'Bengaluru', 'HSR Layout', 4, 4, 3300, 1.0, 'semi-furnished', 'priya'],
  ['sale', 'independent-house', 'Bengaluru', 'HSR Layout', 3, 3, 2200, 0.95, 'unfurnished', 'agent'],
  ['rent', 'apartment', 'Bengaluru', 'HSR Layout', 3, 3, 1650, 0.95, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Mumbai', 'Andheri West', 2, 2, 950, 1.0, 'semi-furnished', 'agent'],
  ['sale', 'apartment', 'Mumbai', 'Andheri West', 1, 1, 620, 1.05, 'furnished', 'priya'],
  ['sale', 'apartment', 'Mumbai', 'Andheri West', 3, 3, 1350, 0.95, 'semi-furnished', 'agent'],
  ['rent', 'apartment', 'Mumbai', 'Andheri West', 2, 2, 1000, 1.05, 'furnished', 'priya'],
  ['sale', 'apartment', 'Mumbai', 'Powai', 3, 3, 1500, 1.0, 'furnished', 'agent'],
  ['sale', 'apartment', 'Mumbai', 'Powai', 2, 2, 1050, 0.96, 'semi-furnished', 'priya'],
  ['sale', 'apartment', 'Mumbai', 'Powai', 2, 2, 980, 1.08, 'furnished', 'agent'],
  ['rent', 'apartment', 'Mumbai', 'Bandra', 2, 2, 900, 1.0, 'furnished', 'priya'],
  ['sale', 'apartment', 'Pune', 'Hinjewadi', 2, 2, 1050, 1.0, 'semi-furnished', 'priya'],
  ['sale', 'apartment', 'Pune', 'Hinjewadi', 3, 2, 1400, 0.95, 'unfurnished', 'agent'],
  ['sale', 'apartment', 'Pune', 'Hinjewadi', 1, 1, 650, 1.06, 'furnished', 'agent'],
  ['rent', 'apartment', 'Pune', 'Hinjewadi', 2, 2, 1000, 1.0, 'semi-furnished', 'agent'],
  ['rent', 'apartment', 'Pune', 'Baner', 3, 2, 1600, 1.0, 'furnished', 'priya'],
  ['sale', 'apartment', 'Pune', 'Baner', 2, 2, 1100, 1.0, 'semi-furnished', 'agent'],
  ['sale', 'independent-house', 'Pune', 'Kothrud', 3, 3, 2200, 0.85, 'unfurnished', 'agent'],
];

// New-project inventory (builder listings, under construction).
const PROJECTS = [
  {
    key: 'greens', name: 'Demo Greens Residency', city: 'Noida', locality: 'Sector 137', developer: 'Demo Habitat Developers',
    status: 'under-construction', possession: '2027-12-31', units: 420, landAreaSqm: 18000, rera: 'UPRERAPRJDEMO0001',
    configurations: ['2 BHK', '3 BHK'], amenities: ['Clubhouse', 'Swimming Pool', 'Gymnasium', 'Children Play Area', 'Power Backup', '24x7 Security', 'EV Charging'],
    units_rows: [['apartment', 2, 2, 1180, 1.05], ['apartment', 3, 3, 1620, 1.08], ['apartment', 3, 3, 1750, 1.1]],
  },
  {
    key: 'lakeview', name: 'Sample Lakeview Towers', city: 'Bengaluru', locality: 'Whitefield', developer: 'Sample Skyline Builders',
    status: 'under-construction', possession: '2028-06-30', units: 310, landAreaSqm: 12500, rera: 'PRM/KA/RERA/DEMO/0002',
    configurations: ['2 BHK', '3 BHK', '4 BHK'], amenities: ['Clubhouse', 'Swimming Pool', 'Gymnasium', 'Rainwater Harvesting', 'Covered Parking', 'Lift'],
    units_rows: [['apartment', 2, 2, 1250, 1.04], ['apartment', 3, 3, 1680, 1.07], ['apartment', 4, 4, 2400, 1.12]],
  },
  {
    key: 'hillside', name: 'Demo Hillside Homes', city: 'Pune', locality: 'Baner', developer: 'Demo Habitat Developers',
    status: 'pre-launch', possession: '2029-03-31', units: 180, landAreaSqm: 8000, rera: 'P5210000DEMO03',
    configurations: ['2 BHK', '3 BHK'], amenities: ['Clubhouse', 'Gymnasium', 'Park', 'Power Backup', 'Lift'],
    units_rows: [['apartment', 2, 2, 1080, 1.06], ['apartment', 3, 3, 1450, 1.09]],
  },
];

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function buildTitle(listingType, propertyType, bedrooms, areaSqft, locality, city) {
  if (propertyType === 'plot') return `${areaSqft} sq ft Residential Plot in ${locality}, ${city}`;
  const rentSuffix = listingType === 'rent' ? ' for Rent' : '';
  const headline = [bhkLabel(bedrooms), propertyTypeLabel(propertyType)].filter(Boolean).join(' ');
  return `${headline}${rentSuffix} in ${locality}, ${city}`;
}

function buildProperty(row, index, ownerIds, extra = {}) {
  const [listingType, propertyType, city, locality, bedrooms, bathrooms, areaSqft, factor, furnishing, ownerKey] = row;
  const [baseLat, baseLng, saleRate, rentRate, pin] = LOCALITIES[`${city}|${locality}`];
  const commercial = ['commercial', 'office', 'retail-shop'].includes(propertyType);
  const rate = listingType === 'sale' ? saleRate * (commercial ? 1.2 : 1) * (propertyType === 'plot' ? 1 : 1) : rentRate * (commercial ? 1.3 : 1);
  const rawPrice = rate * factor * areaSqft;
  const price = listingType === 'sale' ? Math.round(rawPrice / 100000) * 100000 : Math.round(rawPrice / 500) * 500;

  const latOffset = (((index * 37) % 11) - 5) * 0.0011;
  const lngOffset = (((index * 53) % 11) - 5) * 0.0011;
  const isPlot = propertyType === 'plot';
  const title = buildTitle(listingType, propertyType, bedrooms, areaSqft, locality, city);
  const ageYears = extra.constructionStatus === 'under-construction' ? null : isPlot ? null : (index * 7) % 18;
  const floor = isPlot || propertyType === 'villa' || propertyType === 'independent-house' ? null : (index * 3) % 14;
  const totalFloors = floor === null ? null : Math.max(floor + 1, 4 + ((index * 5) % 20));

  const sizeText = isPlot
    ? `Plot area ${areaSqft} sq ft.`
    : `${areaSqft} sq ft built-up${bedrooms ? ` with ${bedrooms} bedroom${bedrooms === 1 ? '' : 's'}` : ''} and ${bathrooms} bathroom${bathrooms === 1 ? '' : 's'}.`;
  const description =
    `DEMO LISTING — sample data for illustrating PropFinder, not a real property. ${title}. ${sizeText}` +
    `${isPlot ? '' : ` ${capitalise(furnishing)}.`}${floor !== null ? ` Floor ${floor} of ${totalFloors}.` : ''}`;

  const amenityCount = isPlot ? 2 : 3 + (index % 7);
  const amenities = extra.amenities || Array.from({ length: amenityCount }, (_, k) => AMENITY_POOL[(index + k * 5) % AMENITY_POOL.length]);
  const imageCount = 3 + (index % 2);
  const images = Array.from({ length: imageCount }, (_, k) => `https://picsum.photos/seed/pf-${index + 1}-${k + 1}/960/640`);

  return {
    title,
    slug: `${slugify(title)}-${index + 1}`,
    description,
    listingType,
    propertyType,
    status: 'active',
    price,
    areaSqft,
    carpetAreaSqft: isPlot ? null : index % 3 === 0 ? null : Math.round(areaSqft * 0.74),
    plotAreaSqft: isPlot ? areaSqft : null,
    bedrooms,
    bathrooms,
    furnishing,
    floor,
    totalFloors,
    ageYears,
    constructionStatus: extra.constructionStatus || (isPlot ? '' : 'ready'),
    possessionDate: extra.possessionDate || null,
    maintenanceMonthly: isPlot || listingType === 'rent' ? null : Math.round((areaSqft * (2 + (index % 4))) / 100) * 100,
    securityDeposit: listingType === 'rent' ? price * 2 : null,
    city,
    locality,
    state: authorityFor(stateCodeFor({ city }))?.state || '',
    pinCode: pin,
    address: `${locality}, ${city}`,
    location: { lat: Number((baseLat + latOffset).toFixed(6)), lng: Number((baseLng + lngOffset).toFixed(6)) },
    amenities,
    images,
    owner: ownerIds[ownerKey],
    postedByRole: ownerKey === 'agent' ? 'agent' : ownerKey === 'builder' ? 'builder' : 'owner',
    project: extra.project || null,
    developerName: extra.developerName || '',
    rera: extra.rera || { number: '', state: '', status: listingType === 'rent' ? 'not-applicable' : 'not-provided' },
    isDemo: true,
    views: (index * 17) % 180,
  };
}

/** Removes previous demo records only. */
async function clearDemo() {
  const demoProps = await Property.find({ isDemo: true }).select('_id').lean();
  const ids = demoProps.map((p) => p._id);
  await Promise.all([
    ReraRecord.deleteMany({ $or: [{ property: { $in: ids } }, { registrationNumber: /DEMO/ }] }),
    Favorite.deleteMany({ property: { $in: ids } }),
    Lead.deleteMany({ property: { $in: ids } }),
    SiteVisit.deleteMany({ property: { $in: ids } }),
    AnalysisReport.deleteMany({ property: { $in: ids } }),
  ]);
  await Property.deleteMany({ isDemo: true });
  await Project.deleteMany({ isDemo: true });
  await Developer.deleteMany({ isDemo: true });
}

/**
 * Populate the database with demo data. Assumes a live mongoose connection.
 * Returns { users, properties, projects, byCity }.
 */
export async function seedDatabase() {
  await clearDemo();

  const ownerIds = {};
  for (const u of USERS) {
    if (u.role === 'admin' && process.env.NODE_ENV === 'production' && process.env.SEED_ADMIN !== 'true') continue;
    let user = await User.findOne({ email: u.email });
    if (!user) {
      user = new User({ name: u.name, email: u.email, phone: u.phone, role: u.role, company: u.company || '' });
      await user.setPassword(PASSWORD);
      await user.save();
    }
    ownerIds[u.key] = user._id;
  }

  const docs = ROWS.map((row, i) => buildProperty(row, i, ownerIds));

  let projectCount = 0;
  for (const def of PROJECTS) {
    const developer = await Developer.create({
      name: def.developer === 'Demo Habitat Developers' ? `${def.developer}` : def.developer,
      website: '',
      description: 'Fictional developer created for demo data. Any description shown is a claim supplied by the developer, not verified by PropFinder.',
      account: def.developer === 'Demo Habitat Developers' ? ownerIds.builder : null,
      isDemo: true,
    }).catch(async () => Developer.findOne({ name: def.developer }));

    const [lat, lng, saleRate] = LOCALITIES[`${def.city}|${def.locality}`];
    const code = stateCodeFor({ city: def.city });
    const project = await Project.create({
      name: def.name,
      slug: slugify(`${def.name} ${def.locality} ${def.city}`),
      developer: developer._id,
      developerName: def.developer,
      city: def.city,
      locality: def.locality,
      state: authorityFor(code)?.state || '',
      description: `DEMO PROJECT — fictional sample data. ${def.name} is shown to illustrate project pages, RERA workflows and builder dashboards.`,
      status: def.status,
      launchDate: new Date('2025-01-15'),
      possessionDate: new Date(def.possession),
      totalUnits: def.units,
      landAreaSqm: def.landAreaSqm,
      configurations: def.configurations,
      priceFrom: Math.round((saleRate * def.units_rows[0][3] * def.units_rows[0][4]) / 100000) * 100000,
      priceTo: Math.round((saleRate * def.units_rows.at(-1)[3] * def.units_rows.at(-1)[4]) / 100000) * 100000,
      amenities: def.amenities,
      images: [1, 2, 3].map((k) => `https://picsum.photos/seed/pf-proj-${def.key}-${k}/1200/700`),
      location: { lat, lng },
      rera: { number: def.rera, state: code, status: 'not-verified' },
      createdBy: ownerIds.builder,
      isDemo: true,
    });
    projectCount += 1;
    const authority = authorityFor(code);
    await ReraRecord.create({
      project: project._id,
      registrationNumber: def.rera,
      state: code,
      authority: authority?.authority || '',
      officialUrl: authority?.url || '',
      status: 'not-verified',
      statusNote: 'Demo registration number — cannot be verified.',
      submitted: { projectName: def.name, promoterName: def.developer, possessionDate: new Date(def.possession) },
      history: [{ status: 'not-verified', note: 'Seeded demo record.' }],
    });

    def.units_rows.forEach(([type, beds, baths, area, factor], k) => {
      docs.push(
        buildProperty(['sale', type, def.city, def.locality, beds, baths, area, factor, 'unfurnished', 'builder'], docs.length + k, ownerIds, {
          project: project._id,
          developerName: def.developer,
          constructionStatus: 'under-construction',
          possessionDate: new Date(def.possession),
          amenities: def.amenities,
          rera: { number: def.rera, state: code, status: 'not-verified' },
        })
      );
    });
  }

  const inserted = await Property.insertMany(docs);
  // RERA records per builder listing (verification is per project, mirrored for each listing).
  const reraDocs = inserted
    .filter((p) => p.rera?.number)
    .map((p) => ({
      property: p._id,
      project: p.project,
      registrationNumber: p.rera.number,
      state: p.rera.state,
      authority: authorityFor(p.rera.state)?.authority || '',
      officialUrl: authorityFor(p.rera.state)?.url || '',
      status: 'not-verified',
      statusNote: 'Demo registration number — cannot be verified.',
      submitted: { projectName: PROJECTS.find((d) => d.rera === p.rera.number)?.name || '', promoterName: p.developerName, possessionDate: p.possessionDate },
      history: [{ status: 'not-verified', note: 'Seeded demo record.' }],
    }));
  if (reraDocs.length) await ReraRecord.insertMany(reraDocs);

  const byCity = {};
  for (const d of docs) byCity[d.city] = (byCity[d.city] || 0) + 1;

  return {
    users: await User.countDocuments(),
    properties: await Property.countDocuments({ isDemo: true }),
    projects: projectCount,
    byCity,
  };
}

// CLI entry point: `npm run seed` / `node src/data/seed.js`
async function main() {
  await connectDB();
  const result = await seedDatabase();
  console.log(`Users in database: ${result.users}`);
  console.log(`Demo properties created: ${result.properties}`);
  console.log(`Demo projects created: ${result.projects}`);
  console.log('Demo properties per city:', result.byCity);
  await disconnectDB();
  process.exit(0);
}

// Only run the CLI flow when executed directly (not when imported for auto-seed).
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/data/seed.js');

if (invokedDirectly) {
  main().catch(async (err) => {
    console.error('Seed failed:', err);
    try {
      await disconnectDB();
    } catch {
      // ignore disconnect errors during failure handling
    }
    process.exit(1);
  });
}
