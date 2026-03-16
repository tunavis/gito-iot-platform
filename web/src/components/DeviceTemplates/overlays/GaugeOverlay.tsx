'use client';

import React from 'react';
import type { GaugeOverlay } from '../types';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function formatVal(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100)  return v.toFixed(0);
  return v.toFixed(1);
}

interface Props {
  overlay: GaugeOverlay;
  value: number | string | null;
}

export default function GaugeOverlayWidget({ overlay, value }: Props) {
  const size = overlay.size ?? 80;
  const cx   = size / 2;
  const cy   = size / 2;
  const r    = (size - 16) / 2;

  const numVal = value === null || value === undefined ? null : Number(value);
  const pct    = numVal === null || isNaN(numVal)
    ? 0
    : clamp((numVal - overlay.min) / Math.max(overlay.max - overlay.min, 0.001), 0, 1);

  // Arc: 240° sweep from 7 o'clock (150°) to 5 o'clock (390°)
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
    '#3b82f6';

  // Tick marks at 0%, 25%, 50%, 75%, 100%
  const rInner = r - 6;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const deg = START_DEG + SWEEP_DEG * t;
    const outer = polar(deg);
    const inner = { x: cx + rInner * Math.cos(((deg - 90) * Math.PI) / 180), y: cy + rInner * Math.sin(((deg - 90) * Math.PI) / 180) };
    return { outer, inner, major: t === 0 || t === 0.5 || t === 1 };
  });

  const label = overlay.label;

  return (
    <div className="flex flex-col items-center" style={{ width: size + 8 }}>
      {label && (
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
          {label}
        </span>
      )}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* Track background — thicker for readability */}
        <path d={trackPath} fill="none" style={{ stroke: 'var(--color-border)' }}
          strokeWidth="7" strokeLinecap="round" strokeOpacity="0.5" />
        {/* Value arc */}
        {fillPath && (
          <path d={fillPath} fill="none" stroke={fillColor}
            strokeWidth="7" strokeLinecap="round" />
        )}
        {/* Tick marks */}
        {ticks.map((tick, i) => (
          <line key={i}
            x1={tick.outer.x} y1={tick.outer.y}
            x2={tick.inner.x} y2={tick.inner.y}
            strokeWidth={tick.major ? 1.5 : 1}
            stroke="var(--color-border)"
            strokeOpacity={tick.major ? 0.7 : 0.4}
          />
        ))}
        {/* Center value */}
        {numVal !== null && (
          <text
            x={cx} y={cy + 5}
            textAnchor="middle"
            style={{ fill: 'var(--color-text-primary)', fontSize: size * 0.21, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}
          >
            {formatVal(numVal)}
          </text>
        )}
        {numVal === null && (
          <text x={cx} y={cy + 5} textAnchor="middle"
            style={{ fill: 'var(--color-text-muted)', fontSize: size * 0.2 }}>
            —
          </text>
        )}
      </svg>
      {overlay.unit && (
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: -3 }}>
          {overlay.unit}
        </span>
      )}
    </div>
  );
}