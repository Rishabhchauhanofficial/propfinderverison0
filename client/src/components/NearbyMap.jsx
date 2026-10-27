import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const homeIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export const CATEGORY_COLORS = {
  education: '#7c3aed',
  healthcare: '#dc2626',
  transport: '#0b57d0',
  daily: '#0f9d6e',
  shopping: '#d97706',
  lifestyle: '#0891b2',
};

function Fit({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
    else if (points.length === 1) map.setView(points[0], 15);
  }, [map, points]);
  return null;
}

/** Property pin plus nearby places for the enabled categories. */
export default function NearbyMap({ center, categories, meta, enabled, height = 380 }) {
  const places = useMemo(() => {
    const out = [];
    for (const [key, bucket] of Object.entries(categories || {})) {
      if (!enabled.has(key)) continue;
      for (const p of bucket.nearest || []) out.push({ ...p, key, group: meta?.[key]?.group });
    }
    return out;
  }, [categories, meta, enabled]);

  const points = useMemo(() => [[center.lat, center.lng], ...places.map((p) => [p.lat, p.lng])], [center, places]);

  return (
    <div className="map" style={{ height }}>
      <MapContainer center={[center.lat, center.lng]} zoom={14} scrollWheelZoom={false} className="map__canvas">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
        <Fit points={points} />
        <Marker position={[center.lat, center.lng]} icon={homeIcon}>
          <Popup>This property</Popup>
        </Marker>
        {places.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: CATEGORY_COLORS[p.group] || '#475569', fillOpacity: 0.95 }}
          >
            <Tooltip>
              <strong>{p.name}</strong>
              <br />
              {meta?.[p.key]?.label} · {p.distanceKm} km straight-line
              {p.driveMinutes != null ? ` · ~${p.driveMinutes} min drive` : ''}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
