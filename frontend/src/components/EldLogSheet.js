import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildDaySheet,
  formatClock,
  formatDuration,
  placeRemarks,
  ROWS,
  rowIndex,
  sheetLayout,
  MINUTES_PER_DAY,
  SHEET_DEFAULT_WIDTH,
} from '../utils/logSheet';

// Vertical geometry (SVG user units = px; the horizontal geometry comes from sheetLayout for the available width).
const GRID_Y = 34;
const ROW_H = 38;
const GRID_H = ROW_H * ROWS.length;
const GRID_BOTTOM = GRID_Y + GRID_H;
const LANE_H = 20;
const MARKER_R = 9;

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

// Tick marks along the bottom edge of every row, like the printed grid on a paper log.
function tickPath(layout) {
  if (!layout.tickMinutes) return '';
  const perHour = 60 / layout.tickMinutes;
  const parts = [];
  for (let r = 0; r < ROWS.length; r += 1) {
    const bottom = GRID_Y + (r + 1) * ROW_H;
    for (let q = 1; q < 24 * perHour; q += 1) {
      if (q % perHour === 0) continue;
      const x = layout.gridX + (q / (24 * perHour)) * layout.gridW;
      const half = (q * layout.tickMinutes) % 30 === 0;
      parts.push(`M${x.toFixed(2)} ${bottom}v${half ? -9 : -6}`);
    }
  }
  return parts.join('');
}

// Put markers that would overlap into separate lanes beneath the grid.
function assignLanes(remarks, xFor) {
  const lastX = [];
  return remarks.map((r) => {
    const x = xFor(r.minute);
    let lane = lastX.findIndex((prev) => x - prev >= MARKER_R * 2 + 3);
    if (lane === -1) lane = lastX.length;
    lastX[lane] = x;
    return { ...r, x, lane };
  });
}

// Width available to the sheet's content, kept up to date as the window or card resizes.
function useContentWidth(ref) {
  const [width, setWidth] = useState(SHEET_DEFAULT_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export default function EldLogSheet({ date, segments, remarks, dayIndex = 0, dayCount = 1 }) {
  const bodyRef = useRef(null);
  const layout = sheetLayout(useContentWidth(bodyRef));
  const xFor = (minute) => layout.gridX + (minute / MINUTES_PER_DAY) * layout.gridW;

  const sheet = useMemo(() => buildDaySheet(date, segments), [date, segments]);
  const placed = useMemo(
    () => assignLanes(placeRemarks(date, remarks), (m) => layout.gridX + (m / MINUTES_PER_DAY) * layout.gridW),
    [date, remarks, layout.gridX, layout.gridW]
  );
  const ticks = useMemo(() => tickPath(layout), [layout]);

  const lanes = placed.reduce((n, r) => Math.max(n, r.lane + 1), 0);
  const height = GRID_BOTTOM + 14 + lanes * LANE_H + (lanes ? 6 : 0) + (layout.compact ? 8 : 22);
  const totalAll = ROWS.reduce((n, r) => n + sheet.totals[r.key], 0);

  const summary = ROWS.map((r) => `${r.label} ${formatDuration(sheet.totals[r.key])}`).join(', ');
  const titleId = `eld-title-${date}`;
  const descId = `eld-desc-${date}`;
  const hours = Array.from({ length: 25 }, (_, h) => h).filter((h) => h % layout.hourStep === 0);

  return (
    <div className="Card LogSheet">
      <div className="CardHeader">
        <h3 className="CardTitle">
          Daily log{dayCount > 1 ? ` — day ${dayIndex + 1} of ${dayCount}` : ''}
        </h3>
        <div className="CardSubtitle">{formatLongDate(date)} · times in UTC</div>
      </div>

      <div className="LogSheetBody" ref={bodyRef}>
        <svg
          className={layout.compact ? 'LogSheetSvg LogSheetSvg--compact' : 'LogSheetSvg'}
          viewBox={`0 0 ${layout.width} ${height}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{`Duty status graph for ${date}`}</title>
          <desc id={descId}>{`Hours on each line: ${summary}. Total ${formatDuration(totalAll)}.`}</desc>

          {/* Hour scale */}
          {hours.map((h) => (
            <text className="LogSheetHour" key={`h${h}`} x={xFor(h * 60)} y={GRID_Y - 10} textAnchor="middle">
              {hourLabel(h)}
            </text>
          ))}

          {/* Grid */}
          <rect className="LogGridBox" x={layout.gridX} y={GRID_Y} width={layout.gridW} height={GRID_H} />
          {Array.from({ length: 23 }, (_, i) => i + 1)
            .filter((h) => layout.gridW / 24 >= 8 || h % layout.hourStep === 0)
            .map((h) => (
              <line
                className={h % 12 === 0 ? 'LogGridLine LogGridLine--noon' : 'LogGridLine'}
                key={`v${h}`}
                x1={xFor(h * 60)}
                x2={xFor(h * 60)}
                y1={GRID_Y}
                y2={GRID_BOTTOM}
              />
            ))}
          {ROWS.slice(1).map((r, i) => (
            <line
              className="LogGridRowLine"
              key={`r${r.key}`}
              x1={layout.gridX}
              x2={layout.gridX + layout.gridW}
              y1={GRID_Y + (i + 1) * ROW_H}
              y2={GRID_Y + (i + 1) * ROW_H}
            />
          ))}
          {ticks ? <path className="LogGridTicks" d={ticks} /> : null}

          {/* Row labels (and the totals column when there is room for it) */}
          {ROWS.map((r, i) => (
            <g key={`label${r.key}`}>
              <rect
                className="LogRowKey"
                data-status={r.key}
                x={layout.compact ? 2 : 6}
                y={GRID_Y + i * ROW_H + ROW_H / 2 - 5}
                width="10"
                height="10"
                rx="2"
              />
              <text
                className="LogSheetRowLabel"
                x={layout.gridX - (layout.compact ? 6 : 10)}
                y={GRID_Y + i * ROW_H + ROW_H / 2 + 4}
                textAnchor="end"
              >
                {layout.compact ? r.short : r.label}
              </text>
              {layout.totalW ? (
                <>
                  <rect className="LogTotalBox" x={layout.totalX} y={GRID_Y + i * ROW_H} width={layout.totalW} height={ROW_H} />
                  <text
                    className="LogSheetTotal LogSheetRowTotal"
                    x={layout.totalX + layout.totalW / 2}
                    y={GRID_Y + i * ROW_H + ROW_H / 2 + 5}
                    textAnchor="middle"
                  >
                    {formatDuration(sheet.totals[r.key])}
                  </text>
                </>
              ) : null}
            </g>
          ))}
          {layout.totalW ? (
            <>
              <text className="LogSheetColHead" x={layout.totalX + layout.totalW / 2} y={GRID_Y - 10} textAnchor="middle">
                Total hours
              </text>
              <text
                className="LogSheetTotal LogSheetGrand"
                x={layout.totalX + layout.totalW / 2}
                y={GRID_BOTTOM + 18}
                textAnchor="middle"
              >
                = {formatDuration(totalAll)}
              </text>
            </>
          ) : null}

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
              strokeWidth="2"
            />
          ))}

          {/* Numbered remark markers, one per status change, matching the list below */}
          {placed.map((r) => {
            const cy = GRID_BOTTOM + 14 + r.lane * LANE_H + MARKER_R;
            return (
              <g key={`rm${r.number}`} className="LogSheetMarker">
                <line className="LogMarkerTick" x1={r.x} x2={r.x} y1={GRID_BOTTOM} y2={cy - MARKER_R} strokeWidth="1" />
                <circle className="LogMarkerDot" cx={r.x} cy={cy} r={MARKER_R} />
                <text className="LogSheetMarkerNum" x={r.x} y={cy + 4} textAnchor="middle">
                  {r.number}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Narrow sheets have no totals column, so the hours per status go in a list under the graph. */}
        {layout.compact ? (
          <dl className="LogTotals" aria-label="Hours by duty status">
            {ROWS.map((r) => (
              <div className="LogTotal" key={`t${r.key}`}>
                <dt>
                  <span className="LogTotalKey" data-status={r.key} aria-hidden="true" />
                  {r.label}
                </dt>
                <dd>{formatDuration(sheet.totals[r.key])}</dd>
              </div>
            ))}
            <div className="LogTotal LogTotal--sum">
              <dt>Total</dt>
              <dd>{formatDuration(totalAll)}</dd>
            </div>
          </dl>
        ) : null}

        {placed.length ? (
          <div className="LogRemarks">
            <div className="LogRemarksTitle">Remarks</div>
            <ol className="LogRemarksList" style={{ '--remark-rows': Math.ceil(placed.length / 2) }}>
              {placed.map((r) => (
                <li key={`rl${r.number}`} className="LogRemark">
                  <span className="LogRemarkNumber">{r.number}</span>
                  <span className="LogRemarkTime">{formatClock(r.time)}</span>
                  <span className="LogRemarkBody">
                    <span className="LogRemarkPlace">{r.place}</span>
                    <span className="LogRemarkActivity">{r.activity}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}
