import React from 'react';

const B = { stroke: 'var(--color-border)', fill: 'none' } as const;
const P = { fill: 'var(--color-panel)',    stroke: 'var(--color-border)' } as const;

export function PumpTemplate({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Inlet pipe (left → pump) ───────────────────────────── */}
      <line x1="30"  y1="200" x2="175" y2="200" strokeWidth="10" strokeLinecap="round" {...B} />
      <polyline points="148,188 164,200 148,212" strokeWidth="2" strokeLinejoin="round" {...B} />

      {/* ── Outlet pipe (pump → right) ────────────────────────── */}
      <line x1="325" y1="200" x2="470" y2="200" strokeWidth="10" strokeLinecap="round" {...B} />
      <polyline points="440,188 456,200 440,212" strokeWidth="2" strokeLinejoin="round" {...B} />

      {/* ── Pump volute / casing ──────────────────────────────── */}
      <circle cx="250" cy="220" r="75" strokeWidth="4" {...P} />

      {/* Volute scroll line */}
      <path d="M250,220 m0,-50 a50,50 0 1,1 -35,35" strokeWidth="1.5" strokeDasharray="4,3"
        style={{ stroke: 'var(--color-border)', opacity: 0.5 }} fill="none" />

      {/* Impeller blades (decorative) */}
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = 250 + 18 * Math.cos(rad);
        const y1 = 220 + 18 * Math.sin(rad);
        const x2 = 250 + 42 * Math.cos(rad + 0.4);
        const y2 = 220 + 42 * Math.sin(rad + 0.4);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="3" strokeLinecap="round"
          style={{ stroke: 'var(--color-border)' }} />;
      })}
      {/* Shaft circle */}
      <circle cx="250" cy="220" r="10" strokeWidth="2" {...P} />

      {/* ── Motor body (above pump) ───────────────────────────── */}
      <rect x="198" y="100" width="104" height="62" rx="8" strokeWidth="2.5" {...P} />
      {/* Motor cooling fins */}
      {[210, 224, 238, 252, 266, 280].map((x) => (
        <line key={x} x1={x} y1="100" x2={x} y2="162" strokeWidth="1" style={{ stroke: 'var(--color-border)', opacity: 0.45 }} />
      ))}
      {/* Motor shaft coupling */}
      <rect x="240" y="155" width="20" height="16" rx="2" strokeWidth="2" {...P} />

      {/* ── Pressure taps ─────────────────────────────────────── */}
      {/* Inlet tap */}
      <line x1="192" y1="200" x2="192" y2="230" strokeWidth="4" strokeLinecap="round" {...B} />
      <circle cx="192" cy="236" r="8" strokeWidth="2" {...P} />
      {/* Outlet tap */}
      <line x1="308" y1="200" x2="308" y2="230" strokeWidth="4" strokeLinecap="round" {...B} />
      <circle cx="308" cy="236" r="8" strokeWidth="2" {...P} />

      {/* ── Labels ────────────────────────────────────────────── */}
      <text x="30"  y="190" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>INLET</text>
      <text x="452" y="190" textAnchor="end" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>OUTLET</text>
      <text x="250" y="94" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>MOTOR</text>
      <text x="250" y="318" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>CENTRIFUGAL PUMP</text>
    </svg>
  );
}
