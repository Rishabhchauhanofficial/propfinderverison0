import { Link } from 'react-router-dom';
import { formatArea, formatINR, formatPerSqft, labelize, propertyId, propertyPath } from '../utils/format.js';
import { useShortlist } from '../context/ShortlistContext.jsx';
import { DemoBadge, ReraBadge } from './ui.jsx';

export default function PropertyCard({ property, compact = false }) {
  const { isFavorite, toggleFavorite, inCompare, toggleCompare } = useShortlist();
  if (!property) return null;

  const id = String(propertyId(property));
  const href = propertyPath(property);
  const isRent = property.listingType === 'rent';
  const images = property.images || [];
  const image = images[0];
  const place = [property.locality, property.city].filter(Boolean).join(', ');
  const ppsf = !isRent ? formatPerSqft(property.pricePerSqft) : null;
  const ownerRole = property.owner?.role || property.postedByRole;
  const saved = isFavorite(id);
  const comparing = inCompare(id);

  return (
    <article className={`prop-card${compact ? ' prop-card--compact' : ''}`}>
      <Link to={href} className="prop-card__media" aria-label={property.title}>
        {image ? (
          <img src={image} alt="" loading="lazy" decoding="async" width="480" height="300" />
        ) : (
          <div className="prop-card__placeholder" aria-hidden="true">No photo</div>
        )}
        <span className="prop-card__tags">
          <span className={`prop-card__tag ${isRent ? 'tag--rent' : 'tag--sale'}`}>{isRent ? 'For Rent' : 'For Sale'}</span>
          {property.constructionStatus === 'under-construction' && <span className="prop-card__tag tag--new">New project</span>}
          {property.isDemo && <DemoBadge small />}
        </span>
        {images.length > 1 && <span className="prop-card__count" aria-hidden="true">📷 {images.length}</span>}
        {property.status && property.status !== 'active' && <span className="prop-card__status">{labelize(property.status)}</span>}
        {property.distanceKm != null && <span className="prop-card__dist">{property.distanceKm} km away</span>}
      </Link>

      <div className="prop-card__actions">
        <button
          type="button"
          className={`icon-btn${saved ? ' is-on' : ''}`}
          aria-pressed={saved}
          aria-label={saved ? 'Remove from shortlist' : 'Save to shortlist'}
          title={saved ? 'Saved' : 'Save'}
          onClick={() => toggleFavorite(id)}
        >
          {saved ? '♥' : '♡'}
        </button>
        <button
          type="button"
          className={`icon-btn${comparing ? ' is-on' : ''}`}
          aria-pressed={comparing}
          aria-label={comparing ? 'Remove from compare' : 'Add to compare'}
          title={comparing ? 'In compare list' : 'Compare'}
          onClick={() => toggleCompare(property)}
        >
          ⇄
        </button>
      </div>

      <div className="prop-card__body">
        <div className="prop-card__price-row">
          <div className="prop-card__price">{formatINR(property.price, property.listingType)}</div>
          {ppsf && <div className="prop-card__ppsf">{ppsf}</div>}
        </div>

        <h3 className="prop-card__title">
          <Link to={href}>{property.title}</Link>
        </h3>
        <p className="prop-card__loc">📍 {place}</p>

        <ul className="chips">
          {property.bedrooms ? <li>{property.bedrooms} BHK</li> : null}
          {property.bathrooms ? <li>{property.bathrooms} Bath</li> : null}
          {property.areaSqft ? <li>{formatArea(property.areaSqft)}</li> : null}
          {property.propertyType ? <li>{labelize(property.propertyType)}</li> : null}
        </ul>

        {!compact && (
          <div className="prop-card__badges">
            {property.listingVerified && <span className="badge badge--good badge--sm">Checked by PropFinder</span>}
            {property.rera?.status === 'verified' || property.rera?.status === 'mismatch' ? <ReraBadge status={property.rera.status} small /> : null}
          </div>
        )}

        <div className="prop-card__foot">
          <span className="prop-card__owner">
            {ownerRole === 'agent' ? 'Agent' : ownerRole === 'builder' ? 'Builder' : 'Owner'}
            {property.owner?.name ? `: ${property.owner.company || property.owner.name}` : ''}
          </span>
          <Link to={href} className="prop-card__cta">View details →</Link>
        </div>
      </div>
    </article>
  );
}
