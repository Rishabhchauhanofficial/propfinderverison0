/*
 * Knowledge base for the assistant (retrieved by keyword, cited in answers).
 * General information only — rules change and vary by state. Each article
 * says so. Review these periodically.
 */
export const KNOWLEDGE = [
  {
    id: 'kb-booking-checklist',
    title: 'What to verify before paying a booking amount',
    keywords: ['booking', 'token', 'advance', 'verify', 'before paying', 'checklist', 'documents', 'due diligence', 'safe'],
    body:
      'Before paying any booking or token amount: (1) confirm the project RERA registration on the state RERA portal and that the registered promoter matches the seller; (2) ask for the title documents, encumbrance certificate and approved building plan and have a property lawyer review them; (3) for ready units, ask for the occupancy/completion certificate; (4) get the carpet area in writing — RERA requires sale by carpet area for registered projects; (5) read the builder–buyer agreement and cancellation/refund terms before paying; (6) pay only by traceable bank transfer to the account named in the agreement, never cash, and get a receipt; (7) for resale, check society NOC and pending dues. This is general guidance, not legal advice.',
  },
  {
    id: 'kb-rera-basics',
    title: 'RERA registration basics',
    keywords: ['rera', 'registration', 'registered', 'approved', 'authority', 'real estate regulatory'],
    body:
      'The Real Estate (Regulation and Development) Act, 2016 requires most new projects to be registered with the RERA authority of the state or union territory where they are located before they are advertised or sold. Each state runs its own portal, so check the authority for the project location. Registration is generally not required where the land is 500 sq m or less or 8 or fewer apartments are planned (states can set lower limits), and for projects completed before the Act took effect. A RERA registration shows the project is registered; it does not prove clear title, quality of construction or full legal compliance. On PropFinder, "RERA registration verified" means a reviewer matched the number and details against the official record.',
  },
  {
    id: 'kb-area-types',
    title: 'Carpet area vs built-up vs super built-up',
    keywords: ['carpet', 'built-up', 'built up', 'super built', 'super area', 'area', 'sq ft', 'loading'],
    body:
      'Carpet area is the usable floor area inside the walls of the unit (RERA defines it to exclude external walls, service shafts and exclusive balconies). Built-up area adds wall thickness and often balconies. Super built-up area also adds a share of common areas such as lobbies and lifts; the difference ("loading") is commonly 20–40%. Compare prices on the same basis — price per sq ft on super built-up looks lower than on carpet area for the same flat.',
  },
  {
    id: 'kb-stamp-duty',
    title: 'Stamp duty and registration charges',
    keywords: ['stamp duty', 'registration charge', 'registration fee', 'circle rate', 'ready reckoner', 'taxes', 'extra cost'],
    body:
      'Stamp duty and registration charges are set by each state and change from time to time; stamp duty is commonly in the 5–7% range of the property value, with concessions in some states for women buyers, and registration fees are usually around 1%. Duty is charged on the higher of the agreement value and the government guidance value (circle rate / ready reckoner rate). Check the current rates on your state’s registration department website before budgeting.',
  },
  {
    id: 'kb-home-loan',
    title: 'Home loan basics and EMI',
    keywords: ['home loan', 'loan', 'emi', 'interest', 'ltv', 'down payment', 'bank', 'mortgage', 'eligibility'],
    body:
      'RBI caps the loan-to-value ratio for housing loans: up to 90% of the property value for loans up to ₹30 lakh, 80% for ₹30–75 lakh, and 75% above ₹75 lakh, so plan the remaining down payment plus stamp duty and registration from savings. EMI = P × r × (1+r)^n / ((1+r)^n − 1), where P is the loan amount, r the monthly interest rate and n the number of months. Interest rates vary by lender and borrower profile; compare offers and the total cost, not only the EMI. Lenders run their own legal and technical checks on the property.',
  },
  {
    id: 'kb-tds',
    title: 'TDS when buying property',
    keywords: ['tds', '194-ia', '194ia', 'tax deducted', 'nri', 'income tax'],
    body:
      'Under Section 194-IA of the Income-tax Act, a buyer of immovable property (other than agricultural land) worth ₹50 lakh or more must deduct TDS at 1% of the consideration and deposit it using Form 26QB. Different rules apply when the seller is a non-resident. Confirm the current rules with a tax professional.',
  },
  {
    id: 'kb-renting',
    title: 'Renting a home: agreements and deposits',
    keywords: ['rent', 'rental agreement', 'lease', 'tenant', 'deposit', 'security deposit', 'landlord', 'police verification', '11 month'],
    body:
      'Many rental agreements run for 11 months to avoid compulsory registration, which applies to leases of 12 months or more under the Registration Act; registration and stamp duty rules vary by state. The Model Tenancy Act, 2021 suggests a security deposit of at most two months’ rent for residential premises, but it applies only where a state has adopted it. Agree in writing on rent, deposit, notice period, lock-in, maintenance and repairs, and complete tenant police verification where your city requires it.',
  },
  {
    id: 'kb-rental-yield',
    title: 'Rental yield and investment maths',
    keywords: ['yield', 'rental yield', 'investment', 'roi', 'return', 'rental income', 'appreciation'],
    body:
      'Gross rental yield = annual rent ÷ purchase price × 100. Net yield also subtracts maintenance, property tax, vacancy months, brokerage and repairs, and is usually 1–1.5 percentage points lower. Residential gross yields in large Indian cities are often around 2–4%. PropFinder estimates rent from comparable rental listings on the platform (asking rents) and shows the sample size; it does not forecast appreciation.',
  },
  {
    id: 'kb-site-visit',
    title: 'Site visit checklist',
    keywords: ['site visit', 'visit', 'inspect', 'inspection', 'what to check', 'viewing'],
    body:
      'On a site visit check: water pressure and supply hours, seepage or damp patches, electrical points and earthing, mobile signal, natural light and ventilation, parking allocation, lift and power backup, the actual commute at peak hours, noise at different times of day, and — for under-construction projects — the construction stage against the schedule shared with RERA. Talk to residents or the society office where possible.',
  },
  {
    id: 'kb-scores',
    title: 'How PropFinder scores work',
    keywords: ['score', 'scoring', 'how do you calculate', 'methodology', 'suitability', 'ai analysis', 'confidence', 'accurate'],
    body:
      'Each property report has separate scores for location, connectivity, amenities, education access, healthcare access, price competitiveness, rental potential and documentation. Locality scores use straight-line distances to facilities from the configured map source; price scores compare asking price per sq ft with comparable active listings; documentation reflects what the lister disclosed and what was verified. Missing data gives no score rather than a guess, and lowers confidence. Scores are estimates, not guarantees. The full methodology is on the /methodology page.',
  },
  {
    id: 'kb-listing-help',
    title: 'How to list a property on PropFinder',
    keywords: ['list my', 'post property', 'sell my', 'rent out', 'add listing', 'publish', 'list property', 'advertise'],
    body:
      'Create an account as an owner, agent or builder, then use "Post property". Add the transaction type, price, built-up and carpet area, exact location (use the map search), photos and amenities. For new projects, add the RERA number and state; our team verifies it against the official portal and you can upload the registration certificate as evidence. You can save a draft, then publish, pause or archive the listing from your dashboard, and use "Draft with AI" to write a factual description.',
  },
  {
    id: 'kb-safety-scams',
    title: 'Avoiding common rental and sale scams',
    keywords: ['scam', 'fraud', 'fake', 'cheat', 'genuine', 'trust', 'army officer', 'pay first'],
    body:
      'Be wary of anyone who asks for a deposit or "visit fee" before you have seen the property, claims to be posted out of town and cannot meet, pressures you to decide immediately, or asks for payment to a personal account that does not match the owner. Verify ownership documents, meet in person and never share OTPs. Report suspicious listings with the "Report" button so moderators can review them.',
  },
];

const tokenize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

/** Small keyword retriever: phrase hits on keywords weigh most, then word overlap. */
export function searchKnowledge(query, limit = 2) {
  const q = String(query || '').toLowerCase();
  const words = new Set(tokenize(q));
  return KNOWLEDGE.map((a) => {
    let score = 0;
    for (const k of a.keywords) if (q.includes(k)) score += 3;
    for (const w of tokenize(a.title)) if (words.has(w)) score += 1;
    return { a, score };
  })
    .filter((r) => r.score >= 3)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((r) => r.a);
}
