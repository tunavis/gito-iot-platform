import React from 'react';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
// Inlet (suction) — blue water
const W  = '#3b82f6';
const WL = '#93c5fd';
const WD = '#1d4ed8';
// Outlet (discharge) — orange (higher pressure side)
const D  = '#f97316';
const DL = '#fed7aa';
const DD = '#c2410c';

export function PumpTemplate({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Inlet pipe (left → pump, y=200) — blue (suction) ─────────── */}
      <line x1="30"  y1="200" x2="175" y2="200" strokeWidth="12" strokeLinecap="round" stroke={WD} strokeOpacity="0.35" />
      <line x1="30"  y1="200" x2="175" y2="200" strokeWidth="10" strokeLinecap="round" stroke={W}  strokeOpacity="0.85" />
      <line x1="30"  y1="197" x2="175" y2="197" strokeWidth="2.5" strokeLinecap="round" stroke={WL} strokeOpacity="0.55" />
      {/* Inlet tap (bottom) */}
      <line x1="192" y1="200" x2="192" y2="232" strokeWidth="5" strokeLinecap="round" stroke={W} strokeOpacity="0.6" />
      <circle cx="192" cy="238" r="9" strokeWidth="2" fill={PNL} stroke={BD} />
      {/* Inlet flow arrow */}
      <polyline points="142,192 158,200 142,208" strokeWidth="2" strokeLinejoin="round" stroke={WL} fill="none" />

      {/* ── Outlet pipe (pump → right, y=200) — orange (discharge) ────── */}
      <line x1="325" y1="200" x2="470" y2="200" strokeWidth="12" strokeLinecap="round" stroke={DD} strokeOpacity="0.35" />
      <line x1="325" y1="200" x2="470" y2="200" strokeWidth="10" strokeLinecap="round" stroke={D}  strokeOpacity="0.85" />
      <line x1="325" y1="197" x2="470" y2="197" strokeWidth="2.5" strokeLinecap="round" stroke={DL} strokeOpacity="0.55" />
      {/* Outlet tap (bottom) */}
      <line x1="308" y1="200" x2="308" y2="232" strokeWidth="5" strokeLinecap="round" stroke={D} strokeOpacity="0.6" />
      <circle cx="308" cy="238" r="9" strokeWidth="2" fill={PNL} stroke={BD} />
      {/* Outlet flow arrow */}
      <polyline points="436,192 452,200 436,208" strokeWidth="2" strokeLinejoin="round" stroke={DL} fill="none" />

      {/* ── Pump volute / casing ──────────────────────────────────────── */}
      <circle cx="250" cy="220" r="75" strokeWidth="4" fill={PNL} stroke={BD} />
      <circle cx="250" cy="220" r="60" strokeWidth="0.8" fill="none" stroke={BD} strokeOpacity="0.25" />
      {/* Volute scroll */}
      <path d="M250,220 m0,-50 a50,50 0 1,1 -35,35" strokeWidth="1.5" strokeDasharray="4,3"
        style={{ stroke: BD, opacity: 0.4 }} fill="none" />
      {/* Impeller blades */}
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1  = 250 + 18 * Math.cos(rad);
        const y1  = 220 + 18 * Math.sin(rad);
        const x2  = 250 + 44 * Math.cos(rad + 0.4);
        const y2  = 220 + 44 * Math.sin(rad + 0.4);
        return (
          <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
            strokeWidth="3.5" strokeLinecap="round" stroke={BD} strokeOpacity="0.55" />
        );
      })}
      {/* Shaft hub */}
      <circle cx="250" cy="220" r="11" strokeWidth="2" fill={PNL} stroke={BD} />
      <circle cx="250" cy="220" r="4"  fill={BD} fillOpacity="0.5" />

      {/* ── Motor body (above pump) ───────────────────────────────────── */}
      <rect x="198" y="100" width="104" height="62" rx="8" strokeWidth="2.5" fill={PNL} stroke={BD} />
      {[212, 226, 240, 254, 268, 282].map((x) => (
        <line key={x} x1={x} y1="100" x2={x} y2="162" strokeWidth="1" stroke={BD} strokeOpacity="0.35" />
      ))}
      <rect x="202" y="104" width="4" height="54" rx="2" fill="white" fillOpacity="0.06" />
      {/* Shaft coupling */}
      <rect x="239" y="155" width="22" height="18" rx="3" strokeWidth="2" fill={PNL} stroke={BD} />
      <circle cx="250" cy="159" r="2.5" fill={BD} fillOpacity="0.5" />
      <circle cx="250" cy="169" r="2.5" fill={BD} fillOpacity="0.5" />

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="30"  y="190"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        INLET
      </text>
      <text x="456" y="190" textAnchor="end"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        OUTLET
      </text>
      <text x="250" y="94" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        MOTOR
      </text>
      <text x="250" y="312" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        CENTRIFUGAL PUMP
      </text>
    </svg>
  );
}