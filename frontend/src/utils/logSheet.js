// Pure helpers behind the duty-status log sheet (no React, so they are easy to test).

export const MINUTES_PER_DAY = 24 * 60;

// Row order matches a paper driver's daily log.
export const ROWS = [
  { key: 'OFF_DUTY', label: 'Off duty', short: 'Off' },
  { key: 'SLEEPER', label: 'Sleeper berth', short: 'Sleeper' },
  { key: 'DRIVING', label: 'Driving', short: 'Driving' },
  { key: 'ON_DUTY', label: 'On duty (not driving)', short: 'On duty' },
];

export const SHEET_DEFAULT_WIDTH = 1000;
const COMPACT_BELOW = 560;

/**
 * Geometry of the duty-status graph for a given available width (px). The SVG is drawn 1:1 at that width, so its
 * text is always the real type-scale size; narrower sheets drop the totals column, shorten the row labels and
 * label fewer hours instead of shrinking everything.
 */
export function sheetLayout(width) {
  const w = Math.max(280, Math.round(Number(width) || SHEET_DEFAULT_WIDTH));
  const compact = w < COMPACT_BELOW;
  const labelW = compact ? 68 : 168;
  const totalW = compact ? 0 : 72;
  const gridX = labelW;
  // Room right of the grid: the last hour label ("Mid") is centered on the grid's edge, so it needs ~14px, and the
  // totals column (when there is one) must clear it too.
  const gap = totalW ? 14 : 0;
  const rightMargin = totalW ? 2 : 16;
  const gridW = w - labelW - (totalW ? totalW + gap : 0) - rightMargin;
  const pxPerHour = gridW / 24;
  return {
    width: w,
    compact,
    labelW,
    totalW,
    gridX,
    gridW,
    totalX: gridX + gridW + gap,
    // Label every hour when there is room, otherwise every 2nd or 3rd (both divide 12, so "Noon" always shows).
    hourStep: pxPerHour >= 26 ? 1 : pxPerHour >= 14 ? 2 : 3,
    // Finest tick marks between the hour lines: 15 minutes, 30 minutes, or none.
    tickMinutes: pxPerHour >= 26 ? 15 : pxPerHour >= 12 ? 30 : 0,
  };
}

export function rowIndex(status) {
  return ROWS.findIndex((r) => r.key === status);
}

function minuteOfDay(dayStartMs, iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.round((ms - dayStartMs) / 60000);
}

/**
 * Turn one day's segments into runs that tile the whole day (00:00 to 24:00, in whole minutes).
 *
 * Time with no recorded duty status (before the trip starts, after the final dropoff) is shown as off duty,
 * so every sheet accounts for all 24 hours and the four row totals always add up to 24:00.
 */
export function buildDaySheet(date, segments) {
  const dayStartMs = Date.parse(`${date}T00:00:00Z`);
  const raw = [];
  if (!Number.isNaN(dayStartMs) && Array.isArray(segments)) {
    segments.forEach((s) => {
      if (rowIndex(s?.status) < 0) return;
      const a = minuteOfDay(dayStartMs, s.start);
      const b = minuteOfDay(dayStartMs, s.end);
      if (a === null || b === null) return;
      const start = Math.max(0, Math.min(MINUTES_PER_DAY, a));
      const end = Math.max(0, Math.min(MINUTES_PER_DAY, b));
      if (end > start) raw.push({ status: s.status, start, end });
    });
  }
  raw.sort((x, y) => x.start - y.start);

  const runs = [];
  const push = (status, start, end) => {
    if (end <= start) return;
    const last = runs[runs.length - 1];
    if (last && last.status === status && last.end === start) {
      last.end = end;
    } else {
      runs.push({ status, start, end });
    }
  };

  let cursor = 0;
  raw.forEach((seg) => {
    const start = Math.max(seg.start, cursor);
    push('OFF_DUTY', cursor, start);
    push(seg.status, start, seg.end);
    cursor = Math.max(cursor, seg.end);
  });
  push('OFF_DUTY', cursor, MINUTES_PER_DAY);

  const totals = Object.fromEntries(ROWS.map((r) => [r.key, 0]));
  runs.forEach((r) => {
    totals[r.status] += r.end - r.start;
  });

  // A change is where one run hands over to a different status.
  const changes = [];
  for (let i = 1; i < runs.length; i += 1) {
    changes.push({ minute: runs[i].start, from: runs[i - 1].status, to: runs[i].status });
  }

  return { runs, totals, changes };
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// "HH:MM" in UTC for an ISO timestamp (the sheets are drawn in UTC).
export function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// Attach each remark to the minute of the day it happened, number them in time order.
export function placeRemarks(date, remarks) {
  const dayStartMs = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(dayStartMs) || !Array.isArray(remarks)) return [];
  return remarks
    .map((r) => ({ ...r, minute: minuteOfDay(dayStartMs, r.time) }))
    .filter((r) => r.minute !== null)
    .map((r) => ({ ...r, minute: Math.max(0, Math.min(MINUTES_PER_DAY, r.minute)) }))
    .sort((a, b) => a.minute - b.minute)
    .map((r, i) => ({ ...r, number: i + 1 }));
}
