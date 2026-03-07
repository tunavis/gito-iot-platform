'use client';

import React from 'react';
import type { ValueLabelOverlay } from '../types';

function formatNumeric(val: number): string {
  if (Math.abs(val) >= 10000) return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(val) >= 100)   return val.toFixed(1);
  if (Math.abs(val) >= 10)    return val.toFixed(1);
  return val.toFixed(2);
}

interface Props {
  overlay: ValueLabelOverlay;
  value: number | string | null;
}

export default function ValueLabelOverlayWidget({ overlay, value }: Props) {
  const displayLabel = overlay.label;
  const isEmpty = value === null || value === undefined;

  const formatted = isEmpty
    ? '—'
    : typeof value === 'number'
      ? formatNumeric(value)
      : String(value);

  return (
    <div
      className="flex flex-col items-center"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '4px 8px',
        minWidth: 56,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        backdropFilter: 'blur(4px)',
      }}
    >
      {displayLabel && (
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', lineHeight: 1.2 }}>
          {displayLabel}
        </span>
      )}
      <div className="flex items-baseline gap-0.5">
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.3 }}>
          {formatted}
        </span>
        {overlay.unit && !isEmpty && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{overlay.unit}</span>
        )}
      </div>
    </div>
  );
}
