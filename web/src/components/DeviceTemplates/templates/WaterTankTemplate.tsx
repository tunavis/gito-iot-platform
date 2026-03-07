import React from 'react';

const B = { stroke: 'var(--color-border)', fill: 'none' } as const;
const P = { fill: 'var(--color-panel)',    stroke: 'var(--color-border)' } as const;

export function WaterTankTemplate({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Inlet pipe (left → tank side) ──────────────────────── */}
      <line x1="30" y1="95" x2="182" y2="95" strokeWidth="8" strokeLinecap="round" {...B} />
      {/* Arrow on inlet */}
      <polyline points="162,84 178,95 162,106" strokeWidth="2" strokeLinejoin="round" {...B} />

      {/* ── Tank body ─────────────────────────────────────────── */}
      <rect x="182" y="60" width="170" height="280" rx="8" strokeWidth="3" {...P} />

      {/* Tank ruler / measurement marks on right side */}
      {[100, 145, 190, 235, 280].map((y) => (
        <line key={y} x1="352" y1={y} x2="365" y2={y} strokeWidth="1.5" strokeLinecap="round" {...B} />
      ))}
      <line x1="358" y1="100" x2="358" y2="280" strokeWidth="1" {...B} style={{ opacity: 0.35 }} />

      {/* Dashed level guide lines inside tank */}
      {[130, 190, 250].map((y) => (
        <line key={y} x1="192" y1={y} x2="342" y2={y} strokeWidth="0.8" strokeDasharray="5,5"
          style={{ stroke: 'var(--color-border)', opacity: 0.4 }} />
      ))}

      {/* ── Outlet pipe (tank bottom → right → pump) ──────────── */}
      <line x1="250" y1="340" x2="250" y2="368" strokeWidth="8" strokeLinecap="round" {...B} />
      <line x1="250" y1="368" x2="440" y2="368" strokeWidth="8" strokeLinecap="round" {...B} />
      {/* Arrow on outlet */}
      <polyline points="415,357 431,368 415,379" strokeWidth="2" strokeLinejoin="round" {...B} />

      {/* ── Pump symbol ───────────────────────────────────────── */}
      <circle cx="463" cy="368" r="22" strokeWidth="3" {...P} />
      {/* Impeller cross */}
      <line x1="463" y1="352" x2="463" y2="384" strokeWidth="2" {...B} />
      <line x1="447" y1="368" x2="479" y2="368" strokeWidth="2" {...B} />
      {/* Pump outlet stub (up) */}
      <line x1="463" y1="346" x2="463" y2="330" strokeWidth="6" strokeLinecap="round" {...B} />

      {/* ── Labels ────────────────────────────────────────────── */}
      <text x="30" y="82" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>INLET</text>
      <text x="245" y="50" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>STORAGE TANK</text>
      <text x="300" y="388" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>OUTLET</text>
      <text x="463" y="406" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>PUMP</text>
    </svg>
  );
}
