import React from 'react';

import { formatDuration } from '../utils/stops';
import { CYCLE_LIMIT_HOURS, formatMiles, formatSpan } from '../utils/tripSummary';

// One-glance overview of the plan, shown above the map, stops and log sheets.
export default function TripSummary({ summary }) {
  const cycle = Math.round(summary.cycleAfterHours * 10) / 10;
  const stats = [
    { label: 'Distance', value: formatMiles(summary.distanceMiles) || '–' },
    { label: 'Driving time', value: formatDuration(summary.drivingMinutes) || '–' },
    { label: 'Trip length', value: formatSpan(summary.totalMinutes) || '–', note: `${summary.days} log ${summary.days === 1 ? 'day' : 'days'}` },
    {
      label: 'Rest stops',
      value: `${summary.rests} ${summary.rests === 1 ? 'rest' : 'rests'}`,
      note: summary.restarts ? `${summary.restarts} ${summary.restarts === 1 ? 'restart' : 'restarts'}` : null,
    },
    { label: 'Cycle after trip', value: `${cycle} of ${CYCLE_LIMIT_HOURS} hrs` },
  ];

  return (
    <section className="Summary" aria-label="Trip summary">
      <dl className="SummaryList">
        {stats.map((stat) => (
          <div className="SummaryStat" key={stat.label}>
            <dt className="SummaryLabel">{stat.label}</dt>
            <dd className="SummaryValue">{stat.value}</dd>
            {stat.note ? <dd className="SummaryNote">{stat.note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
