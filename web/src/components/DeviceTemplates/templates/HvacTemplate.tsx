import React from 'react';

const B = { stroke: 'var(--color-border)', fill: 'none' } as const;
const P = { fill: 'var(--color-panel)',    stroke: 'var(--color-border)' } as const;

export function HvacTemplate({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Return duct (left → AHU) ───────────────────────────── */}
      <line x1="30"  y1="200" x2="115" y2="200" strokeWidth="24" strokeLinecap="butt" {...B} />
      {/* Duct walls */}
      <line x1="30"  y1="188" x2="115" y2="188" strokeWidth="2" {...B} />
      <line x1="30"  y1="212" x2="115" y2="212" strokeWidth="2" {...B} />
      {/* Return flow arrows */}
      <polyline points="60,192 75,200 60,208" strokeWidth="2" strokeLinejoin="round" {...B} />

      {/* ── Supply duct (AHU → right) ─────────────────────────── */}
      <line x1="385" y1="200" x2="470" y2="200" strokeWidth="24" strokeLinecap="butt" {...B} />
      <line x1="385" y1="188" x2="470" y2="188" strokeWidth="2" {...B} />
      <line x1="385" y1="212" x2="470" y2="212" strokeWidth="2" {...B} />
      {/* Supply flow arrows */}
      <polyline points="420,192 435,200 420,208" strokeWidth="2" strokeLinejoin="round" {...B} />

      {/* ── AHU housing ──────────────────────────────────────── */}
      <rect x="115" y="80" width="270" height="240" rx="10" strokeWidth="3" {...P} />

      {/* ── Filter (left section) ────────────────────────────── */}
      <rect x="128" y="95" width="48" height="210" rx="4" strokeWidth="2"
        style={{ fill: 'var(--color-page)', stroke: 'var(--color-border)' }} />
      {/* Filter mesh */}
      {[108, 124, 140, 156, 172, 188, 204, 220, 236, 252, 268, 284].map((y) => (
        <line key={`fh${y}`} x1="128" y1={y} x2="176" y2={y} strokeWidth="0.8"
          style={{ stroke: 'var(--color-border)', opacity: 0.6 }} />
      ))}
      {[140, 156, 172].map((x) => (
        <line key={`fv${x}`} x1={x} y1="95" x2={x} y2="305" strokeWidth="0.8"
          style={{ stroke: 'var(--color-border)', opacity: 0.6 }} />
      ))}
      <text x="152" y="318" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>FILTER</text>

      {/* ── Coil (center section) ────────────────────────────── */}
      <rect x="190" y="95" width="60" height="210" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: 'var(--color-border)' }} />
      {/* Coil fins */}
      {[108, 122, 136, 150, 164, 178, 192, 206, 220, 234, 248, 262, 276, 290].map((y) => (
        <line key={y} x1="193" y1={y} x2="247" y2={y} strokeWidth="1.2"
          style={{ stroke: '#2563eb', opacity: 0.35 }} />
      ))}
      {/* Coil tube */}
      <line x1="220" y1="95" x2="220" y2="305" strokeWidth="2.5"
        style={{ stroke: '#2563eb', opacity: 0.5 }} />
      {/* Refrigerant pipes */}
      <line x1="220" y1="95"  x2="220" y2="68" strokeWidth="4" strokeLinecap="round"
        style={{ stroke: '#22d3ee', opacity: 0.7 }} />
      <line x1="220" y1="305" x2="220" y2="332" strokeWidth="4" strokeLinecap="round"
        style={{ stroke: '#22d3ee', opacity: 0.7 }} />
      <text x="220" y="318" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>COIL</text>

      {/* ── Fan (right section) ──────────────────────────────── */}
      <rect x="264" y="95" width="108" height="210" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: 'var(--color-border)' }} />
      {/* Fan housing circle */}
      <circle cx="318" cy="200" r="52" strokeWidth="2"
        style={{ fill: 'var(--color-panel)', stroke: 'var(--color-border)' }} />
      {/* Fan blades */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad1 = (deg * Math.PI) / 180;
        const rad2 = ((deg + 25) * Math.PI) / 180;
        const x1 = 318 + 12 * Math.cos(rad1);
        const y1 = 200 + 12 * Math.sin(rad1);
        const x2 = 318 + 44 * Math.cos(rad2);
        const y2 = 200 + 44 * Math.sin(rad2);
        return (
          <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
            strokeWidth="3.5" strokeLinecap="round"
            style={{ stroke: 'var(--color-border)' }} />
        );
      })}
      {/* Hub */}
      <circle cx="318" cy="200" r="10" strokeWidth="2" {...P} />
      <circle cx="318" cy="200" r="3"  style={{ fill: 'var(--color-border)' }} />
      <text x="318" y="318" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>FAN</text>

      {/* ── Temperature sensors (supply/return) ───────────────── */}
      <circle cx="100" cy="200" r="7" strokeWidth="2" {...P} />
      <line x1="100" y1="193" x2="100" y2="180" strokeWidth="2" strokeLinecap="round" {...B} />
      <circle cx="400" cy="200" r="7" strokeWidth="2" {...P} />
      <line x1="400" y1="193" x2="400" y2="180" strokeWidth="2" strokeLinecap="round" {...B} />

      {/* ── Labels ────────────────────────────────────────────── */}
      <text x="30"  y="176" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>RETURN AIR</text>
      <text x="388" y="176" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>SUPPLY AIR</text>
      <text x="250" y="370" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>AIR HANDLING UNIT</text>
    </svg>
  );
}
