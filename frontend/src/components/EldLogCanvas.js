import React, { useEffect, useMemo, useRef } from 'react';

const ROWS = [
  { key: 'OFF_DUTY', label: 'OFF' },
  { key: 'SLEEPER', label: 'SB' },
  { key: 'DRIVING', label: 'D' },
  { key: 'ON_DUTY', label: 'ON' },
];

const STATUS_ROW_INDEX = ROWS.reduce((acc, r, idx) => {
  acc[r.key] = idx;
  return acc;
}, {});

function parseIso(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function minutesFromDayStartUTC(dayIsoDate, d) {
  // Compute minutes relative to this canvas day midnight (UTC), so an end at next-day 00:00 becomes 1440,
  // not 0 (which would incorrectly wrap and draw a full-width line).
  const dayStart = new Date(`${dayIsoDate}T00:00:00Z`);
  if (Number.isNaN(dayStart.getTime())) return null;
  return (d.getTime() - dayStart.getTime()) / 60000;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function colorForStatus(status) {
  switch (status) {
    case 'DRIVING':
      return '#2563eb';
    case 'ON_DUTY':
      return '#b45309';
    case 'SLEEPER':
      return '#0f766e';
    case 'OFF_DUTY':
    default:
      return '#111827';
  }
}

export default function EldLogCanvas({ date, segments, width = 980, height = 260 }) {
  const canvasRef = useRef(null);

  const normalized = useMemo(() => {
    if (!Array.isArray(segments)) return [];
    return segments
      .map((s) => {
        const start = parseIso(s.start);
        const end = parseIso(s.end);
        if (!start || !end) return null;
        return { status: s.status, start, end };
      })
      .filter(Boolean);
  }, [segments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Layout
    const pad = 14;
    const leftGutter = 56;
    const top = pad + 18;
    const gridX = pad + leftGutter;
    const gridY = top;
    const gridW = width - gridX - pad;
    const gridH = height - gridY - pad;
    const rowH = gridH / 4;

    // Background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.fillStyle = '#111827';
    ctx.font = '600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(`ELD Log — ${date} (UTC)`, pad, pad + 12);

    // Grid border
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.strokeRect(gridX, gridY, gridW, gridH);

    // Horizontal row lines + labels
    ctx.font = '600 12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillStyle = '#374151';
    for (let r = 0; r < 4; r += 1) {
      const y = gridY + r * rowH;
      if (r > 0) {
        ctx.beginPath();
        ctx.moveTo(gridX, y);
        ctx.lineTo(gridX + gridW, y);
        ctx.stroke();
      }
      ctx.fillText(ROWS[r].label, pad + 8, y + rowH / 2 + 4);
    }

    // Vertical hour lines + labels
    ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    for (let h = 0; h <= 24; h += 1) {
      const x = gridX + (h / 24) * gridW;
      ctx.strokeStyle = h % 6 === 0 ? '#d1d5db' : '#f3f4f6';
      ctx.beginPath();
      ctx.moveTo(x, gridY);
      ctx.lineTo(x, gridY + gridH);
      ctx.stroke();

      if (h % 2 === 0) {
        ctx.fillStyle = '#6b7280';
        const label = `${String(h).padStart(2, '0')}:00`;
        ctx.fillText(label, x - 16, gridY + gridH + 12);
      }
    }

    // Draw duty segments
    for (const seg of normalized) {
      const rowIndex = STATUS_ROW_INDEX[seg.status];
      if (rowIndex === undefined) continue;
      const yMid = gridY + rowIndex * rowH + rowH / 2;

      const startRel = minutesFromDayStartUTC(date, seg.start);
      const endRel = minutesFromDayStartUTC(date, seg.end);
      if (startRel === null || endRel === null) continue;

      const startMin = clamp(startRel, 0, 24 * 60);
      const endMin = clamp(endRel, 0, 24 * 60);
      if (endMin <= startMin) continue;

      const x1 = gridX + (startMin / (24 * 60)) * gridW;
      const x2 = gridX + (endMin / (24 * 60)) * gridW;

      ctx.strokeStyle = colorForStatus(seg.status);
      ctx.lineWidth = 6;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x1, yMid);
      ctx.lineTo(x2, yMid);
      ctx.stroke();
    }
  }, [date, normalized, width, height]);

  return (
    <div className="Card">
      <div className="CardHeader">
        <h3 className="CardTitle">ELD log sheet</h3>
        <div className="CardSubtitle">{date}</div>
      </div>
      <div className="CanvasWrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

