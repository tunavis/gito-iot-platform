import React from 'react';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
// Return air (warm, unconditioned) — amber
const RET  = '#f97316';
const RETL = '#fed7aa';
// Supply air (cool, conditioned) — cyan/air color (matches air FlowLine effect)
const SUP  = '#22d3ee';
const SUPL = '#a5f3fc';
// Refrigerant — cyan
const REF = '#22d3ee';
// Coil fins — blue
const COIL = '#3b82f6';

export function HvacTemplate({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Return duct (left → AHU) — warm/orange ─────────────────────── */}
      {/* Duct interior fill */}
      <rect x="30" y="188" width="85" height="24" fill={RET} fillOpacity="0.15" />
      {/* Duct walls */}
      <line x1="30"  y1="188" x2="115" y2="188" strokeWidth="2" stroke={RET} strokeOpacity="0.6" />
      <line x1="30"  y1="212" x2="115" y2="212" strokeWidth="2" stroke={RET} strokeOpacity="0.6" />
      {/* Duct centerline fill (shows airflow mass) */}
      <line x1="30"  y1="200" x2="115" y2="200" strokeWidth="20" strokeLinecap="butt"
        stroke={RET} strokeOpacity="0.12" />
      {/* Return flow arrows */}
      <polyline points="58,193 73,200 58,207" strokeWidth="2" strokeLinejoin="round"
        stroke={RETL} fill="none" strokeOpacity="0.9" />

      {/* ── Supply duct (AHU → right) — cool/cyan ──────────────────────── */}
      <rect x="385" y="188" width="85" height="24" fill={SUP} fillOpacity="0.15" />
      <line x1="385" y1="188" x2="470" y2="188" strokeWidth="2" stroke={SUP} strokeOpacity="0.6" />
      <line x1="385" y1="212" x2="470" y2="212" strokeWidth="2" stroke={SUP} strokeOpacity="0.6" />
      <line x1="385" y1="200" x2="470" y2="200" strokeWidth="20" strokeLinecap="butt"
        stroke={SUP} strokeOpacity="0.12" />
      {/* Supply flow arrows */}
      <polyline points="418,193 433,200 418,207" strokeWidth="2" strokeLinejoin="round"
        stroke={SUPL} fill="none" strokeOpacity="0.9" />

      {/* ── AHU housing ────────────────────────────────────────────────── */}
      <rect x="115" y="80" width="270" height="240" rx="10" strokeWidth="3" fill={PNL} stroke={BD} />
      <rect x="119" y="84" width="5" height="232" rx="2.5" fill="white" fillOpacity="0.05" />

      {/* ── Filter section (left) ───────────────────────────────────────── */}
      <rect x="128" y="95" width="48" height="210" rx="4" strokeWidth="2"
        style={{ fill: 'var(--color-page)', stroke: BD }} />
      {/* Filter mesh — horizontal */}
      {[108, 124, 140, 156, 172, 188, 204, 220, 236, 252, 268, 284].map((y) => (
        <line key={`fh${y}`} x1="128" y1={y} x2="176" y2={y} strokeWidth="0.8"
          stroke={BD} strokeOpacity="0.5" />
      ))}
      {/* Filter mesh — vertical */}
      {[140, 156, 172].map((x) => (
        <line key={`fv${x}`} x1={x} y1="95" x2={x} y2="305" strokeWidth="0.8"
          stroke={BD} strokeOpacity="0.5" />
      ))}
      <text x="152" y="316" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>
        FILTER
      </text>

      {/* ── Coil section (center) ──────────────────────────────────────── */}
      <rect x="190" y="95" width="60" height="210" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: BD }} />
      {/* Coil fins — blue */}
      {[108, 122, 136, 150, 164, 178, 192, 206, 220, 234, 248, 262, 276, 290].map((y) => (
        <line key={y} x1="193" y1={y} x2="247" y2={y} strokeWidth="1.5"
          stroke={COIL} strokeOpacity="0.4" />
      ))}
      {/* Coil tube */}
      <line x1="220" y1="95" x2="220" y2="305" strokeWidth="3"
        stroke={COIL} strokeOpacity="0.55" />
      {/* Refrigerant pipes — cyan */}
      <line x1="220" y1="95"  x2="220" y2="68" strokeWidth="5" strokeLinecap="round"
        stroke={REF} strokeOpacity="0.75" />
      <line x1="218" y1="95"  x2="218" y2="68" strokeWidth="1.5" strokeLinecap="round"
        stroke="white" strokeOpacity="0.25" />
      <line x1="220" y1="305" x2="220" y2="332" strokeWidth="5" strokeLinecap="round"
        stroke={REF} strokeOpacity="0.75" />
      <line x1="218" y1="305" x2="218" y2="332" strokeWidth="1.5" strokeLinecap="round"
        stroke="white" strokeOpacity="0.25" />
      <text x="220" y="318" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>
        COIL
      </text>

      {/* ── Fan section (right) ────────────────────────────────────────── */}
      <rect x="264" y="95" width="108" height="210" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: BD }} />
      {/* Fan housing */}
      <circle cx="318" cy="200" r="52" strokeWidth="2"
        style={{ fill: PNL, stroke: BD }} />
      {/* Fan blades */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad1 = (deg * Math.PI) / 180;
        const rad2 = ((deg + 25) * Math.PI) / 180;
        const x1   = 318 + 12 * Math.cos(rad1);
        const y1   = 200 + 12 * Math.sin(rad1);
        const x2   = 318 + 44 * Math.cos(rad2);
        const y2   = 200 + 44 * Math.sin(rad2);
        return (
          <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
            strokeWidth="4" strokeLinecap="round" stroke={BD} strokeOpacity="0.5" />
        );
      })}
      {/* Fan hub */}
      <circle cx="318" cy="200" r="11" strokeWidth="2" fill={PNL} stroke={BD} />
      <circle cx="318" cy="200" r="4"  fill={BD} fillOpacity="0.5" />
      <text x="318" y="316" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>
        FAN
      </text>

      {/* ── Temperature sensors ────────────────────────────────────────── */}
      {/* Return sensor */}
      <circle cx="100" cy="200" r="8" strokeWidth="2" fill={PNL} stroke={RET} strokeOpacity="0.7" />
      <line x1="100" y1="192" x2="100" y2="178" strokeWidth="2" strokeLinecap="round"
        stroke={RET} strokeOpacity="0.6" />
      {/* Supply sensor */}
      <circle cx="400" cy="200" r="8" strokeWidth="2" fill={PNL} stroke={SUP} strokeOpacity="0.7" />
      <line x1="400" y1="192" x2="400" y2="178" strokeWidth="2" strokeLinecap="round"
        stroke={SUP} strokeOpacity="0.6" />

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="30"  y="176"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.04em' }}>
        RETURN AIR
      </text>
      <text x="388" y="176"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.04em' }}>
        SUPPLY AIR
      </text>
      <text x="250" y="368" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.08em' }}>
        AIR HANDLING UNIT
      </text>
    </svg>
  );
}