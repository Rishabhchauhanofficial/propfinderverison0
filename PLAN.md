# PropFinder — Implementation Plan

A simpler, original property marketplace inspired by the *public* feature set of portals like 99acres. No third-party code was reverse-engineered; this is a clean build.

## Stack (classic MERN)
- **MongoDB** + Mongoose (falls back to in-memory MongoDB when no `MONGODB_URI` is set, so it runs with zero setup)
- **Express** REST API (Node.js)
- **React** SPA (Vite) + React Router
- **Leaflet** for maps (free, no API key)
- **react-helmet-async** for SEO meta + JSON-LD
- **JWT** auth, **bcrypt** passwords

## Features mapped to requirements
1. **Buy / Sell property** — public listing browse + guided "Post Property" flow; `listingType: sale | rent`, `intent` buyer/seller via auth + "My Listings" dashboard (create/edit/delete).
2. **Location-specific property** — city → locality search, filters, geo coordinates, map view, "properties near me" (distance), per-locality landing pages.
3. **Property AI analysis** — per-listing analysis: investment score, price-fairness vs locality median (₹/sqft), rental-yield estimate, pros/cons, plain-language summary. Heuristic engine by default; upgrades to a real LLM if `AI_API_KEY` is set.
4. **SEO + AI marketing** — auto-generated SEO title/meta/description + keywords, schema.org `RealEstateListing` JSON-LD, Open Graph/social copy, dynamic `sitemap.xml` + `robots.txt`, SEO-friendly locality landing pages. Same pluggable-LLM pattern.

## Data model
- **User**: name, email, passwordHash, role (user|agent|admin), phone, createdAt
- **Property**: title, description, listingType(sale|rent), propertyType(apartment|villa|plot|commercial|...), status(active|sold|rented), price, areaSqft, bedrooms, bathrooms, furnishing, city, locality, address, location{lat,lng}, amenities[], images[], owner(ref User), views, createdAt + virtuals (pricePerSqft)

## API contract (prefix `/api`)
- `POST /auth/register` {name,email,password,phone} → {token,user}
- `POST /auth/login` {email,password} → {token,user}
- `GET  /auth/me` (Bearer) → {user}
- `GET  /properties` ?city&locality&listingType&propertyType&minPrice&maxPrice&bedrooms&q&near=lat,lng&radiusKm&sort&page&limit → {items,total,page,pages,facets}
- `GET  /properties/:id` → property (increments views) + related
- `POST /properties` (auth) → created
- `PUT  /properties/:id` (auth, owner) → updated
- `DELETE /properties/:id` (auth, owner) → {ok}
- `GET  /properties/mine` (auth) → owner's listings
- `GET  /localities` → [{city,locality,count,avgPricePerSqft}]  (for location features + landing pages)
- `GET  /ai/analysis/:id` → {score, priceFairness, rentalYield, pros[], cons[], summary, source:'heuristic'|'llm'}
- `POST /ai/marketing/:id` → {seoTitle, metaDescription, keywords[], socialCaption, jsonLd, source}
- `GET  /sitemap.xml`, `GET /robots.txt` (served by server for crawlers)

## Build order
1. Scaffold + shared model (done first, fixes the contract)
2. Backend logic (controllers/routes/auth/AI/seed) — delegated to Haiku sub-agent, exact spec
3. Frontend SPA — delegated to Haiku sub-agent, exact API contract
4. Install, run against in-memory Mongo, seed, test every feature, fix bugs
5. README + setup instructions, package source, deliver

## SEO note (MERN honesty)
A client-rendered SPA is weaker for SEO than SSR. This build maximizes SEO within MERN (prerendered meta for crawlers via a server crawler-detection route, JSON-LD, sitemap, semantic locality URLs). Production upgrade path: move the public pages to Next.js SSR or add a prerender service — documented in the README.
