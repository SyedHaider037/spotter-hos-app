import React, { useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';

// Fix default marker icons for CRA/Webpack setups.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function formatDurationMinutes(mins) {
  if (typeof mins !== 'number' || Number.isNaN(mins)) return '';
  if (mins === 0) return '0 min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} hrs ${m} min`;
  if (h) return h === 1 ? '1 hr' : `${h} hrs`;
  return `${m} min`;
}

function safeLatLng(stop) {
  const lat = Number(stop?.lat);
  const lng = Number(stop?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

export default function TripMap({ stops }) {
  const points = useMemo(() => {
    if (!Array.isArray(stops)) return [];
    return stops.map(safeLatLng).filter(Boolean);
  }, [stops]);

  const center = points[0] || [39.5, -98.35]; // fallback center (US)

  return (
    <div className="Card">
      <div className="CardHeader">
        <h2 className="CardTitle">Route map</h2>
        <div className="CardSubtitle">Stops + a polyline drawn through stop points</div>
      </div>

      <div className="MapWrap">
        <MapContainer center={center} zoom={5} scrollWheelZoom style={{ height: 420, width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {points.length >= 2 ? <Polyline positions={points} pathOptions={{ color: '#2563eb', weight: 4 }} /> : null}

          {Array.isArray(stops)
            ? stops.map((stop, idx) => {
                const pos = safeLatLng(stop);
                if (!pos) return null;
                const type = stop.type || 'STOP';
                const start = stop.start_time || '';
                const end = stop.end_time || '';
                const duration = formatDurationMinutes(stop.duration);

                return (
                  <Marker key={`${type}-${idx}`} position={pos}>
                    <Popup>
                      <div style={{ minWidth: 220 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>{type}</div>
                        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 8 }}>{stop.location}</div>
                        <div style={{ fontSize: 12 }}>
                          <div>
                            <strong>Start:</strong> {start}
                          </div>
                          <div>
                            <strong>End:</strong> {end}
                          </div>
                          <div>
                            <strong>Duration:</strong> {duration}
                          </div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })
            : null}
        </MapContainer>
      </div>
    </div>
  );
}

