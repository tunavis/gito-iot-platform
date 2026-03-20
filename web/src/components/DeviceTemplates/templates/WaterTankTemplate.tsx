import React, { useMemo } from 'react';
import type { TemplateProps } from '../TemplateRenderer';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
// Water system palette (matches FlowLine water effect)
const W  = '#3b82f6';   // blue-500
const WL = '#93c5fd';   // blue-300 highlight
const WD = '#1d4ed8';   // blue-700 shadow

/** Keys to search for a level metric in telemetry */
const LEVEL_KEYS = ['tank_level', 'level', 'fill_level', 'volume_percent', 'fill', 'water_level'];

function findLevelValue(telemetry?: Record<string, number | string | null>): number | null {
  if (!telemetry) return null;
  // Exact match
  for (const k of LEVEL_KEYS) {
    if (k in telemetry && telemetry[k] !== null) return Number(telemetry[k]);
  }
  // Substring match
  for (const [key, val] of Object.entries(telemetry)) {
    if (val !== null && LEVEL_KEYS.some(lk => key.toLowerCase().includes(lk))) return Number(val);
  }
  return null;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function WaterTankTemplate({ width, height, telemetry }: TemplateProps) {
  // Tank interior geometry (inside the rect x=182 y=60 w=170 h=280)
  const TANK_X = 185;
  const TANK_Y = 64;
  const TANK_W = 164;
  const TANK_H = 272;
  const TANK_BOTTOM = TANK_Y + TANK_H;

  const levelPct = useMemo(() => {
    const raw = findLevelValue(telemetry);
    return raw !== null ? clamp(raw / 100, 0, 1) : null;
  }, [telemetry]);

  const fillH = levelPct !== null ? TANK_H * levelPct : 0;
  const fillY = TANK_BOTTOM - fillH;
  // Water surface wave path
  const waveY = fillY;
  const wavePath = levelPct !== null && levelPct > 0.02
    ? `M${TANK_X},${waveY} c${TANK_W * 0.15},-4 ${TANK_W * 0.35},4 ${TANK_W * 0.5},0 c${TANK_W * 0.15},-3 ${TANK_W * 0.35},3 ${TANK_W * 0.5},0 V${TANK_BOTTOM} H${TANK_X} Z`
    : null;

  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">
      <defs>
        {/* Clip to tank interior so water fill doesn't bleed outside rounded corners */}
        <clipPath id="wt-tank-clip">
          <rect x="183" y="61" width="168" height="278" rx="6" />
        </clipPath>
      </defs>

      {/* ── Inlet pipe (left → tank, y=95) ────────────────────────────── */}
      <line x1="30" y1="95" x2="182" y2="95" strokeWidth="12" strokeLinecap="round" stroke={WD} strokeOpacity="0.35" />
      <line x1="30" y1="95" x2="182" y2="95" strokeWidth="10" strokeLinecap="round" stroke={W}  strokeOpacity="0.85" />
      <line x1="30" y1="92" x2="182" y2="92" strokeWidth="2.5" strokeLinecap="round" stroke={WL} strokeOpacity="0.55" />
      {/* Flange collar */}
      <rect x="170" y="87" width="10" height="16" rx="2" fill={PNL} stroke={BD} strokeWidth="1.5" />
      {/* Flow arrow */}
      <polyline points="150,88 167,95 150,102" strokeWidth="2" strokeLinejoin="round" stroke={WL} fill="none" />

      {/* ── Tank body ──────────────────────────────────────────────────── */}
      {/* Tank wall (drawn first as background) */}
      <rect x="182" y="60" width="170" height="280" rx="8" strokeWidth="3" fill={PNL} stroke={BD} />

      {/* Live water fill — clipped to tank interior */}
      <g clipPath="url(#wt-tank-clip)">
        {wavePath ? (
          <path d={wavePath} fill={W} fillOpacity="0.22">
            <animate attributeName="d"
              values={`${wavePath};M${TANK_X},${waveY} c${TANK_W * 0.15},4 ${TANK_W * 0.35},-4 ${TANK_W * 0.5},0 c${TANK_W * 0.15},3 ${TANK_W * 0.35},-3 ${TANK_W * 0.5},0 V${TANK_BOTTOM} H${TANK_X} Z;${wavePath}`}
              dur="4s" repeatCount="indefinite" />
          </path>
        ) : (
          /* Static water hint when no telemetry */
          <rect x={TANK_X} y="228" width={TANK_W} height="108" fill={W} fillOpacity="0.10" />
        )}
        {/* Water sheen (left edge lighter stripe inside the fill) */}
        {levelPct !== null && levelPct > 0.05 && (
          <rect x={TANK_X + 2} y={fillY} width="6" height={fillH} fill="white" fillOpacity="0.08" />
        )}
      </g>

      {/* Re-draw tank border on top so fill doesn't cover the stroke */}
      <rect x="182" y="60" width="170" height="280" rx="8" strokeWidth="3" fill="none" stroke={BD} />
      {/* Left inner sheen */}
      <rect x="187" y="67" width="5" height="266" rx="2.5" fill="white" fillOpacity="0.06" />

      {/* Level guide lines inside tank */}
      {[130, 190, 250].map((y) => (
        <line key={y} x1="192" y1={y} x2="342" y2={y} strokeWidth="0.8"
          strokeDasharray="5,5" stroke={BD} strokeOpacity="0.4" />
      ))}
      {/* Ruler marks + % labels */}
      {([100, 145, 190, 235, 280] as const).map((y, i) => (
        <g key={y}>
          <line x1="350" y1={y} x2="366" y2={y} strokeWidth="1.5" strokeLinecap="round" stroke={BD} />
          <text x="370" y={y + 4}
            style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>
            {['100%', '75%', '50%', '25%', '0%'][i]}
          </text>
        </g>
      ))}
      <line x1="357" y1="100" x2="357" y2="280" strokeWidth="0.8" stroke={BD} strokeOpacity="0.25" />

      {/* ── Outlet pipe (tank bottom → horizontal → pump) ─────────────── */}
      <line x1="250" y1="340" x2="250" y2="370" strokeWidth="12" strokeLinecap="round" stroke={WD} strokeOpacity="0.35" />
      <line x1="250" y1="340" x2="250" y2="370" strokeWidth="10" strokeLinecap="round" stroke={W}  strokeOpacity="0.85" />
      <line x1="247" y1="340" x2="247" y2="370" strokeWidth="2.5" strokeLinecap="round" stroke={WL} strokeOpacity="0.5" />
      <line x1="250" y1="368" x2="440" y2="368" strokeWidth="12" strokeLinecap="round" stroke={WD} strokeOpacity="0.35" />
      <line x1="250" y1="368" x2="440" y2="368" strokeWidth="10" strokeLinecap="round" stroke={W}  strokeOpacity="0.85" />
      <line x1="250" y1="365" x2="440" y2="365" strokeWidth="2.5" strokeLinecap="round" stroke={WL} strokeOpacity="0.5" />
      <polyline points="412,361 430,368 412,375" strokeWidth="2" strokeLinejoin="round" stroke={WL} fill="none" />

      {/* ── Pump symbol ───────────────────────────────────────────────── */}
      <circle cx="463" cy="368" r="23" strokeWidth="3" fill={PNL} stroke={BD} />
      <circle cx="463" cy="368" r="17" strokeWidth="0.8" fill="none" stroke={BD} strokeOpacity="0.35" />
      <line x1="463" y1="351" x2="463" y2="385" strokeWidth="2.5" stroke={BD} strokeOpacity="0.7" />
      <line x1="446" y1="368" x2="480" y2="368" strokeWidth="2.5" stroke={BD} strokeOpacity="0.7" />
      <line x1="463" y1="345" x2="463" y2="330" strokeWidth="10" strokeLinecap="round" stroke={W}  strokeOpacity="0.85" />
      <line x1="460" y1="345" x2="460" y2="330" strokeWidth="2"  strokeLinecap="round" stroke={WL} strokeOpacity="0.5" />

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="30" y="82"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        INLET
      </text>
      <text x="267" y="50" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.08em' }}>
        STORAGE TANK
      </text>
      <text x="320" y="355"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        OUTLET
      </text>
      <text x="463" y="321" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif' }}>
        PUMP
      </text>
    </svg>
  );
}