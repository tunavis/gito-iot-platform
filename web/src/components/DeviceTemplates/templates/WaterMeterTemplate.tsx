import React from 'react';

const B = { stroke: 'var(--color-border)', fill: 'none' } as const;
const P = { fill: 'var(--color-panel)',    stroke: 'var(--color-border)' } as const;

export function WaterMeterTemplate({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Main pipe (full width) ─────────────────────────────── */}
      <line x1="30"  y1="200" x2="172" y2="200" strokeWidth="10" strokeLinecap="round" {...B} />
      <line x1="328" y1="200" x2="470" y2="200" strokeWidth="10" strokeLinecap="round" {...B} />

      {/* Flow direction arrows */}
      <polyline points="100,188 118,200 100,212" strokeWidth="2" strokeLinejoin="round" {...B} />
      <polyline points="382,188 398,200 382,212" strokeWidth="2" strokeLinejoin="round" {...B} />

      {/* ── Flanges (connection collars) ──────────────────────── */}
      <rect x="162" y="184" width="14" height="32" rx="2" strokeWidth="2" {...P} />
      <rect x="324" y="184" width="14" height="32" rx="2" strokeWidth="2" {...P} />

      {/* ── Meter housing ─────────────────────────────────────── */}
      <rect x="176" y="120" width="148" height="160" rx="10" strokeWidth="3" {...P} />

      {/* Meter display face */}
      <rect x="198" y="142" width="104" height="80" rx="6" strokeWidth="2"
        style={{ fill: 'var(--color-page)', stroke: 'var(--color-border)' }} />

      {/* Register tick marks */}
      {[-30, -18, -6, 6, 18, 30].map((dx) => (
        <line key={dx} x1={250 + dx} y1="150" x2={250 + dx} y2="158" strokeWidth="1.5" {...B} />
      ))}
      {/* Register needle */}
      <line x1="250" y1="182" x2="265" y2="162" strokeWidth="2" strokeLinecap="round"
        style={{ stroke: '#2563eb' }} />
      <circle cx="250" cy="182" r="3" style={{ fill: '#2563eb' }} />

      {/* ── Pipe stub connections ─────────────────────────────── */}
      <line x1="176" y1="200" x2="198" y2="200" strokeWidth="8" strokeLinecap="round" {...B} />
      <line x1="302" y1="200" x2="324" y2="200" strokeWidth="8" strokeLinecap="round" {...B} />

      {/* Serial / model plate */}
      <rect x="198" y="238" width="104" height="28" rx="4" strokeWidth="1"
        style={{ fill: 'var(--color-panel)', stroke: 'var(--color-border)', opacity: 0.6 }} />
      {[0,1,2,3,4,5].map((i) => (
        <rect key={i} x={203 + i * 16} y="243" width="10" height="18" rx="2"
          style={{ fill: 'var(--color-page)', stroke: 'var(--color-border)' }} strokeWidth="1" />
      ))}

      {/* ── Labels ────────────────────────────────────────────── */}
      <text x="30" y="190" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>IN</text>
      <text x="452" y="190" textAnchor="end" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>OUT</text>
      <text x="250" y="115" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>FLOW METER</text>
    </svg>
  );
}
