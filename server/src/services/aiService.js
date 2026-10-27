import { bhkLabel, formatINR, propertyTypeLabel } from '../utils/format.js';
import { isValidCoords } from '../utils/geo.js';
import { complete, llmEnabled, parseJsonObject, asData, UNTRUSTED_RULE } from './llmService.js';

/*
 * SEO / marketing copy and listing-description drafting.
 * Rule-based by default; an LLM (see llmService) may rewrite the copy from
 * the listing facts. Public functions never throw.
 * The property intelligence report lives in analysisService.js.
 */

const truncate = (text, max) => {
  const t = String(text ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
};

const plain = (property) =>
  property && typeof property.toObject === 'function' ? property.toObject() : { ...(property || {}) };

const nonEmptyString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// ---------------------------------------------------------------------------
// Public: marketing content
// ---------------------------------------------------------------------------

function buildJsonLd(p, { isRent, siteUrl, title, typeLabel }) {
  const id = p._id ? String(p._id) : null;
  const url = id ? `${siteUrl}/property/${p.slug || id}` : siteUrl;
  const residential = ['apartment', 'villa', 'independent-house'].includes(p.propertyType);
  const hasGeo = isValidCoords(p.location);

  const offer = {
    '@type': 'Offer',
    price: p.price,
    priceCurrency: 'INR',
    availability: 'https://schema.org/InStock',
  };
  if (isRent) {
    offer.priceSpecification = {
      '@type': 'UnitPriceSpecification',
      price: p.price,
      priceCurrency: 'INR',
      unitText: 'MONTH',
    };
  }

  const about = {
    '@type': residential ? 'Residence' : 'Place',
    name: typeLabel,
    ...(p.bedrooms ? { numberOfRooms: p.bedrooms } : {}),
    ...(p.bathrooms ? { numberOfBathroomsTotal: p.bathrooms } : {}),
    ...(p.areaSqft ? { floorSize: { '@type': 'QuantitativeValue', value: p.areaSqft, unitCode: 'FTK' } } : {}),
    ...(Array.isArray(p.amenities) && p.amenities.length
      ? {
          amenityFeature: p.amenities.map((name) => ({
            '@type': 'LocationFeatureSpecification',
            name,
            value: true,
          })),
        }
      : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.address || p.locality,
      addressLocality: p.city,
      addressCountry: 'IN',
    },
  };
  if (hasGeo) {
    about.geo = { '@type': 'GeoCoordinates', latitude: p.location.lat, longitude: p.location.lng };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: title,
    description: p.description || title,
    url,
    ...(p.createdAt ? { datePosted: new Date(p.createdAt).toISOString() } : {}),
    ...(Array.isArray(p.images) && p.images.length ? { image: p.images } : {}),
    offers: offer,
    about,
  };
}

function heuristicMarketing(input) {
  const p = plain(input);
  const isRent = p.listingType === 'rent';
  const typeLabel = propertyTypeLabel(p.propertyType);
  const headline = [bhkLabel(p.bedrooms), typeLabel].filter(Boolean).join(' ');
  const action = isRent ? 'for Rent' : 'for Sale';
  const price = `${formatINR(p.price)}${isRent ? '/month' : ''}`;
  const area = p.areaSqft ? `${p.areaSqft} sq ft` : '';
  const where = `${p.locality}, ${p.city}`;

  const seoTitle = truncate(`${headline} ${action} in ${where} | ${price}`, 60);

  const metaDescription = truncate(
    `${headline} ${action.toLowerCase()} in ${where} at ${price}` +
      `${area ? `, ${area}` : ''}${p.furnishing ? `, ${p.furnishing}` : ''}. ` +
      'See photos, amenities and price insights on PropFinder.',
    160
  );

  const keywords = [
    headline,
    `${typeLabel} in ${p.locality}`,
    `property in ${p.locality}`,
    `${p.locality} ${isRent ? 'rent' : 'real estate'}`,
    `${p.city} ${isRent ? 'rental property' : 'property for sale'}`,
    `${p.furnishing || 'property'} ${typeLabel}`,
    `${p.city} ${typeLabel}`,
    `${headline} ${isRent ? 'for rent' : 'for sale'} ${p.city}`,
  ]
    .map((k) => k.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const uniqueKeywords = [...new Set(keywords)].slice(0, 8);

  const hashtag = (s) => `#${String(s).replace(/[^A-Za-z0-9]/g, '')}`;
  const socialCaption = [
    `${headline} ${action} in ${where}`,
    `Price: ${price}`,
    area ? `Area: ${area}` : null,
    Array.isArray(p.amenities) && p.amenities.length
      ? `Highlights: ${p.amenities.slice(0, 3).join(', ')}`
      : null,
    'View details on PropFinder.',
    `${hashtag(p.city)} ${hashtag(p.locality)} #RealEstate ${isRent ? '#Rent' : '#Sale'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const siteUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const title = `${headline} ${action} in ${where}`;
  const jsonLd = buildJsonLd(p, { isRent, siteUrl, title, typeLabel });

  return { seoTitle, metaDescription, keywords: uniqueKeywords, socialCaption, jsonLd, source: 'heuristic' };
}

export async function marketingContent(property) {
  const base = heuristicMarketing(property);
  if (!llmEnabled()) return base;

  try {
    const p = plain(property);
    const facts = {
      title: p.title,
      description: truncate(p.description || '', 600),
      listingType: p.listingType,
      propertyType: propertyTypeLabel(p.propertyType),
      price: formatINR(p.price),
      bedrooms: p.bedrooms,
      areaSqft: p.areaSqft,
      furnishing: p.furnishing,
      city: p.city,
      locality: p.locality,
      amenities: (p.amenities || []).slice(0, 10),
    };

    const raw = await complete(
      `You write concise, honest real-estate marketing copy for Indian property listings. Use only the listing facts; do not invent amenities, distances or claims. ${UNTRUSTED_RULE} Respond ONLY with a single JSON object, no markdown, no emojis.`,
      [
        {
          role: 'user',
          content:
            'Return JSON with exactly these keys: ' +
            '{"seoTitle": string (max 60 chars), "metaDescription": string (max 160 chars), ' +
            '"keywords": [8 lowercase strings], "socialCaption": string (max 280 chars)}.\n' +
            asData('listing', facts),
        },
      ],
      { maxTokens: 800, json: true }
    );

    const parsed = parseJsonObject(raw);
    const seoTitle = nonEmptyString(parsed.seoTitle);
    const metaDescription = nonEmptyString(parsed.metaDescription);
    const socialCaption = nonEmptyString(parsed.socialCaption);
    const keywords = Array.isArray(parsed.keywords)
      ? [...new Set(parsed.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, 8)
      : [];

    return {
      seoTitle: seoTitle ? truncate(seoTitle, 60) : base.seoTitle,
      metaDescription: metaDescription ? truncate(metaDescription, 160) : base.metaDescription,
      keywords: keywords.length ? keywords : base.keywords,
      socialCaption: socialCaption ? truncate(socialCaption, 280) : base.socialCaption,
      jsonLd: base.jsonLd,
      source: 'llm',
    };
  } catch (err) {
    console.warn(`[aiService] LLM marketing unavailable, using heuristic: ${err.message}`);
    return base;
  }
}

// ---------------------------------------------------------------------------
// Public: listing description draft (for owners / agents)
// ---------------------------------------------------------------------------

function heuristicDescription(p) {
  const typeText = [bhkLabel(p.bedrooms), propertyTypeLabel(p.propertyType)].filter(Boolean).join(' ');
  const isRent = p.listingType === 'rent';
  const lines = [
    `${typeText} ${isRent ? 'available for rent' : 'for sale'} in ${p.locality}, ${p.city}.`,
    p.areaSqft ? `Built-up area ${p.areaSqft} sq ft${p.carpetAreaSqft ? ` (carpet ${p.carpetAreaSqft} sq ft)` : ''}.` : '',
    p.bedrooms ? `${p.bedrooms} bedroom${p.bedrooms > 1 ? 's' : ''} and ${p.bathrooms || 0} bathroom${p.bathrooms === 1 ? '' : 's'}.` : '',
    p.floor != null && p.totalFloors ? `On floor ${p.floor} of ${p.totalFloors}.` : '',
    p.furnishing && p.propertyType !== 'plot' ? `${p.furnishing.charAt(0).toUpperCase()}${p.furnishing.slice(1)}.` : '',
    p.constructionStatus === 'ready' ? 'Ready to move.' : p.constructionStatus === 'under-construction' ? 'Under construction.' : '',
    Array.isArray(p.amenities) && p.amenities.length ? `Amenities: ${p.amenities.slice(0, 8).join(', ')}.` : '',
    p.price ? `Asking ${isRent ? 'rent' : 'price'}: ${formatINR(p.price)}${isRent ? ' per month' : ''}.` : '',
  ];
  return lines.filter(Boolean).join(' ');
}

/** Drafts a factual listing description from structured fields. */
export async function draftDescription(input) {
  const p = plain(input);
  const base = { description: heuristicDescription(p), source: 'rules' };
  if (!llmEnabled()) return base;
  try {
    const facts = {
      propertyType: propertyTypeLabel(p.propertyType), listingType: p.listingType, bedrooms: p.bedrooms, bathrooms: p.bathrooms,
      areaSqft: p.areaSqft, carpetAreaSqft: p.carpetAreaSqft, floor: p.floor, totalFloors: p.totalFloors, furnishing: p.furnishing,
      constructionStatus: p.constructionStatus, locality: p.locality, city: p.city, amenities: (p.amenities || []).slice(0, 12),
      price: p.price, ownerNotes: truncate(p.description || '', 800),
    };
    const raw = await complete(
      `You draft honest Indian property listing descriptions (90-160 words, plain English, no emojis, no superlatives you cannot support). Use only the provided facts. Never invent distances, nearby places, views, approvals or RERA status. ${UNTRUSTED_RULE} Respond with JSON {"description": string}.`,
      [{ role: 'user', content: asData('listing-fields', facts) }],
      { maxTokens: 600, json: true }
    );
    const text = nonEmptyString(parseJsonObject(raw).description);
    return text ? { description: truncate(text, 2000), source: 'llm' } : base;
  } catch (err) {
    console.warn(`[aiService] LLM description unavailable: ${err.message}`);
    return base;
  }
}
