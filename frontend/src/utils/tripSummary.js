// Headline numbers for a planned trip, computed from the planner's response (no extra backend fields needed).

import { decodePolyline } from './polyline';

export const CYCLE_LIMIT_HOURS = 70;
const RESTART_MINUTES = 34 * 60;
const EARTH_RADIUS_MILES = 3958.8;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two [lat, lng] points, in miles.
export function haversineMiles(a, b) {
  const dLat = toRadians(b[0] - a[0]);
  const dLng = toRadians(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Length of the drawn road geometry (all legs), in miles.
export function routeMiles(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  return legs.reduce((total, leg) => {
    const pts = decodePolyline(leg?.polyline);
    let miles = 0;
    for (let i = 1; i < pts.length; i += 1) miles += haversineMiles(pts[i - 1], pts[i]);
    return total + miles;
  }, 0);
}

// All daily-log segments as {status, start, end} (ms), with pieces split at midnight joined back together.
function mergedSegments(dailyLogs) {
  const merged = [];
  (Array.isArray(dailyLogs) ? dailyLogs : []).forEach((day) => {
    (day?.segments || []).forEach((seg) => {
      const start = Date.parse(seg.start);
      const end = Date.parse(seg.end);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return;
      const last = merged[merged.length - 1];
      if (last && last.status === seg.status && last.end === start) last.end = end;
      else merged.push({ status: seg.status, start, end });
    });
  });
  return merged;
}

/**
 * summarizeTrip({ stops, dailyLogs, route, cycleUsedHours }) ->
 *   distanceMiles, drivingMinutes, totalMinutes (first start to last end), days, rests (10-hour), restarts (34-hour),
 *   cycleAfterHours (hours on the 70-hour cycle once the trip ends; a 34-hour restart resets it).
 */
export function summarizeTrip({ stops, dailyLogs, route, cycleUsedHours }) {
  const segs = mergedSegments(dailyLogs);
  const minutes = (seg) => (seg.end - seg.start) / 60000;

  let drivingMinutes = 0;
  let cycleHours = Number.isFinite(Number(cycleUsedHours)) ? Number(cycleUsedHours) : 0;
  segs.forEach((seg) => {
    if (seg.status === 'DRIVING') drivingMinutes += minutes(seg);
    if (seg.status === 'DRIVING' || seg.status === 'ON_DUTY') cycleHours += minutes(seg) / 60;
    else if (seg.status === 'OFF_DUTY' && minutes(seg) >= RESTART_MINUTES - 1e-6) cycleHours = 0;
  });

  const list = Array.isArray(stops) ? stops : [];
  return {
    distanceMiles: routeMiles(route),
    drivingMinutes: Math.round(drivingMinutes),
    totalMinutes: segs.length ? Math.round((segs[segs.length - 1].end - segs[0].start) / 60000) : 0,
    days: Array.isArray(dailyLogs) ? dailyLogs.length : 0,
    rests: list.filter((s) => s?.type === 'REST_10').length,
    restarts: list.filter((s) => s?.type === 'RESTART_34').length,
    cycleAfterHours: cycleHours,
  };
}

// "3 days 22 hrs" / "9 hrs 40 min": the span of the whole trip.
export function formatSpan(totalMinutes) {
  const m = Math.round(Number(totalMinutes));
  if (!Number.isFinite(m) || m <= 0) return '';
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) {
    const d = days === 1 ? '1 day' : `${days} days`;
    return hours ? `${d} ${hours} ${hours === 1 ? 'hr' : 'hrs'}` : d;
  }
  if (hours > 0) return mins ? `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${mins} min` : `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
  return `${mins} min`;
}

export function formatMiles(miles) {
  const n = Math.round(Number(miles));
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-US')} mi` : '';
}
