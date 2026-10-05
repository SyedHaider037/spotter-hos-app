import { buildDaySheet, formatClock, formatDuration, MINUTES_PER_DAY, placeRemarks, ROWS } from './logSheet';

const seg = (status, start, end) => ({ status, start, end });
const sum = (totals) => Object.values(totals).reduce((a, b) => a + b, 0);

describe('buildDaySheet', () => {
  test('a full middle day (rest, drive, break, drive, rest) totals exactly 24 hours across the four rows', () => {
    const date = '2026-10-06';
    const sheet = buildDaySheet(date, [
      seg('OFF_DUTY', '2026-10-06T00:00:00Z', '2026-10-06T07:00:00Z'),
      seg('DRIVING', '2026-10-06T07:00:00Z', '2026-10-06T15:00:00Z'),
      seg('OFF_DUTY', '2026-10-06T15:00:00Z', '2026-10-06T15:30:00Z'),
      seg('DRIVING', '2026-10-06T15:30:00Z', '2026-10-06T18:30:00Z'),
      seg('ON_DUTY', '2026-10-06T18:30:00Z', '2026-10-06T19:30:00Z'),
      seg('OFF_DUTY', '2026-10-06T19:30:00Z', '2026-10-07T00:00:00Z'),
    ]);
    expect(sheet.totals).toEqual({ OFF_DUTY: 7 * 60 + 30 + 4.5 * 60, SLEEPER: 0, DRIVING: 11 * 60, ON_DUTY: 60 });
    expect(sum(sheet.totals)).toBe(MINUTES_PER_DAY);
    expect(formatDuration(sheet.totals.OFF_DUTY)).toBe('12:00');
  });

  test('time before the trip and after the last segment is shown as off duty, so partial days still total 24h', () => {
    const sheet = buildDaySheet('2026-10-05', [
      seg('DRIVING', '2026-10-05T10:11:01.745452Z', '2026-10-05T18:11:01.745452Z'),
      seg('OFF_DUTY', '2026-10-05T18:11:01.745452Z', '2026-10-05T18:41:01.745452Z'),
      seg('DRIVING', '2026-10-05T18:41:01.745452Z', '2026-10-05T21:41:01.745452Z'),
    ]);
    expect(sheet.runs[0]).toEqual({ status: 'OFF_DUTY', start: 0, end: 10 * 60 + 11 });
    expect(sheet.runs[sheet.runs.length - 1]).toEqual({ status: 'OFF_DUTY', start: 21 * 60 + 41, end: MINUTES_PER_DAY });
    expect(sum(sheet.totals)).toBe(MINUTES_PER_DAY);
    expect(sheet.totals.DRIVING).toBe(11 * 60);
  });

  test('microsecond timestamps round to whole minutes without leaving gaps or overlaps', () => {
    const sheet = buildDaySheet('2026-10-05', [
      seg('DRIVING', '2026-10-05T10:00:30.757410Z', '2026-10-05T14:20:30.757410Z'),
      seg('ON_DUTY', '2026-10-05T14:20:30.757410Z', '2026-10-05T15:20:30.757410Z'),
    ]);
    for (let i = 1; i < sheet.runs.length; i += 1) expect(sheet.runs[i].start).toBe(sheet.runs[i - 1].end);
    expect(sheet.runs[0].start).toBe(0);
    expect(sheet.runs[sheet.runs.length - 1].end).toBe(MINUTES_PER_DAY);
    expect(sum(sheet.totals)).toBe(MINUTES_PER_DAY);
  });

  test('segments that continue across midnight are clipped to the day', () => {
    const sheet = buildDaySheet('2026-10-06', [seg('OFF_DUTY', '2026-10-05T21:30:00Z', '2026-10-06T07:30:00Z')]);
    expect(sheet.totals.OFF_DUTY).toBe(MINUTES_PER_DAY);
    expect(sheet.changes).toEqual([]);
  });

  test('a day with no segments is all off duty', () => {
    const sheet = buildDaySheet('2026-10-06', []);
    expect(sheet.runs).toEqual([{ status: 'OFF_DUTY', start: 0, end: MINUTES_PER_DAY }]);
    expect(sum(sheet.totals)).toBe(MINUTES_PER_DAY);
  });

  test('every status hand-over is reported as a change, including the filler off-duty before and after', () => {
    const sheet = buildDaySheet('2026-10-05', [
      seg('DRIVING', '2026-10-05T10:00:00Z', '2026-10-05T14:00:00Z'),
      seg('ON_DUTY', '2026-10-05T14:00:00Z', '2026-10-05T15:00:00Z'),
    ]);
    expect(sheet.changes).toEqual([
      { minute: 600, from: 'OFF_DUTY', to: 'DRIVING' },
      { minute: 840, from: 'DRIVING', to: 'ON_DUTY' },
      { minute: 900, from: 'ON_DUTY', to: 'OFF_DUTY' },
    ]);
  });

  test('ignores unknown statuses and bad timestamps instead of throwing', () => {
    const sheet = buildDaySheet('2026-10-05', [
      seg('MYSTERY', '2026-10-05T01:00:00Z', '2026-10-05T02:00:00Z'),
      seg('DRIVING', 'not-a-date', '2026-10-05T02:00:00Z'),
    ]);
    expect(sum(sheet.totals)).toBe(MINUTES_PER_DAY);
  });
});

test('the four rows are the standard duty statuses in log order', () => {
  expect(ROWS.map((r) => r.label)).toEqual(['Off duty', 'Sleeper berth', 'Driving', 'On duty (not driving)']);
});

test('formatDuration and formatClock', () => {
  expect(formatDuration(0)).toBe('0:00');
  expect(formatDuration(95)).toBe('1:35');
  expect(formatClock('2026-10-06T07:05:30Z')).toBe('07:05');
  expect(formatClock('nope')).toBe('');
});

test('placeRemarks numbers remarks in time order and positions them by minute of day', () => {
  const placed = placeRemarks('2026-10-06', [
    { time: '2026-10-06T14:30:00Z', place: 'Phoenix, AZ', activity: 'Pickup, loading (on duty)' },
    { time: '2026-10-06T07:00:00Z', place: 'Little Rock, AR', activity: 'Resume driving' },
  ]);
  expect(placed.map((r) => [r.number, r.minute, r.place])).toEqual([
    [1, 420, 'Little Rock, AR'],
    [2, 870, 'Phoenix, AZ'],
  ]);
  expect(placeRemarks('2026-10-06', undefined)).toEqual([]);
});
