import { describeStop, describeStops, formatClockTime, formatDateTime, formatDuration, timeZoneLabel } from './stops';

const UTC = { timeZone: 'UTC', locale: 'en-US' };
const CHICAGO = { timeZone: 'America/Chicago', locale: 'en-US' };

const stop = (type, location, start, durationMin = 0) => ({
  type,
  location,
  start_time: start,
  end_time: new Date(Date.parse(start) + durationMin * 60000).toISOString(),
  duration: durationMin,
  lat: 0,
  lng: 0,
});

describe('formatDuration', () => {
  test('minutes, hours and mixed', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(30)).toBe('30 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(600)).toBe('10 hrs');
    expect(formatDuration(2040)).toBe('34 hrs');
    expect(formatDuration(95)).toBe('1 hr 35 min');
    expect(formatDuration('x')).toBe('');
  });
});

describe('times', () => {
  test('are 24-hour HH:MM in UTC by default, without seconds or ISO punctuation', () => {
    const iso = '2026-10-05T19:31:29.824040Z';
    expect(formatClockTime(iso)).toBe('19:31');
    expect(formatDateTime(iso)).toBe('Mon, Oct 5, 19:31');
  });

  test('read the same clock time as the log sheet remarks (utils/logSheet formatClock)', () => {
    // The first log remark of a trip starting at 14:54 UTC reads "14:54"; so does the first stop.
    expect(formatClockTime('2026-10-05T14:54:58.756820Z')).toBe('14:54');
    expect(formatClockTime('2026-10-05T04:05:00Z')).toBe('04:05');
    expect(formatClockTime('2026-10-05T00:00:00Z')).toBe('00:00');
  });

  test('another time zone can still be requested (used by the tests below)', () => {
    const iso = '2026-10-05T19:31:29.824040Z';
    expect(formatClockTime(iso, CHICAGO)).toBe('14:31');
    expect(formatDateTime(iso, CHICAGO)).toBe('Mon, Oct 5, 14:31');
  });

  test('bad timestamps give empty strings instead of "Invalid Date"', () => {
    expect(formatClockTime('nope')).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });

  test('timeZoneLabel says UTC by default', () => {
    expect(timeZoneLabel()).toBe('UTC');
    expect(timeZoneLabel(CHICAGO)).toMatch(/^C[DS]T$/);
  });
});

describe('describeStop', () => {
  test('replaces enum values with plain titles', () => {
    const titles = {
      CURRENT: 'Start',
      PICKUP: 'Pickup',
      DROPOFF: 'Dropoff',
      BREAK_30: 'Break',
      REST_10: 'Rest',
      RESTART_34: '34-hour restart',
      FUEL: 'Fuel stop',
    };
    Object.entries(titles).forEach(([type, title]) => {
      expect(describeStop(stop(type, 'x', '2026-10-05T10:00:00Z'), undefined, UTC).title).toBe(title);
    });
  });

  test('start, pickup and dropoff show the place as typed; breaks and rests show how long', () => {
    expect(describeStop(stop('CURRENT', 'Chicago, IL', '2026-10-05T10:00:00Z'), undefined, UTC).detail).toBe('Chicago, IL');
    expect(describeStop(stop('PICKUP', 'Dallas, TX', '2026-10-05T10:00:00Z'), undefined, UTC).detail).toBe('Dallas, TX');
    expect(describeStop(stop('BREAK_30', '30-min break', '2026-10-05T10:00:00Z', 30), undefined, UTC).detail).toBe('30 min');
    expect(describeStop(stop('REST_10', 'Rest (10 hours)', '2026-10-05T10:00:00Z', 600), undefined, UTC).detail).toBe('10 hrs');
    expect(describeStop(stop('RESTART_34', '34-hour restart', '2026-10-05T10:00:00Z', 2040), undefined, UTC).detail).toBe('34 hrs');
  });

  test('a zero-minute fuel stop shows no duration', () => {
    expect(describeStop(stop('FUEL', 'Fuel stop', '2026-10-05T10:00:00Z', 0), undefined, UTC).detail).toBe('');
  });

  test('on-duty hours are "Loading" after a pickup and "Unloading" after a dropoff', () => {
    const pickup = stop('PICKUP', 'Dallas, TX', '2026-10-05T10:00:00Z');
    const dropoff = stop('DROPOFF', 'New York, NY', '2026-10-06T10:00:00Z');
    const onDuty = (at) => stop('ON_DUTY', 'On Duty', at, 60);
    expect(describeStop(onDuty('2026-10-05T10:00:00Z'), pickup, UTC)).toMatchObject({ title: 'Loading', detail: '1 hr, on duty' });
    expect(describeStop(onDuty('2026-10-06T10:00:00Z'), dropoff, UTC).title).toBe('Unloading');
    expect(describeStop(onDuty('2026-10-06T10:00:00Z'), undefined, UTC).title).toBe('On duty');
  });

  test('an unknown type becomes sentence case, never a raw enum', () => {
    expect(describeStop(stop('SCALE_CHECK', 'x', '2026-10-05T10:00:00Z'), undefined, UTC).title).toBe('Scale check');
  });

  test('stops with a duration also carry the end time', () => {
    const info = describeStop(stop('REST_10', 'Rest', '2026-10-05T22:00:00Z', 600), undefined, UTC);
    expect(info.dateTime).toBe('Mon, Oct 5, 22:00');
    expect(info.endDateTime).toBe('Tue, Oct 6, 08:00');
    expect(describeStop(stop('FUEL', 'Fuel', '2026-10-05T22:00:00Z', 0), undefined, UTC).endDateTime).toBe('');
  });
});

describe('describeStops', () => {
  const trip = [
    stop('CURRENT', 'Chicago, IL', '2026-10-05T14:00:00Z'),
    stop('REST_10', 'Rest', '2026-10-05T22:00:00Z', 600),
    stop('PICKUP', 'Dallas, TX', '2026-10-06T12:00:00Z'),
    stop('ON_DUTY', 'On Duty', '2026-10-06T12:00:00Z', 60),
  ];

  test('groups by calendar day in trip order, with plain day headings', () => {
    const days = describeStops(trip, UTC);
    expect(days.map((d) => [d.key, d.label, d.items.length])).toEqual([
      ['2026-10-05', 'Mon, Oct 5', 2],
      ['2026-10-06', 'Tue, Oct 6', 2],
    ]);
    expect(days[1].items.map((i) => i.title)).toEqual(['Pickup', 'Loading']);
  });

  test('the day boundary follows the display time zone, not UTC', () => {
    // 22:00 UTC and 03:30 UTC the next day are 5:00 PM and 10:30 PM on the same Oct 5 in Chicago.
    const evening = [stop('CURRENT', 'a', '2026-10-05T22:00:00Z'), stop('REST_10', 'r', '2026-10-06T03:30:00Z', 600)];
    const chicago = describeStops(evening, CHICAGO);
    expect(chicago).toHaveLength(1);
    expect(chicago[0].key).toBe('2026-10-05');
    expect(chicago[0].items.map((i) => i.time)).toEqual(['17:00', '22:30']);
    expect(describeStops(evening, UTC)).toHaveLength(2);
  });

  test('with no options, days and times are UTC whatever the viewer\'s own time zone is', () => {
    // 22:30 UTC is already the next day in zones ahead of UTC, so a local-time implementation would fail here.
    const days = describeStops([stop('CURRENT', 'a', '2026-10-05T22:30:00Z'), stop('REST_10', 'r', '2026-10-06T08:30:00Z', 600)]);
    expect(days.map((d) => [d.key, d.label, d.items.map((i) => i.time)])).toEqual([
      ['2026-10-05', 'Mon, Oct 5', ['22:30']],
      ['2026-10-06', 'Tue, Oct 6', ['08:30']],
    ]);
  });

  test('empty or invalid input does not throw', () => {
    expect(describeStops(undefined, UTC)).toEqual([]);
    expect(describeStops([{ type: 'FUEL', location: 'f', start_time: 'bad', duration: 0 }], UTC)[0].label).toBe('Unknown day');
  });
});
