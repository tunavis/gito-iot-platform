'use client';

import React from 'react';
import type { LevelOverlay } from '../types';

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

interface Props {
  overlay: LevelOverlay;
  value: number | string | null;
}

export default function LevelOverlayWidget({ overlay, value }: Props) {
  const numVal  = value === null || value === undefined ? null : Number(value);
  const capacity = overlay.capacity ?? 100;
  const pct     = numVal === null || isNaN(numVal) ? 0 : clamp(numVal / capacity, 0, 1);

  const fillColor =
    pct > 0.70 ? '#22c55e' :
    pct > 0.35 ? '#3b82f6' :
    pct > 0.15 ? '#f59e0b' :
    '#ef4444';

  const barW = overlay.width  ?? 18;
  const barH = overlay.height ?? 72;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Vertical fill bar */}
      <div
        style={{
          width: barW,
          height: barH,
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: `${pct * 100}%`,
            backgroundColor: fillColor,
            opacity: 0.75,
            transition: 'height 0.7s ease',
            borderRadius: '0 0 3px 3px',
          }}
        />
      </div>
      {/* Percentage label */}
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}>
        {numVal === null ? '—' : `${(pct * 100).toFixed(0)}%`}
      </span>
      {overlay.unit && numVal !== null && (
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: -2 }}>{overlay.unit}</span>
      )}
    </div>
  );
}
