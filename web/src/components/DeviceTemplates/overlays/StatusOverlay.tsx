'use client';

import React from 'react';

const TRUE_VALS  = new Set(['1', 'true', 'yes', 'on', 'running', 'active', 'open', 'online', 'generating', 'cooling', 'heating', 'enabled']);
const FALSE_VALS = new Set(['0', 'false', 'no', 'off', 'stopped', 'inactive', 'closed', 'offline', 'standby', 'idle', 'disabled']);

interface Props {
  value: number | string;
  trueLabel?: string;
  falseLabel?: string;
}

/** Boolean state pill — rendered by TemplateRenderer in the container corner */
export default function StatusPill({ value, trueLabel, falseLabel }: Props) {
  const str    = String(value).toLowerCase().trim();
  const isTrue = TRUE_VALS.has(str) || (str !== '0' && !FALSE_VALS.has(str) && Number(value) > 0);
  const label  = isTrue ? (trueLabel ?? 'Active') : (falseLabel ?? 'Inactive');

  const dotColor = isTrue ? '#22c55e' : '#ef4444';
  const border   = isTrue ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
  const text     = isTrue ? '#4ade80' : '#f87171';

  return (
    <div
      className="flex items-center gap-1.5"
      style={{
        background: 'linear-gradient(180deg, rgba(17,24,38,0.85), rgba(8,12,20,0.85))',
        border: `1px solid ${border}`,
        borderRadius: 20,
        padding: '3px 9px',
        color: text,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      <div style={{
        width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0,
        boxShadow: isTrue ? `0 0 6px ${dotColor}` : 'none',
      }} />
      {label}
    </div>
  );
}
