import Property from '../models/Property.js';

export async function listLocalities(req, res, next) {
  try {
    const rows = await Property.aggregate([
      {
        $match: {
          status: 'active',
          city: { $nin: [null, ''] },
          locality: { $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: { city: '$city', locality: '$locality' },
          count: { $sum: 1 },
          minPrice: { $min: '$price' },
          sampleImage: { $first: { $arrayElemAt: ['$images', 0] } },
          // Only sale listings with a known area contribute; $avg ignores nulls.
          avgPricePerSqft: {
            $avg: {
              $cond: [
                {
                  $and: [{ $eq: ['$listingType', 'sale'] }, { $gt: ['$areaSqft', 0] }],
                },
                { $divide: ['$price', '$areaSqft'] },
                null,
              ],
            },
          },
        },
      },
      { $sort: { count: -1, '_id.city': 1, '_id.locality': 1 } },
    ]);

    return res.json(
      rows.map((r) => ({
        city: r._id.city,
        locality: r._id.locality,
        count: r.count,
        avgPricePerSqft: r.avgPricePerSqft == null ? null : Math.round(r.avgPricePerSqft),
        minPrice: r.minPrice ?? null,
        sampleImage: r.sampleImage || null,
      }))
    );
  } catch (err) {
    return next(err);
  }
}
