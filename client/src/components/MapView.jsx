import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { formatINR, hasCoords, propertyId } from '../utils/format.js';
import { INDIA_CENTER } from '../utils/constants.js';

// Bundlers break Leaflet's automatic icon-path detection, so set the icon explicitly.
const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

/** Keeps the viewport around the markers. */
function FitBounds({ points, singleZoom }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], singleZoom);
    } else {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
    }
  }, [map, points, singleZoom]);

  return null;
}

/**
 * Leaflet map with one marker per property that has coordinates.
 * Props: properties, height, zoom (single-marker zoom), className
 */
export default function MapView({ properties = [], height = 520, zoom = 13, className = '' }) {
  const located = useMemo(() => properties.filter(hasCoords), [properties]);

  const points = useMemo(
    () => located.map((p) => [Number(p.location.lat), Number(p.location.lng)]),
    [located]
  );

  return (
    <div className={`map ${className}`} style={{ height }}>
      <MapContainer
        center={INDIA_CENTER}
        zoom={5}
        scrollWheelZoom={false}
        className="map__canvas"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitBounds points={points} singleZoom={zoom} />

        {located.map((p) => {
          const id = propertyId(p);
          return (
            <Marker key={id} position={[Number(p.location.lat), Number(p.location.lng)]}>
              <Popup>
                <div className="map-popup">
                  <strong>{formatINR(p.price, p.listingType)}</strong>
                  <div>{p.title}</div>
                  <Link to={`/property/${id}`}>View details</Link>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {located.length === 0 && (
        <div className="map__empty">No mapped locations for these listings yet.</div>
      )}
    </div>
  );
}
