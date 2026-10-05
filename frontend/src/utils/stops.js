// Plain-language descriptions of the planner's stops: readable labels, times, grouped by day.
// Everything is shown in UTC, the same fixed time zone the log sheets use, so one event reads the same
// clock time in the stops list, the map popups and the logs (a real ELD log uses one zone throughout).
// Pure functions; an optional timeZone/locale makes them testable in other zones.

const DEFAULT_TIME_ZONE = 'UTC';
const DEFAULT_LOCALE = 'en-US';

const TYPE_LABELS = {
  CURRENT: 'Start',
  PICKUP: 'Pickup',
  DROPOFF: 'Dropoff',
  BREAK_30: 'Break',
  REST_10: 'Rest',
  RESTART_34: '34-hour restart',
  FUEL: 'Fuel stop',
};

// Stops whose `location` is the place the driver typed (the others carry only a generic label).
const PLACE_TYPES = new Set(['CURRENT', 'PICKUP', 'DROPOFF']);

function zoned(opts = {}) {
  return { timeZone: opts.timeZone || DEFAULT_TIME_ZONE, locale: opts.locale || DEFAULT_LOCALE };
}

export function formatDuration(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0 min';
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hPart = h === 1 ? '1 hr' : `${h} hrs`;
  return m === 0 ? hPart : `${hPart} ${m} min`;
}

function toDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "UTC": which time zone the displayed times are in.
export function timeZoneLabel(opts) {
  const { timeZone, locale } = zoned(opts);
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

// 24-hour "HH:MM", matching the log sheet remarks.
export function formatClockTime(iso, opts) {
  const d = toDate(iso);
  if (!d) return '';
  const { timeZone, locale } = zoned(opts);
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
}

export function formatDayLabel(iso, opts) {
  const d = toDate(iso);
  if (!d) return '';
  const { timeZone, locale } = zoned(opts);
  return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone });
}

export function formatDateTime(iso, opts) {
  const day = formatDayLabel(iso, opts);
  const time = formatClockTime(iso, opts);
  return day && time ? `${day}, ${time}` : '';
}

// Sortable calendar-day key in the display time zone (yyyy-mm-dd).
function dayKey(iso, opts) {
  const d = toDate(iso);
  if (!d) return 'unknown';
  const { timeZone } = zoned(opts);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * One stop as plain text: a title ("Rest"), a detail line ("10 hrs" or the place), and its start time.
 * `prev` is the stop before it, which tells a pickup's on-duty hour ("Loading") from a dropoff's ("Unloading").
 */
export function describeStop(stop, prev, opts) {
  const type = stop?.type;
  let title = TYPE_LABELS[type];
  if (type === 'ON_DUTY') {
    title = prev?.type === 'PICKUP' ? 'Loading' : prev?.type === 'DROPOFF' ? 'Unloading' : 'On duty';
  }
  if (!title) {
    // Unknown type from a newer backend: "SOME_TYPE" -> "Some type".
    const words = String(type || 'Stop').toLowerCase().replace(/_/g, ' ');
    title = words.charAt(0).toUpperCase() + words.slice(1);
  }

  const minutes = Number(stop?.duration);
  const duration = Number.isFinite(minutes) && minutes > 0 ? formatDuration(minutes) : '';
  let detail;
  if (PLACE_TYPES.has(type)) detail = stop.location || '';
  else if (type === 'ON_DUTY') detail = duration ? `${duration}, on duty` : '';
  else detail = duration;

  return {
    type,
    title,
    detail,
    duration,
    place: PLACE_TYPES.has(type) ? stop.location || '' : '',
    time: formatClockTime(stop?.start_time, opts),
    dateTime: formatDateTime(stop?.start_time, opts),
    endDateTime: duration ? formatDateTime(stop?.end_time, opts) : '',
  };
}

/** Stops grouped by calendar day (in the display time zone), in trip order. */
export function describeStops(stops, opts) {
  const list = Array.isArray(stops) ? stops : [];
  const days = [];
  list.forEach((stop, index) => {
    const key = dayKey(stop?.start_time, opts);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: formatDayLabel(stop?.start_time, opts) || 'Unknown day', items: [] };
      days.push(day);
    }
    day.items.push({ id: `${index}-${stop?.type}`, ...describeStop(stop, list[index - 1], opts) });
  });
  return days;
}
