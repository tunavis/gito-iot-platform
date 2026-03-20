import React from 'react';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
// Electrical output — amber (matches energy FlowLine effect)
const E  = '#f59e0b';
// Fuel — orange dashed
const FUEL = '#f97316';
// Exhaust — dark slate
const EXH = '#64748b';

export function GeneratorTemplate({ width, height }: { width: number; height: number; telemetry?: Record<string, number | string | null> }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Engine block ──────────────────────────────────────────────── */}
      <rect x="55" y="115" width="190" height="175" rx="8" strokeWidth="3" fill={PNL} stroke={BD} />
      {/* Engine left sheen */}
      <rect x="59" y="119" width="5" height="167" rx="2.5" fill="white" fillOpacity="0.06" />

      {/* Cylinder heads (top of engine) */}
      {[80, 115, 150, 185].map((x) => (
        <rect key={x} x={x} y="105" width="28" height="18" rx="3" strokeWidth="2" fill={PNL} stroke={BD} />
      ))}

      {/* Engine cooling fins (left side) */}
      {[140, 158, 176, 194, 212, 230].map((y) => (
        <line key={y} x1="55" y1={y} x2="40" y2={y} strokeWidth="2.5" strokeLinecap="round" stroke={BD} strokeOpacity="0.5" />
      ))}

      {/* Engine internals */}
      <rect x="80" y="145" width="140" height="90" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: BD, opacity: 0.7 }} />
      {/* Pistons */}
      {[100, 140, 180].map((x) => (
        <rect key={x} x={x} y="160" width="22" height="28" rx="3" strokeWidth="1.5" fill={PNL} stroke={BD} />
      ))}

      {/* ── Exhaust pipes (top) ───────────────────────────────────────── */}
      <line x1="90"  y1="105" x2="90"  y2="75" strokeWidth="7" strokeLinecap="round" stroke={EXH} strokeOpacity="0.7" />
      <line x1="170" y1="105" x2="170" y2="65" strokeWidth="7" strokeLinecap="round" stroke={EXH} strokeOpacity="0.7" />
      {/* Exhaust elbow */}
      <path d="M90,75 Q90,55 110,55 L165,55" strokeWidth="6" strokeLinecap="round"
        stroke={EXH} strokeOpacity="0.7" fill="none" />
      <path d="M170,65 L170,55" strokeWidth="6" strokeLinecap="round"
        stroke={EXH} strokeOpacity="0.7" fill="none" />
      {/* Exhaust tip cap */}
      <circle cx="165" cy="55" r="5" fill={EXH} fillOpacity="0.5" />

      {/* ── Fuel line ─────────────────────────────────────────────────── */}
      <line x1="245" y1="268" x2="305" y2="268" strokeWidth="3" strokeDasharray="5,3"
        stroke={FUEL} strokeOpacity="0.75" strokeLinecap="round" />
      <text x="270" y="284"
        style={{ fill: FUEL, fontSize: 8, fontFamily: 'system-ui,sans-serif', opacity: 0.75 }}>
        FUEL
      </text>

      {/* ── Coupling ──────────────────────────────────────────────────── */}
      <rect x="245" y="175" width="22" height="50" rx="4" strokeWidth="2.5" fill={PNL} stroke={BD} />
      <circle cx="256" cy="190" r="3.5" strokeWidth="1.5" fill={PNL} stroke={BD} />
      <circle cx="256" cy="210" r="3.5" strokeWidth="1.5" fill={PNL} stroke={BD} />

      {/* ── Generator / alternator head ────────────────────────────────── */}
      <rect x="267" y="130" width="158" height="140" rx="8" strokeWidth="3" fill={PNL} stroke={BD} />
      {/* Left sheen */}
      <rect x="271" y="134" width="5" height="132" rx="2.5" fill="white" fillOpacity="0.06" />
      {/* Stator windings */}
      {[155, 175, 195, 215].map((y) => (
        <path key={y}
          d={`M282,${y} Q312,${y - 12} 342,${y} Q372,${y + 12} 402,${y} Q416,${y - 6} 422,${y}`}
          strokeWidth="1.5" fill="none"
          style={{ stroke: E, opacity: 0.3 }} />
      ))}

      {/* ── Output terminals — amber (electrical) ─────────────────────── */}
      {[155, 185, 215].map((y, i) => (
        <g key={y}>
          <rect x="424" y={y} width="16" height="12" rx="2" strokeWidth="2"
            fill={PNL} stroke={E} strokeOpacity="0.8" />
          {/* Terminal wire stub */}
          <line x1="440" y1={y + 6} x2="452" y2={y + 6} strokeWidth="2.5"
            stroke={E} strokeOpacity="0.7" strokeLinecap="round" />
          <text x="458" y={y + 10}
            style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>
            {['L1', 'L2', 'N'][i]}
          </text>
        </g>
      ))}

      {/* ── Base frame ────────────────────────────────────────────────── */}
      <rect x="40" y="290" width="400" height="14" rx="4" strokeWidth="2" fill={PNL} stroke={BD} />
      {[70, 220, 370].map((x) => (
        <circle key={x} cx={x} cy="297" r="5.5" strokeWidth="1.5" fill={PNL} stroke={BD} />
      ))}

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="150" y="375" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        ENGINE
      </text>
      <text x="346" y="375" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        ALTERNATOR
      </text>
    </svg>
  );
}