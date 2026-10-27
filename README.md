# PropFinder 🏠 — AI-powered property intelligence for India

A full-stack **MERN** real-estate marketplace (buy, rent, commercial, new projects) where every listing comes with the evidence: nearby facilities from map data, price vs comparable listings, RERA registration status with sources, moderated reviews, and a grounded AI assistant.

> Stack: MongoDB + Mongoose · Express · React 18 (Vite) · Node ≥ 18 · Leaflet/OpenStreetMap · JWT · optional Anthropic / OpenAI.

---

## Quick start

```bash
# 1. backend
cd server
cp .env.example .env      # optional — defaults work
npm install
npm run dev               # http://localhost:5000  (auto-loads demo data into an empty DB)

# 2. frontend (new terminal)
cd client
npm install
npm run dev               # http://localhost:5173
```

On Windows you can double-click `start.bat`.

Without `MONGODB_URI`, the API starts an **in-memory MongoDB** (it downloads a `mongod` binary once). Data is lost on restart, so use a real MongoDB for anything you want to keep.

### Demo accounts (password `Passw0rd!`)

| Role | Email |
|---|---|
| Admin | `admin@propfinder.in` (not created in production unless `SEED_ADMIN=true`) |
| Agent | `agent@propfinder.in` |
| Owner | `priya@example.com` |
| Builder | `builder@propfinder.in` |
| Buyer | `demo@propfinder.in` |

**All seeded listings, projects and developers are demo data.** They are flagged `isDemo` and shown with a "Demo" badge. Prices are illustrative, developer names are fictional, the RERA numbers contain "DEMO" and are never marked verified, and the photos are random placeholders. `npm run seed` replaces only demo records; it does not touch real users or listings.

---

## What's included

| Area | Highlights |
|---|---|
| **Search** | Server-side filters: city, locality, PIN, type (multi), budget, ₹/sq ft, BHK, baths, built-up/carpet/plot area, furnishing, age, ready vs under-construction, possession date, developer, RERA verified, PropFinder-checked, posted by, amenities, near metro/school/hospital, near me (`$geoNear`). Relevance, price, ₹/sq ft and area sorts, autocomplete, list and map views, pagination, saved searches with new-match counts. |
| **Pages** | Home, Buy, Rent, Commercial, New projects and project detail, Property detail, Locality insights, Compare, Saved, AI assistant, Login/Register/Forgot/Reset, Profile, Owner/Agent/Builder dashboard, Post/Edit listing, Admin console, Contact, Methodology, RERA guide. |
| **AI Property Intelligence Report** | 8 scores (location, connectivity, amenities, education, healthcare, price, rental, documentation), each with method, inputs and confidence. Missing data gives **null**, never a guess. Personalised weights (affordability, commute, family, rental, verification), budget fit and commute distance. Price vs comparable asking prices with sample size and period. Rental yield from comparable rents. Nearby facilities on an interactive map with category toggles. Watch-outs, a limitations list and a disclaimer. Reports are cached and rebuilt when inputs change. |
| **RERA** | 16 state/UT authorities mapped by location; explicit states (verified, needs review, not verified, mismatch, not found, not applicable). Manual review workflow with official-URL evidence, automatic discrepancy detection, private evidence uploads, history and audit log. Changing the number resets verification. Applicability and exemption notes, plus a legal due-diligence checklist. |
| **Reviews** | 7 rating dimensions, self-declared relationship (verified only by an admin), one review per target, spam, duplicate and new-account flags → moderation queue, reports never auto-hide content, lister replies (no deletion), rating distributions. |
| **AI assistant** | Floating widget plus a full page; streamed (SSE) replies; intent parsing → retrieval of real listings, reports, RERA records, and knowledge-base articles → grounded answer with clickable property cards, citations, follow-up suggestions and an inline site-visit form. Realtor tools: "my leads", "my listings", "matching buyers" (scoped to the signed-in lister). Persisted history. Retrieved content is wrapped as untrusted data to resist prompt injection. |
| **Listers** | 5-step form (drafts, address geocoding, map pin, carpet area, RERA, private documents, AI description draft), duplicate detection, publish/pause/archive/sold, lead pipeline with notes and follow-ups, site-visit confirmation, performance analytics, builder projects. |
| **Admin** | Overview, RERA queue, review moderation, reports, listing moderation (pause, mark checked, typed-confirmation delete), users (role, suspend with reason + confirmation), AI jobs (re-run), integration health, privacy-preserving search analytics, audit log, support inbox. |
| **Security** | Server-side role checks everywhere, helmet, CORS allow-list, rate limits (auth, writes, AI, chat), input cleaning and field allow-lists, magic-byte upload validation, private documents behind auth, owner phone revealed only via a logged lead, password reset with hashed single-use tokens, suspended accounts blocked (including existing tokens), no query strings logged, generic 5xx messages. |
| **SEO / performance** | Slug URLs, per-page meta, OG tags, JSON-LD (`RealEstateListing`, breadcrumbs), sitemap (listings, localities, projects, section pages), robots.txt, `noindex` on demo/private pages, code-split routes and vendor chunks, lazy images, skeleton loaders, error boundary. |
| **UX** | Scroll reveals, parallax hero, animated counters, gallery cross-fade with swipe/lightbox, animated score bars, AI-loading animations, chat open/close and message transitions, toasts, modals with focus trapping, skip link, keyboard-accessible autocomplete. `prefers-reduced-motion` turns animations off. |

---

## External services & configuration

All variables are documented in [`server/.env.example`](server/.env.example).

| Service | Default | To change it |
|---|---|---|
| **Nearby places** | OpenStreetMap **Overpass** public mirrors (no key, ODbL attribution shown). Public servers can take 30–60 s per query, so lookups run in the background: the report shows "Fetching nearby facilities…" and refreshes itself. Results are cached for 30 days. | For production, run your own Overpass instance (`OVERPASS_URL`) or set `NEARBY_PROVIDER=google` + `GOOGLE_MAPS_API_KEY` (Places API (New); adds ratings with attribution). Set usage quotas in Google Cloud. |
| **Routing / travel time** | Off; only straight-line distances are shown (and labelled that way). | `ROUTING_PROVIDER=osrm` + `OSRM_URL` (self-hosted OSRM). |
| **Geocoding** | OpenStreetMap Nominatim, throttled to 1 request/s and cached. | `NOMINATIM_URL` for your own instance, or `GEOCODER=none`. |
| **AI** | Rule-based narratives, comparisons, drafts and chat. | `AI_PROVIDER=anthropic` + `AI_API_KEY` (official `@anthropic-ai/sdk`, default model `claude-opus-5-5`, `AI_EFFORT=low`, server-side refusal fallback on; `AI_FALLBACKS=off` disables it) or `AI_PROVIDER=openai`. On any provider error the API falls back to rules automatically. Keys stay on the server. |
| **RERA** | Manual verification against state portals (no state offers a documented public API we can call). | Add an adapter in `server/src/services/reraService.js` → `officialAdapters` once you have permitted access to a feed. |
| **Email / SMS** | Not configured. In-app notifications work. Outside production, OTP codes and reset links are returned to the UI for testing. | Add a transport in `notificationService.js` and in `authController.forgotPassword` / `otpRequest`. |
| **File storage** | Local disk (`server/uploads`, `server/uploads-private`). | `UPLOADS_DIR` / `PRIVATE_UPLOADS_DIR`, or swap in S3-compatible storage in `uploadController.js`. |
| **Market data** | Comparable **asking** prices from listings on the platform. | No licensed transaction-history source is integrated, so there are no price trends or appreciation estimates. |

Housing.com and 99acres were used as product references only. No content, listings or photos are scraped or copied.

---

## Database & migrations

Mongoose models: `User`, `Property` and `models/index.js` (Developer, Project, ReraRecord, Review, Report, Favorite, SavedSearch, Lead, SiteVisit, Notification, AnalysisReport, NearbyCache, Conversation, AuditLog, SearchEvent, ContactMessage, IntegrationEvent).

`server/src/data/migrate.js` runs on every boot. It is idempotent and never deletes documents:
1. syncs indexes (adds the `2dsphere` and compound indexes and **replaces the v1 text index**);
2. backfills the GeoJSON `geo` point from `location` for older listings;
3. labels v1 seed listings (owned by the old demo accounts) as demo data.

### Location tree

Listings and projects are attached to a `Location` tree (country → state → district → city/town → locality/village) through `locationId` and `ancestors[]`. A listing in Rohini therefore also counts for North West Delhi and Delhi, and `?city=Gurgaon` finds Gurugram listings.

- **Starter tree:** `server/src/data/locations.seed.js` covers every demo city and locality, plus Kanpur, Agra and Lucknow. It loads at boot and never overwrites admin edits.
- **Matching:** `services/locationService.js` matches a typed city and locality by name, by alias ("Gurgaon", "Bangalore", "Cawnpore") or by a small typo allowance. Numbers are never fuzzed, so "Sector 63" never becomes "Sector 62". As a last resort it uses the listing's coordinates (nearest city within 25 km).
- **New localities:** a listing that names an unknown locality inside a known city adds that locality to the tree with `source: "listing"` and `reviewed: false`.
- **Nationwide data:** download [GeoNames IN.zip](https://download.geonames.org/export/dump/IN.zip) (CC BY 4.0, credit GeoNames), unzip `IN.txt` and run
  `cd server && npm run import:locations -- --file path/to/IN.txt` (add `--no-villages` for a smaller tree, or `--dry-run` to only count). The import is batched and safe to re-run, adopts existing nodes without duplicating them, then recomputes ancestors on every node and listing.
- **Adding a single place:** add it to `locations.seed.js` under its parent with a unique slug and restart.
- **API:** `GET /api/locations/search?q=`, `GET /api/locations/:slug` (breadcrumb, children with listing counts; alias slugs return `{ redirect }`), `GET /api/locations/appears-on?city=&locality=`.

### Media access and phone-number checks

- **Signed-out visitors** see the first `PUBLIC_IMAGE_COUNT` photos (default 2) and counts of what's hidden. Everything else needs a login: all photos, videos, brochures and the video link. This applies to property pages, search cards, compare and projects.
- **Videos and brochures** (MP4/WebM/MOV up to 100 MB; PDF up to 25 MB) are stored in `uploads-private/media`. They're served only through signed links that are tied to the user and expire after 2 hours (`GET /api/media/:name`).
- **Phone-number check** (`services/phoneScan.js`). Uploads showing an Indian mobile, landline or toll-free number are refused, with the masked number and where it was found:
  - **Photos:** OCR (Tesseract) runs over up to 9 cleaned-up versions of each image: enlarged for tiny text, contrast-stretched, white text and dark text isolated, and straightened by ±10°. It stops at the first hit, using two OCR engines in parallel.
  - **Brochures:** the PDF text layer is checked (up to 200 pages), and the first 30 pages are rendered and read with OCR, which covers scanned pages and numbers inside images.
  - **Videos:** up to 40 frames spread across the video (at least one every 2 s) are extracted with ffmpeg and read with OCR.
  - **Text:** titles and descriptions containing phone numbers are refused.
- **Bundled OCR data:** the English language data ships with the app (`@tesseract.js-data/eng`), so no download is needed. The OCR engine starts when the server boots.
- **If the check can't run**, uploads are refused with "try again" rather than let through. `PHONE_SCAN=off` disables the check; files are then stored as `unscanned`.
- **Accuracy:** measured on `server/test/fixtures/ocr`, it catches plain, tiny, banner, rotated and cursive-script numbers and ignores prices, areas, PIN codes and RERA IDs.
- **Not covered:** numbers spoken in a video, numbers shown for less than the gap between sampled frames, pages after 30 in a scanned brochure, and heavily distorted text. No OCR is perfect, so the "Report listing" button remains the backstop.
- **Linking rules:** a listing can only use files its lister uploaded. Image links can no longer be added, because they can't be scanned; existing ones are kept.

### Buyer activity for listers (opt-in)

- **Consent:** buyers opt in with a separate, unticked checkbox at sign-up or in Profile. It is not bundled into the terms, so the consent stays valid under the DPDP Act. The consent time and the version of the wording are stored. Without consent, nothing is recorded.
- **What's recorded:** views, saves, compares, enquiries, site-visit requests, searches (filters only, no free text) and saved searches, in `ActivityEvent`. Events expire after 30 days, and opting out deletes them immediately.
- **Who can see it:** a lister sees a buyer's activity (`GET /api/leads/buyers/:id/activity`, the "Buyer activity" button on dashboard leads) only if that buyer opted in and contacted that lister. Each view is written to the audit log.
- **Other listers' properties:** activity there is described in general terms only, never the listing or the lister.
- **Buyer's own view:** buyers can see exactly what is shared under Profile (`GET /api/me/activity`).

v1 users with role `user` keep working (treated as buyer, with listing rights). TTL indexes expire OTPs, search analytics (90 days) and integration events (14 days).

---

## Testing & quality

```bash
cd server && npm test     # 42 API + unit tests (node:test, isolated in-memory MongoDB, fixture map data)
cd server && npm run lint
cd client && npm test     # Vitest + Testing Library component tests
cd client && npm run lint && npm run build
```

Server tests never touch `MONGODB_URI`. They cover auth and roles, password reset, listing validation, duplicates, drafts, every search filter, privacy of contact details, favourites, saved searches, leads and site-visit permissions, review moderation, the RERA workflow and evidence privacy, AI report shape and null handling, AI provider fallback, compare, the chat assistant (grounded search, honest no-results, RERA/schools answers, realtor scoping, history), admin permissions and suspension, upload content validation, and SEO routes.

The live Overpass integration was checked manually. Live LLM calls are **not** covered by automated tests, because they need a key; the failure-fallback path is tested.

---

## Project structure

```
server/src
  app.js, server.js           Express app, startup (migrations + auto-seed)
  config/                     db.js, scoring.js (all scoring weights & bands)
  models/                     User.js, Property.js, index.js (other models)
  services/                   searchService, analysisService, comparablesService, placesService,
                              reraService, chatService, llmService, aiService, notificationService
  controllers/ routes/        REST API (see routes/*.js)
  middleware/                 auth (JWT + roles), rateLimit
  data/                       seed.js (demo data), migrate.js, knowledge.js (assistant KB)
client/src
  api/client.js               all API calls + SSE chat client
  context/                    Auth, Toast, Shortlist (favourites + compare), Chat
  components/                 cards, filters, report/, chat/, reviews, contact, ui primitives
  pages/                      route pages (lazy-loaded where heavy)
  ui.css                      v2 component styles + animations (after styles.css / theme.css)
```

---

## Production checklist & known limitations

- Set `NODE_ENV=production`, a strong `JWT_SECRET`, a real `MONGODB_URI` and `CLIENT_URL`; serve `client/dist` behind HTTPS.
- Don't rely on public Overpass and Nominatim servers for production traffic; self-host them or use a licensed provider.
- Email/SMS delivery, payment and S3 storage are not implemented.
- JWTs are stored in `localStorage` (v1 design). For stronger XSS resilience, move to httpOnly cookies with CSRF protection.
- The SPA is client-rendered. Meta tags and JSON-LD are emitted, but for best SEO add SSR (e.g. Next.js) or a prerender service.
- RERA verification is manual; the automated-adapter interface is in place.
- Scores are estimates. School quality, safety and pollution are deliberately **not** scored, because no reliable licensed data source is configured.
