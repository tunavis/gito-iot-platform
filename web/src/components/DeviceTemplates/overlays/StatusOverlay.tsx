'use client';

import React from 'react';
import type { StatusOverlay } from '../types';

const TRUE_VALS  = new Set(['1', 'true', 'yes', 'on', 'running', 'active', 'open', 'online', 'generating', 'cooling', 'heating', 'enabled']);
const FALSE_VALS = new Set(['0', 'false', 'no', 'off', 'stopped', 'inactive', 'closed', 'offline', 'standby', 'idle', 'disabled']);

interface Props {
  overlay: StatusOverlay;
  value: number | string | null;
}

export default function StatusOverlayWidget({ overlay, value }: Props) {
  if (value === null || value === undefined) {
    return (
      <div style={{
        fontSize: 10,
        color: 'var(--color-text-muted)',
        background: 'var(--color-panel)',
        border: '1px solid var(--color-border)',
        borderRadius: 20,
        padding: '2px 8px',
      }}>—</div>
    );
  }

  const str    = String(value).toLowerCase().trim();
  const isTrue = TRUE_VALS.has(str) || (str !== '0' && !FALSE_VALS.has(str) && Number(value) > 0);
  const label  = isTrue ? (overlay.trueLabel ?? 'Active') : (overlay.falseLabel ?? 'Inactive');

  const dotColor = isTrue ? '#22c55e' : '#ef4444';
  const bg       = isTrue ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)';
  const border   = isTrue ? 'rgba(34,197,94,0.30)' : 'rgba(239,68,68,0.30)';
  const text     = isTrue ? '#16a34a'               : '#dc2626';

  return (
    <div
      className="flex items-center gap-1.5"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 20,
        padding: '3px 9px',
        color: text,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }}
        className={isTrue ? 'hmi-pulse' : ''}
      />
      {label}
    </div>
  );
}
