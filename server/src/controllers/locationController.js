import Property from '../models/Property.js';
import Location from '../models/Location.js';
import { appearsOn, breadcrumb, findBySlug, searchLocations } from '../services/locationService.js';
import { notFound, str, wrap } from '../utils/http.js';

const publicNode = (n) => ({
  id: n._id,
  name: n.name,
  slug: n.slug,
  type: n.type,
  aliases: n.aliases || [],
  coordinates: n.geo?.coordinates || null,
  approxGeo: !!n.approxGeo,
});

/** GET /api/locations/search?q=gurg — autocomplete over names and aliases. */
export const search = wrap(async (req, res) => {
  const nodes = await searchLocations(str(req.query.q), { limit: 10 });
  const items = await Promise.all(
    nodes.map(async (n) => ({ ...publicNode(n), path: (await breadcrumb(n)).filter((c) => c.type !== 'country').map((c) => c.name).join(' › ') }))
  );
  res.json({ items });
});

/** GET /api/locations/appears-on?city=&locality=&state= — pages a listing at this address reaches. */
export const preview = wrap(async (req, res) => {
  res.json(await appearsOn({ city: str(req.query.city), locality: str(req.query.locality), state: str(req.query.state) }));
});

/**
 * GET /api/locations/:slug — the node, its breadcrumb, its children with listing counts, and how many
 * active listings sit exactly here vs anywhere inside. An alias slug ("gurgaon") returns `redirect`.
 */
export const getOne = wrap(async (req, res) => {
  const { node, canonical } = await findBySlug(req.params.slug);
  if (!node) throw notFound('Location not found');
  if (!canonical) return res.json({ redirect: node.slug });

  const active = { status: 'active' };
  const [crumbs, children, exact, inside] = await Promise.all([
    breadcrumb(node),
    Location.find({ parentId: node._id }).sort({ priority: -1, name: 1 }).limit(200).lean(),
    Property.countDocuments({ ...active, locationId: node._id }),
    Property.countDocuments({ ...active, ancestors: node._id }),
  ]);

  const childIds = children.map((c) => c._id);
  const perChild = childIds.length
    ? await Property.aggregate([
        { $match: { ...active, $or: [{ locationId: { $in: childIds } }, { ancestors: { $in: childIds } }] } },
        { $project: { hit: { $setIntersection: [{ $concatArrays: ['$ancestors', ['$locationId']] }, childIds] } } },
        { $unwind: '$hit' },
        { $group: { _id: '$hit', count: { $sum: 1 } } },
      ])
    : [];
  const countOf = new Map(perChild.map((r) => [String(r._id), r.count]));

  res.json({
    location: publicNode(node),
    breadcrumb: crumbs,
    counts: { exact, inside, total: exact + inside },
    children: children
      .map((c) => ({ ...publicNode(c), listings: countOf.get(String(c._id)) || 0 }))
      .sort((a, b) => b.listings - a.listings),
  });
});
