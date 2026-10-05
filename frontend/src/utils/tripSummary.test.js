import {
  CYCLE_LIMIT_HOURS,
  DRIVING_LIMIT_HOURS,
  SHIFT_WINDOW_HOURS,
  formatMiles,
  formatSpan,
  haversineMiles,
  peakShift,
  routeMiles,
  summarizeTrip,
} from './tripSummary';
import { encodePolyline } from './polylineTestHelper';

const seg = (status, start, end) => ({ status, start, end });

describe('distance', () => {
  test('haversine matches a known city pair (Chicago to Dallas is about 800 miles in a straight line)', () => {
    const miles = haversineMiles([41.8781, -87.6298], [32.7767, -96.797]);
    expect(miles).toBeGreaterThan(790);
    expect(miles).toBeLessThan(805);
  });

  test('routeMiles adds up the legs of the drawn route', () => {
    const leg = encodePolyline([
      [41.8781, -87.6298],
      [32.7767, -96.797],
    ]);
    const one = routeMiles({ legs: [{ polyline: leg }] });
    expect(routeMiles({ legs: [{ polyline: leg }, { polyline: leg }] })).toBeCloseTo(one * 2, 3);
  });

  test('missing or malformed routes count as zero miles', () => {
    expect(routeMiles(undefined)).toBe(0);
    expect(routeMiles({ legs: [{ polyline: '' }, {}] })).toBe(0);
  });
});

describe('summarizeTrip', () => {
  const dailyLogs = [
    {
      date: '2026-10-05',
      segments: [
        seg('DRIVING', '2026-10-05T10:00:00Z', '2026-10-05T18:00:00Z'),
        seg('OFF_DUTY', '2026-10-05T18:00:00Z', '2026-10-05T18:30:00Z'),
        seg('DRIVING', '2026-10-05T18:30:00Z', '2026-10-05T21:30:00Z'),
        seg('OFF_DUTY', '2026-10-05T21:30:00Z', '2026-10-06T00:00:00Z'),
      ],
    },
    {
      date: '2026-10-06',
      segments: [
        seg('OFF_DUTY', '2026-10-06T00:00:00Z', '2026-10-06T07:30:00Z'),
        seg('DRIVING', '2026-10-06T07:30:00Z', '2026-10-06T10:30:00Z'),
        seg('ON_DUTY', '2026-10-06T10:30:00Z', '2026-10-06T11:30:00Z'),
      ],
    },
  ];
  const stops = [{ type: 'CURRENT' }, { type: 'BREAK_30' }, { type: 'REST_10' }, { type: 'PICKUP' }];

  test('driving time, days, total span and rests come from the plan', () => {
    const s = summarizeTrip({ stops, dailyLogs, route: undefined, cycleUsedHours: 20 });
    expect(s.drivingMinutes).toBe(14 * 60);
    expect(s.days).toBe(2);
    expect(s.totalMinutes).toBe(25 * 60 + 30);
    expect(s.rests).toBe(1);
    expect(s.restarts).toBe(0);
  });

  test('cycle after the trip adds driving and on-duty hours to what was already used', () => {
    expect(summarizeTrip({ stops, dailyLogs, cycleUsedHours: 20 }).cycleAfterHours).toBe(20 + 14 + 1);
    expect(CYCLE_LIMIT_HOURS).toBe(70);
  });

  test('a 34-hour restart resets the cycle', () => {
    const logs = [
      {
        date: '2026-10-05',
        segments: [
          seg('DRIVING', '2026-10-05T08:00:00Z', '2026-10-05T16:00:00Z'),
          seg('OFF_DUTY', '2026-10-05T16:00:00Z', '2026-10-06T00:00:00Z'),
        ],
      },
      { date: '2026-10-06', segments: [seg('OFF_DUTY', '2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z')] },
      {
        date: '2026-10-07',
        segments: [
          seg('OFF_DUTY', '2026-10-07T00:00:00Z', '2026-10-07T02:00:00Z'),
          seg('DRIVING', '2026-10-07T02:00:00Z', '2026-10-07T06:00:00Z'),
        ],
      },
    ];
    // 8 + 24 + 2 = 34 consecutive off-duty hours reset 50 + 8 hours back to zero, then 4 more hours of driving.
    const s = summarizeTrip({ stops: [{ type: 'RESTART_34' }], dailyLogs: logs, cycleUsedHours: 50 });
    expect(s.cycleAfterHours).toBe(4);
    expect(s.restarts).toBe(1);
  });

  test('33 hours off duty is not a restart', () => {
    const logs = [
      { date: '2026-10-05', segments: [seg('DRIVING', '2026-10-05T08:00:00Z', '2026-10-05T16:00:00Z'), seg('OFF_DUTY', '2026-10-05T16:00:00Z', '2026-10-06T00:00:00Z')] },
      { date: '2026-10-06', segments: [seg('OFF_DUTY', '2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z')] },
      { date: '2026-10-07', segments: [seg('OFF_DUTY', '2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z'), seg('DRIVING', '2026-10-07T01:00:00Z', '2026-10-07T02:00:00Z')] },
    ];
    expect(summarizeTrip({ dailyLogs: logs, cycleUsedHours: 50 }).cycleAfterHours).toBe(50 + 8 + 1);
  });

  test('segments split at midnight are joined back before measuring a restart', () => {
    const logs = [
      { date: '2026-10-05', segments: [seg('OFF_DUTY', '2026-10-05T12:00:00Z', '2026-10-06T00:00:00Z')] },
      { date: '2026-10-06', segments: [seg('OFF_DUTY', '2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z'), seg('DRIVING', '2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z')] },
    ];
    expect(summarizeTrip({ dailyLogs: logs, cycleUsedHours: 60 }).cycleAfterHours).toBe(1);
  });

  test('empty input does not throw', () => {
    expect(summarizeTrip({})).toMatchObject({ drivingMinutes: 0, totalMinutes: 0, days: 0, rests: 0, cycleAfterHours: 0 });
  });
});

describe('formatting', () => {
  test('formatSpan', () => {
    expect(formatSpan(30)).toBe('30 min');
    expect(formatSpan(60)).toBe('1 hr');
    expect(formatSpan(9 * 60 + 40)).toBe('9 hrs 40 min');
    expect(formatSpan(24 * 60)).toBe('1 day');
    expect(formatSpan(3 * 1440 + 22 * 60)).toBe('3 days 22 hrs');
    expect(formatSpan(0)).toBe('');
  });

  test('formatMiles', () => {
    expect(formatMiles(1496.6)).toBe('1,497 mi');
    expect(formatMiles(0)).toBe('');
  });
});

describe('peakShift', () => {
  const day = (date, segments) => ({ date, segments });

  test('the limits are the HOS rules the planner enforces', () => {
    expect([DRIVING_LIMIT_HOURS, SHIFT_WINDOW_HOURS, CYCLE_LIMIT_HOURS]).toEqual([11, 14, 70]);
  });

  test('driving and window are measured per shift, and a 30-minute break does not start a new shift', () => {
    const logs = [
      day('2026-10-05', [
        seg('DRIVING', '2026-10-05T10:00:00Z', '2026-10-05T18:00:00Z'), // 8h
        seg('OFF_DUTY', '2026-10-05T18:00:00Z', '2026-10-05T18:30:00Z'), // 30 min break
        seg('DRIVING', '2026-10-05T18:30:00Z', '2026-10-05T21:30:00Z'), // 3h -> 11h driving, 11.5h window
        seg('OFF_DUTY', '2026-10-05T21:30:00Z', '2026-10-06T00:00:00Z'),
      ]),
      day('2026-10-06', [
        seg('OFF_DUTY', '2026-10-06T00:00:00Z', '2026-10-06T07:30:00Z'), // 10h rest in total
        seg('DRIVING', '2026-10-06T07:30:00Z', '2026-10-06T10:30:00Z'),
        seg('ON_DUTY', '2026-10-06T10:30:00Z', '2026-10-06T11:30:00Z'),
      ]),
    ];
    expect(peakShift(logs)).toEqual({ peakDrivingMinutes: 11 * 60, peakWindowMinutes: 11 * 60 + 30 });
  });

  test('a 9-hour gap is not a rest, so both stretches count as one shift', () => {
    const logs = [
      day('2026-10-05', [
        seg('DRIVING', '2026-10-05T08:00:00Z', '2026-10-05T12:00:00Z'),
        seg('OFF_DUTY', '2026-10-05T12:00:00Z', '2026-10-05T21:00:00Z'),
        seg('DRIVING', '2026-10-05T21:00:00Z', '2026-10-05T23:00:00Z'),
      ]),
    ];
    expect(peakShift(logs)).toEqual({ peakDrivingMinutes: 6 * 60, peakWindowMinutes: 15 * 60 });
  });

  test('time off duty after the last work is not part of the window', () => {
    const logs = [day('2026-10-05', [seg('DRIVING', '2026-10-05T08:00:00Z', '2026-10-05T10:00:00Z'), seg('OFF_DUTY', '2026-10-05T10:00:00Z', '2026-10-06T00:00:00Z')])];
    expect(peakShift(logs)).toEqual({ peakDrivingMinutes: 120, peakWindowMinutes: 120 });
  });

  test('empty input does not throw', () => {
    expect(peakShift(undefined)).toEqual({ peakDrivingMinutes: 0, peakWindowMinutes: 0 });
  });
});
