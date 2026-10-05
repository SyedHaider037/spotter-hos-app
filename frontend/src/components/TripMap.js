import React, { useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

import { decodePolyline } from '../utils/polyline';

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

// One-letter badge per stop type, in priority order for stops that share a location.
const STOP_BADGES = {
  DROPOFF: { letter: 'D', className: 'StopMarker--destination' },
  PICKUP: { letter: 'P', className: 'StopMarker--destination' },
  CURRENT: { letter: 'S', className: 'StopMarker--start' },
  REST_10: { letter: 'R', className: '' },
  BREAK_30: { letter: 'B', className: '' },
  FUEL: { letter: 'F', className: '' },
  ON_DUTY: { letter: 'P', className: 'StopMarker--destination' },
};
const BADGE_PRIORITY = ['DROPOFF', 'PICKUP', 'CURRENT', 'REST_10', 'BREAK_30', 'FUEL', 'ON_DUTY'];

const CLUSTER_RADIUS_PX = 26; // markers closer than this on screen are shown as one marker

// Valid stops with their position, in trip order.
function locatedStops(stops) {
  return (Array.isArray(stops) ? stops : [])
    .map((stop) => ({ stop, pos: safeLatLng(stop) }))
    .filter((item) => item.pos);
}

// Merge stops that would overlap on screen at the current zoom (this includes stops sharing a location,
// e.g. a pickup and its on-duty hour). Zooming in splits a cluster back into separate markers.
function clusterStops(items, map, zoom) {
  const clusters = [];
  const byPriority = [...items].sort(
    (a, b) => BADGE_PRIORITY.indexOf(a.stop.type) - BADGE_PRIORITY.indexOf(b.stop.type)
  );
  byPriority.forEach((item) => {
    const point = map.project(item.pos, zoom);
    const home = clusters.find((c) => c.point.distanceTo(point) <= CLUSTER_RADIUS_PX);
    if (home) {
      home.items.push(item);
    } else {
      clusters.push({ point, pos: item.pos, items: [item] });
    }
  });
  // Keep each popup's entries in trip order.
  clusters.forEach((c) => c.items.sort((a, b) => items.indexOf(a) - items.indexOf(b)));
  return clusters;
}

function primaryType(groupStops) {
  return BADGE_PRIORITY.find((t) => groupStops.some((s) => s.type === t));
}

function StopMarkers({ items }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const clusters = useMemo(() => clusterStops(items, map, zoom), [items, map, zoom]);

  return clusters.map((cluster) => {
    const groupStops = cluster.items.map((i) => i.stop);
    return (
      <Marker
        key={`${cluster.pos[0]},${cluster.pos[1]}`}
        position={cluster.pos}
        icon={makeIcon(groupStops)}
        // Pickup/dropoff/start markers sit above breaks and fuel stops where they are close together.
        zIndexOffset={(BADGE_PRIORITY.length - Math.max(0, BADGE_PRIORITY.indexOf(primaryType(groupStops)))) * 100}
      >
        <Popup>
          <div style={{ minWidth: 220 }}>
            {groupStops.map((stop, idx) => (
              <div key={`${stop.type}-${idx}`} style={{ marginBottom: idx < groupStops.length - 1 ? 10 : 0 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{stop.type || 'STOP'}</div>
                <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>{stop.location}</div>
                <div style={{ fontSize: 12 }}>
                  <div>
                    <strong>Start:</strong> {stop.start_time || ''}
                  </div>
                  <div>
                    <strong>End:</strong> {stop.end_time || ''}
                  </div>
                  <div>
                    <strong>Duration:</strong> {formatDurationMinutes(stop.duration)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Popup>
      </Marker>
    );
  });
}

function badgeFor(groupStops) {
  return STOP_BADGES[primaryType(groupStops)] || { letter: '•', className: '' };
}

function makeIcon(groupStops) {
  const { letter, className } = badgeFor(groupStops);
  const extra = groupStops.length > 1 ? `<span class="StopMarkerCount">${groupStops.length}</span>` : '';
  return L.divIcon({
    className: 'StopMarkerWrap',
    html: `<span class="StopMarker ${className}">${letter}</span>${extra}`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

export default function TripMap({ stops, route }) {
  const items = useMemo(() => locatedStops(stops), [stops]);

  // Prefer the real road geometry from the backend; fall back to joining the stops with straight lines
  // (e.g. when talking to an older backend that does not return `route` yet).
  const routePoints = useMemo(() => {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    const decoded = legs.flatMap((leg) => decodePolyline(leg?.polyline));
    if (decoded.length >= 2) return decoded;
    return items.map((i) => i.pos);
  }, [route, items]);

  const bounds = useMemo(() => {
    const all = [...routePoints, ...items.map((i) => i.pos)];
    return all.length ? L.latLngBounds(all) : null;
  }, [routePoints, items]);

  const mapProps = bounds
    ? { bounds, boundsOptions: { padding: [32, 32] } }
    : { center: [39.5, -98.35], zoom: 4 }; // fallback view (US)

  return (
    <div className="Card">
      <div className="CardHeader">
        <h2 className="CardTitle">Route map</h2>
        <div className="CardSubtitle">Driving route with breaks, rests and fuel stops</div>
      </div>

      <div className="MapWrap">
        <MapContainer {...mapProps} scrollWheelZoom style={{ height: 420, width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {routePoints.length >= 2 ? <Polyline positions={routePoints} pathOptions={{ color: '#2563eb', weight: 4 }} /> : null}

          <StopMarkers items={items} />
        </MapContainer>
      </div>
    </div>
  );
}
