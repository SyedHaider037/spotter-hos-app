import React from 'react';

import { formatDuration } from '../utils/stops';
import { CYCLE_LIMIT_HOURS, DRIVING_LIMIT_HOURS, SHIFT_WINDOW_HOURS } from '../utils/tripSummary';

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const pct = (n) => `${Math.round(clamp01(n) * 1000) / 10}%`;
const hrs = (n) => `${Math.round(n * 10) / 10} hrs`;

// One limit: a name, a ruled bar like the grid on a paper log (a tick per hour, per 10 hours on the cycle) filled up
// to the value, the figure, and a one-line note. On phones the figure moves up beside the name and the note hides.
function Limit({ name, limit, ticks, valueNow, ariaLabel, value, note, children }) {
  return (
    <div className="Limit">
      <div className="LimitName">{name}</div>
      <div
        className="LimitBar"
        style={{ '--ticks': ticks }}
        role="meter"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(valueNow, limit)}
      >
        {children}
      </div>
      <div className="LimitReadout">
        <span className="LimitValue">{value}</span>
        <span className="LimitOf">of {limit} hrs</span>
      </div>
      <div className="LimitNote">{note}</div>
    </div>
  );
}

/**
 * The three hours-of-service limits as a strip under the page title.
 * Before a trip is planned it shows the limits, with the cycle meter following the hours typed into the form.
 * After a plan it shows the busiest shift in the plan against the 11-hour and 14-hour limits, and the cycle before
 * and after the trip against the 70-hour limit.
 */
export default function HosLimits({ cycleBefore, plan }) {
  const before = Math.max(0, Math.min(CYCLE_LIMIT_HOURS, Number.isFinite(cycleBefore) ? cycleBefore : 0));
  const planned = Boolean(plan);

  const driving = planned ? plan.peakDrivingMinutes / 60 : 0;
  const shift = planned ? plan.peakWindowMinutes / 60 : 0;
  const after = planned ? plan.cycleAfterHours : before;
  const added = planned && after > before ? after - before : 0; // a restart makes "after" smaller than "before"

  return (
    <section className="Limits" aria-label="Hours-of-service limits">
      <h2 className="LimitsTitle">Hours-of-service limits</h2>

      <div className="LimitsRow">
        <Limit
          name="Driving per shift"
          limit={DRIVING_LIMIT_HOURS}
          ticks={DRIVING_LIMIT_HOURS}
          valueNow={driving}
          ariaLabel={`Driving in the busiest shift: ${hrs(driving)} of ${DRIVING_LIMIT_HOURS} hours`}
          value={planned ? formatDuration(plan.peakDrivingMinutes) : '–'}
          note={planned ? 'Busiest shift in this plan' : 'After 10 hrs off duty'}
        >
          <div className="LimitFill LimitFill--driving" style={{ width: pct(driving / DRIVING_LIMIT_HOURS) }} />
        </Limit>

        <Limit
          name="Shift window"
          limit={SHIFT_WINDOW_HOURS}
          ticks={SHIFT_WINDOW_HOURS}
          valueNow={shift}
          ariaLabel={`Longest shift: ${hrs(shift)} of ${SHIFT_WINDOW_HOURS} hours`}
          value={planned ? formatDuration(plan.peakWindowMinutes) : '–'}
          note={planned ? 'Longest shift, breaks included' : 'Counts breaks too'}
        >
          <div className="LimitFill LimitFill--window" style={{ width: pct(shift / SHIFT_WINDOW_HOURS) }} />
        </Limit>

        <Limit
          name="Cycle"
          limit={CYCLE_LIMIT_HOURS}
          ticks={CYCLE_LIMIT_HOURS / 10}
          valueNow={planned ? after : before}
          ariaLabel={`Cycle hours: ${hrs(before)} used${planned ? `, ${hrs(after)} after this trip` : ''}, of ${CYCLE_LIMIT_HOURS}`}
          value={planned ? `${hrs(before)} → ${hrs(after)}` : hrs(before)}
          note={planned ? 'Before and after this trip' : 'Used so far; follows the form'}
        >
          {/* After a restart the cycle starts over, so only the hours since then are drawn. */}
          <div
            className="LimitFill LimitFill--cycle"
            style={{ width: pct((planned && after < before ? after : before) / CYCLE_LIMIT_HOURS) }}
          />
          {added > 0 ? (
            <div
              className="LimitFill LimitFill--added"
              style={{ left: pct(before / CYCLE_LIMIT_HOURS), width: pct(added / CYCLE_LIMIT_HOURS) }}
            />
          ) : null}
        </Limit>
      </div>
    </section>
  );
}
