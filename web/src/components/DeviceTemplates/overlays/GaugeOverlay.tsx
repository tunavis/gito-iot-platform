'use client';

import React from 'react';
import type { GaugeOverlay } from '../types';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function formatVal(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100)  return v.toFixed(0);
  if (Math.abs(v) >= 10)   return v.toFixed(1);
  return v.toFixed(1);
}

interface Props {
  overlay: GaugeOverlay;
  value: number | string | null;
}

export default function GaugeOverlayWidget({ overlay, value }: Props) {
  const size   = overlay.size ?? 72;
  const cx     = size / 2;
  const cy     = size / 2;
  const r      = (size - 14) / 2;

  const numVal = value === null || value === undefined ? null : Number(value);
  const pct    = numVal === null || isNaN(numVal)
    ? 0
    : clamp((numVal - overlay.min) / Math.max(overlay.max - overlay.min, 0.001), 0, 1);

  // Arc: sweeps 240° starting at 150° (clock face: 7 o'clock → 5 o'clock)
  const START_DEG = 150;
  const SWEEP_DEG = 240;

  function polar(deg: number) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(startDeg: number, endDeg: number) {
    const s = polar(startDeg);
    const e = polar(endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }

  const trackPath = arcPath(START_DEG, START_DEG + SWEEP_DEG);
  const fillEnd   = START_DEG + SWEEP_DEG * pct;
  const fillPath  = pct > 0.005 ? arcPath(START_DEG, fillEnd) : null;

  const fillColor =
    pct > 0.85 ? '#ef4444' :
    pct > 0.65 ? '#f59e0b' :
    '#2563eb';

  const label = overlay.label;

  return (
    <div className="flex flex-col items-center" style={{ width: size + 8 }}>
      {label && (
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 1 }}>
          {label}
        </span>
      )}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* Track */}
        <path d={trackPath} fill="none" style={{ stroke: 'var(--color-border)' }} strokeWidth="5" strokeLinecap="round" />
        {/* Value arc */}
        {fillPath && (
          <path d={fillPath} fill="none" stroke={fillColor} strokeWidth="5" strokeLinecap="round" />
        )}
        {/* Center value */}
        {numVal !== null && (
          <text
            x={cx} y={cy + 4}
            textAnchor="middle"
            style={{ fill: 'var(--color-text-primary)', fontSize: size * 0.2, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}
          >
            {formatVal(numVal)}
          </text>
        )}
        {numVal === null && (
          <text x={cx} y={cy + 4} textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: size * 0.18 }}>—</text>
        )}
      </svg>
      {overlay.unit && (
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: -2 }}>{overlay.unit}</span>
      )}
    </div>
  );
}
