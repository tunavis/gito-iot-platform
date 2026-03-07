import React from 'react';

const B = { stroke: 'var(--color-border)', fill: 'none' } as const;
const P = { fill: 'var(--color-panel)',    stroke: 'var(--color-border)' } as const;

export function GeneratorTemplate({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Engine block ──────────────────────────────────────── */}
      <rect x="55" y="115" width="190" height="175" rx="8" strokeWidth="3" {...P} />

      {/* Cylinder heads (top of engine) */}
      {[80, 115, 150, 185].map((x) => (
        <rect key={x} x={x} y="105" width="28" height="18" rx="3" strokeWidth="2" {...P} />
      ))}

      {/* Engine cooling fins (left side) */}
      {[140, 158, 176, 194, 212, 230].map((y) => (
        <line key={y} x1="55" y1={y} x2="42" y2={y} strokeWidth="2" strokeLinecap="round" {...B} />
      ))}

      {/* Engine internals (decorative) */}
      <rect x="80" y="145" width="140" height="90" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: 'var(--color-border)', opacity: 0.6 }} />
      {/* Pistons */}
      {[100, 140, 180].map((x) => (
        <rect key={x} x={x} y="160" width="22" height="28" rx="3" strokeWidth="1.5" {...P} />
      ))}

      {/* Exhaust pipes (top) */}
      <line x1="90"  y1="105" x2="90"  y2="75" strokeWidth="6" strokeLinecap="round" {...B} />
      <line x1="170" y1="105" x2="170" y2="65" strokeWidth="6" strokeLinecap="round" {...B} />
      {/* Exhaust elbow */}
      <path d="M90,75 Q90,55 110,55 L165,55" strokeWidth="5" strokeLinecap="round" {...B} />
      <path d="M170,65 L170,55" strokeWidth="5" strokeLinecap="round" {...B} />

      {/* Fuel line */}
      <line x1="245" y1="270" x2="300" y2="270" strokeWidth="3" strokeDasharray="5,3"
        style={{ stroke: '#f59e0b', opacity: 0.7 }} strokeLinecap="round" />

      {/* ── Coupling ──────────────────────────────────────────── */}
      <rect x="245" y="175" width="22" height="50" rx="4" strokeWidth="2.5" {...P} />
      {/* Coupling bolts */}
      <circle cx="256" cy="190" r="3" strokeWidth="1.5" {...P} />
      <circle cx="256" cy="210" r="3" strokeWidth="1.5" {...P} />

      {/* ── Generator head ────────────────────────────────────── */}
      <rect x="267" y="130" width="158" height="140" rx="8" strokeWidth="3" {...P} />

      {/* Stator windings (decorative curves) */}
      {[155, 175, 195, 215].map((y) => (
        <path key={y} d={`M280,${y} Q310,${y - 12} 340,${y} Q370,${y + 12} 400,${y} Q415,${y - 6} 420,${y}`}
          strokeWidth="1.5" fill="none" style={{ stroke: 'var(--color-border)', opacity: 0.5 }} />
      ))}

      {/* Output terminals */}
      <rect x="425" y="155" width="14" height="12" rx="2" strokeWidth="2" {...P} />
      <rect x="425" y="185" width="14" height="12" rx="2" strokeWidth="2" {...P} />
      <rect x="425" y="215" width="14" height="12" rx="2" strokeWidth="2" {...P} />
      {/* Terminal labels */}
      <text x="445" y="164" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>L1</text>
      <text x="445" y="194" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>L2</text>
      <text x="445" y="224" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>N</text>

      {/* ── Base frame ────────────────────────────────────────── */}
      <rect x="40" y="290" width="400" height="14" rx="4" strokeWidth="2" {...P} />
      {/* Mounting bolts */}
      {[70, 220, 370].map((x) => (
        <circle key={x} cx={x} cy="297" r="5" strokeWidth="1.5" {...P} />
      ))}

      {/* ── Labels ────────────────────────────────────────────── */}
      <text x="150" y="380" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>ENGINE</text>
      <text x="346" y="380" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>ALTERNATOR</text>
      <text x="470" y="148" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif', writingMode: 'vertical-rl' as any }}>OUTPUT</text>
    </svg>
  );
}
