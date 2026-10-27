/*
 * Starter location tree shipped with the app (real places, not demo data). It covers every city and
 * locality the demo listings use so the app works offline; import the full GeoNames dataset with
 * `npm run import:locations` for nationwide coverage. Coordinates are [lng, lat], approximate centres.
 */
const loc = (name, type, slug, geo, extra = {}) => ({ name, type, slug, geo, ...extra });

export const LOCATION_SEED = loc('India', 'country', 'india', [78.9629, 20.5937], {
  children: [
    loc('Delhi', 'state', 'delhi', [77.209, 28.6139], {
      aliases: ['NCT of Delhi', 'National Capital Territory of Delhi', 'New Delhi'],
      priority: 10,
      children: [
        loc('North West Delhi', 'district', 'north-west-delhi', [77.0688, 28.7186], {
          children: [loc('Rohini', 'locality', 'rohini-delhi', [77.0565, 28.7495])],
        }),
        loc('South West Delhi', 'district', 'south-west-delhi', [77.03, 28.58], {
          children: [loc('Dwarka', 'locality', 'dwarka-delhi', [77.046, 28.5921])],
        }),
        loc('South Delhi', 'district', 'south-delhi', [77.21, 28.53], {
          children: [loc('Saket', 'locality', 'saket-delhi', [77.2066, 28.5244])],
        }),
      ],
    }),
    loc('Haryana', 'state', 'haryana', [76.0856, 29.0588], {
      children: [
        loc('Gurugram', 'city', 'gurugram', [77.0266, 28.4595], {
          aliases: ['Gurgaon'],
          priority: 10,
          children: [
            loc('DLF Phase 2', 'locality', 'dlf-phase-2-gurugram', [77.0895, 28.4795], { aliases: ['DLF Phase II'] }),
            loc('Sector 54', 'locality', 'sector-54-gurugram', [77.0944, 28.4398]),
            loc('Golf Course Road', 'locality', 'golf-course-road-gurugram', [77.1002, 28.4418]),
          ],
        }),
      ],
    }),
    loc('Uttar Pradesh', 'state', 'uttar-pradesh', [80.9462, 26.8467], {
      aliases: ['UP'],
      children: [
        loc('Gautam Buddh Nagar', 'district', 'gautam-buddh-nagar', [77.53, 28.47], {
          children: [
            loc('Noida', 'city', 'noida', [77.391, 28.5355], {
              priority: 10,
              children: [
                loc('Sector 62', 'locality', 'sector-62-noida', [77.3649, 28.6272]),
                loc('Sector 137', 'locality', 'sector-137-noida', [77.401, 28.513]),
              ],
            }),
          ],
        }),
        loc('Kanpur Nagar', 'district', 'kanpur-nagar', [80.33, 26.46], {
          children: [loc('Kanpur', 'city', 'kanpur', [80.3319, 26.4499], { aliases: ['Cawnpore'], priority: 10 })],
        }),
        loc('Agra', 'city', 'agra', [78.0081, 27.1767], { priority: 10 }),
        loc('Lucknow', 'city', 'lucknow', [80.9462, 26.8467], { priority: 10 }),
      ],
    }),
    loc('Karnataka', 'state', 'karnataka', [75.7139, 15.3173], {
      children: [
        loc('Bengaluru', 'city', 'bengaluru', [77.5946, 12.9716], {
          aliases: ['Bangalore'],
          priority: 10,
          children: [
            loc('Whitefield', 'locality', 'whitefield-bengaluru', [77.75, 12.9698]),
            loc('Koramangala', 'locality', 'koramangala-bengaluru', [77.6245, 12.9352]),
            loc('HSR Layout', 'locality', 'hsr-layout-bengaluru', [77.6389, 12.9116]),
          ],
        }),
      ],
    }),
    loc('Maharashtra', 'state', 'maharashtra', [75.7139, 19.7515], {
      children: [
        loc('Mumbai', 'city', 'mumbai', [72.8777, 19.076], {
          aliases: ['Bombay'],
          priority: 10,
          children: [
            loc('Andheri West', 'locality', 'andheri-west-mumbai', [72.8296, 19.1364]),
            loc('Powai', 'locality', 'powai-mumbai', [72.906, 19.1176]),
            loc('Bandra', 'locality', 'bandra-mumbai', [72.8295, 19.0596]),
          ],
        }),
        loc('Pune', 'city', 'pune', [73.8567, 18.5204], {
          aliases: ['Poona'],
          priority: 10,
          children: [
            loc('Hinjewadi', 'locality', 'hinjewadi-pune', [73.7389, 18.5912], { aliases: ['Hinjawadi'] }),
            loc('Baner', 'locality', 'baner-pune', [73.7868, 18.559]),
            loc('Kothrud', 'locality', 'kothrud-pune', [73.8077, 18.5074]),
          ],
        }),
      ],
    }),
  ],
});
