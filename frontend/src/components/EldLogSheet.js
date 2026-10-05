import React, { useMemo } from 'react';

import { buildDaySheet, formatClock, formatDuration, placeRemarks, ROWS, rowIndex, MINUTES_PER_DAY } from '../utils/logSheet';

// Drawing geometry (SVG user units; the SVG scales to its container width).
const WIDTH = 1000;
const LABEL_W = 176;
const GRID_X = LABEL_W;
const GRID_W = 704;
const TOTAL_X = GRID_X + GRID_W + 8;
const TOTAL_W = WIDTH - TOTAL_X - 2;
const GRID_Y = 34;
const ROW_H = 38;
const GRID_H = ROW_H * ROWS.length;
const GRID_BOTTOM = GRID_Y + GRID_H;
const LANE_H = 20;
const MARKER_R = 8;

const STATUS_COLOR = {
  DRIVING: '#2563eb',
  ON_DUTY: '#b45309',
  SLEEPER: '#0f766e',
  OFF_DUTY: '#111827',
};

const xFor = (minute) => GRID_X + (minute / MINUTES_PER_DAY) * GRID_W;
const yFor = (status) => GRID_Y + rowIndex(status) * ROW_H + ROW_H / 2;

function hourLabel(h) {
  if (h === 0 || h === 24) return 'Mid';
  if (h === 12) return 'Noon';
  return String(h % 12);
}

function formatLongDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Quarter-hour tick marks along the bottom edge of every row, like the printed grid on a paper log.
function tickPath() {
  const parts = [];
  for (let r = 0; r < ROWS.length; r += 1) {
    const bottom = GRID_Y + (r + 1) * ROW_H;
    for (let q = 1; q < 24 * 4; q += 1) {
      if (q % 4 === 0) continue;
      const x = GRID_X + (q / 96) * GRID_W;
      parts.push(`M${x.toFixed(2)} ${bottom}v${q % 2 === 0 ? -9 : -6}`);
    }
  }
  return parts.join('');
}
const TICKS = tickPath();

// Put markers that would overlap into separate lanes beneath the grid.
function assignLanes(remarks) {
  const lastX = [];
  return remarks.map((r) => {
    const x = xFor(r.minute);
    let lane = lastX.findIndex((prev) => x - prev >= MARKER_R * 2 + 3);
    if (lane === -1) lane = lastX.length;
    lastX[lane] = x;
    return { ...r, x, lane };
  });
}

export default function EldLogSheet({ date, segments, remarks, dayIndex = 0, dayCount = 1 }) {
  const sheet = useMemo(() => buildDaySheet(date, segments), [date, segments]);
  const placed = useMemo(() => assignLanes(placeRemarks(date, remarks)), [date, remarks]);

  const lanes = placed.reduce((n, r) => Math.max(n, r.lane + 1), 0);
  const height = GRID_BOTTOM + 14 + lanes * LANE_H + (lanes ? 6 : 0) + 22;
  const totalAll = ROWS.reduce((n, r) => n + sheet.totals[r.key], 0);

  const summary = ROWS.map((r) => `${r.label} ${formatDuration(sheet.totals[r.key])}`).join(', ');
  const titleId = `eld-title-${date}`;
  const descId = `eld-desc-${date}`;

  return (
    <div className="Card LogSheet">
      <div className="CardHeader">
        <h3 className="CardTitle">
          Daily log{dayCount > 1 ? ` — day ${dayIndex + 1} of ${dayCount}` : ''}
        </h3>
        <div className="CardSubtitle">{formatLongDate(date)} · times in UTC</div>
      </div>

      <div className="LogSheetBody">
        <svg
          className="LogSheetSvg"
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{`Duty status graph for ${date}`}</title>
          <desc id={descId}>{`Hours on each line: ${summary}. Total ${formatDuration(totalAll)}.`}</desc>

          {/* Hour scale */}
          {Array.from({ length: 25 }, (_, h) => (
            <text key={`h${h}`} x={xFor(h * 60)} y={GRID_Y - 10} textAnchor="middle" fontSize="11" fill="#526077">
              {hourLabel(h)}
            </text>
          ))}

          {/* Grid */}
          <rect x={GRID_X} y={GRID_Y} width={GRID_W} height={GRID_H} fill="#ffffff" stroke="#94a3b8" />
          {Array.from({ length: 23 }, (_, i) => (
            <line
              key={`v${i + 1}`}
              x1={xFor((i + 1) * 60)}
              x2={xFor((i + 1) * 60)}
              y1={GRID_Y}
              y2={GRID_BOTTOM}
              stroke={(i + 1) % 12 === 0 ? '#94a3b8' : '#e2e8f0'}
            />
          ))}
          {ROWS.slice(1).map((r, i) => (
            <line key={`r${r.key}`} x1={GRID_X} x2={GRID_X + GRID_W} y1={GRID_Y + (i + 1) * ROW_H} y2={GRID_Y + (i + 1) * ROW_H} stroke="#94a3b8" />
          ))}
          <path d={TICKS} stroke="#94a3b8" strokeWidth="1" fill="none" />

          {/* Row labels and totals */}
          {ROWS.map((r, i) => (
            <g key={`label${r.key}`}>
              <text x={GRID_X - 10} y={GRID_Y + i * ROW_H + ROW_H / 2 + 4} textAnchor="end" fontSize="13" fontWeight="600" fill="#0f172a">
                {r.label}
              </text>
              <rect x={TOTAL_X} y={GRID_Y + i * ROW_H} width={TOTAL_W} height={ROW_H} fill="#ffffff" stroke="#94a3b8" />
              <text
                className="LogSheetTotal"
                x={TOTAL_X + TOTAL_W / 2}
                y={GRID_Y + i * ROW_H + ROW_H / 2 + 5}
                textAnchor="middle"
                fontSize="15"
                fontWeight="700"
                fill="#0f172a"
              >
                {formatDuration(sheet.totals[r.key])}
              </text>
            </g>
          ))}
          <text x={TOTAL_X + TOTAL_W / 2} y={GRID_Y - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#526077">
            Total hours
          </text>
          <text className="LogSheetTotal" x={TOTAL_X + TOTAL_W / 2} y={GRID_BOTTOM + 18} textAnchor="middle" fontSize="13" fontWeight="800" fill="#0f172a">
            = {formatDuration(totalAll)}
          </text>

          {/* Duty-status line: a bar along the row for each period, joined by a vertical line at each change */}
          {sheet.runs.map((run) => (
            <line
              key={`run${run.start}`}
              className="LogSheetRun"
              data-status={run.status}
              x1={xFor(run.start)}
              x2={xFor(run.end)}
              y1={yFor(run.status)}
              y2={yFor(run.status)}
              stroke={STATUS_COLOR[run.status]}
              strokeWidth="4"
            />
          ))}
          {sheet.changes.map((c) => (
            <line
              key={`chg${c.minute}`}
              className="LogSheetChange"
              x1={xFor(c.minute)}
              x2={xFor(c.minute)}
              y1={yFor(c.from)}
              y2={yFor(c.to)}
              stroke="#0f172a"
              strokeWidth="2"
            />
          ))}

          {/* Numbered remark markers, one per status change, matching the list below */}
          {placed.map((r) => {
            const cy = GRID_BOTTOM + 14 + r.lane * LANE_H + MARKER_R;
            return (
              <g key={`rm${r.number}`} className="LogSheetMarker">
                <line x1={r.x} x2={r.x} y1={GRID_BOTTOM} y2={cy - MARKER_R} stroke="#0f172a" strokeWidth="1" />
                <circle cx={r.x} cy={cy} r={MARKER_R} fill="#0f172a" />
                <text x={r.x} y={cy + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffffff">
                  {r.number}
                </text>
              </g>
            );
          })}
        </svg>

        {placed.length ? (
          <div className="LogRemarks">
            <div className="LogRemarksTitle">Remarks</div>
            <ol className="LogRemarksList">
              {placed.map((r) => (
                <li key={`rl${r.number}`} className="LogRemark">
                  <span className="LogRemarkNumber">{r.number}</span>
                  <span className="LogRemarkTime">{formatClock(r.time)}</span>
                  <span className="LogRemarkPlace">{r.place}</span>
                  <span className="LogRemarkActivity">{r.activity}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="LogSheetNote">
          Time before the trip starts and after the final dropoff is shown as off duty so each day adds up to 24 hours.
        </div>
      </div>
    </div>
  );
}
