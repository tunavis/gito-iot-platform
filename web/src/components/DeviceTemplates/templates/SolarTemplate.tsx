import React from 'react';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
// PV panel — dark navy (real solar panel color)
const PV_FILL   = '#0f2a4a';
const PV_CELL   = '#1a3f6f';
const PV_BORDER = '#2563eb';
// DC cables — amber (energy effect color)
const DC = '#f59e0b';
// AC cable — yellow/gold
const AC = '#eab308';

export function SolarTemplate({ width, height }: { width: number; height: number; telemetry?: Record<string, number | string | null> }) {
  const PANEL_COLS = 3;
  const PANEL_ROWS = 4;
  const CELL_W     = 40;
  const CELL_H     = 28;
  const PANEL_GAP  = 4;
  const ORIGIN_X   = 28;
  const ORIGIN_Y   = 48;

  return (
    <g>

      {/* ── Solar panel array ─────────────────────────────────────────── */}
      {Array.from({ length: PANEL_ROWS }, (_, row) =>
        Array.from({ length: PANEL_COLS }, (_, col) => {
          const x = ORIGIN_X + col * (CELL_W + PANEL_GAP);
          const y = ORIGIN_Y + row * (CELL_H + PANEL_GAP);
          return (
            <g key={`${row}-${col}`}>
              <rect x={x} y={y} width={CELL_W} height={CELL_H} rx="2" strokeWidth="1.5"
                fill={PV_FILL} stroke={PV_BORDER} strokeOpacity="0.5" />
              <line x1={x + CELL_W / 2} y1={y} x2={x + CELL_W / 2} y2={y + CELL_H}
                strokeWidth="0.7" stroke={PV_CELL} strokeOpacity="0.8" />
              <line x1={x} y1={y + CELL_H / 2} x2={x + CELL_W} y2={y + CELL_H / 2}
                strokeWidth="0.7" stroke={PV_CELL} strokeOpacity="0.8" />
              <circle cx={x + 6} cy={y + 6} r="2" fill="white" fillOpacity="0.08" />
            </g>
          );
        })
      )}
      {/* Panel array border */}
      <rect x="24" y="44"
        width={PANEL_COLS * CELL_W + (PANEL_COLS - 1) * PANEL_GAP + 8}
        height={PANEL_ROWS * CELL_H + (PANEL_ROWS - 1) * PANEL_GAP + 8}
        rx="4" strokeWidth="2.5" fill="none" stroke={PV_BORDER} strokeOpacity="0.7" />

      {/* Panel tilt stand */}
      <line x1="36"  y1="204" x2="28"  y2="220" strokeWidth="3" strokeLinecap="round" stroke={BD} />
      <line x1="148" y1="204" x2="156" y2="220" strokeWidth="3" strokeLinecap="round" stroke={BD} />
      <line x1="22"  y1="220" x2="162" y2="220" strokeWidth="3" strokeLinecap="round" stroke={BD} />

      {/* ── DC cable — panel array → inverter ─────────────────────────── */}
      <path d="M160,125 Q220,125 220,160" strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray="6,3" stroke={DC} strokeOpacity="0.85" fill="none" />
      <text x="188" y="118"
        style={{ fill: DC, fontSize: 8, fontFamily: 'system-ui,sans-serif', opacity: 0.8 }}>
        DC
      </text>

      {/* ── Inverter box ──────────────────────────────────────────────── */}
      <rect x="200" y="155" width="110" height="90" rx="8" strokeWidth="3" fill={PNL} stroke={BD} />
      <rect x="205" y="159" width="4" height="82" rx="2" fill="white" fillOpacity="0.06" />
      <rect x="215" y="170" width="80" height="40" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: BD }} />
      {/* Status LED */}
      <circle cx="267" cy="221" r="5.5" fill="#22c55e" fillOpacity="0.9" />
      <circle cx="267" cy="221" r="2.5" fill="white" fillOpacity="0.5" />
      {/* Heat sink fins */}
      {[212, 227, 242, 257, 272, 287, 302].map((x) => (
        <line key={x} x1={x} y1="245" x2={x} y2="258" strokeWidth="2" strokeLinecap="round" stroke={BD} />
      ))}

      {/* ── AC cable — inverter → grid ────────────────────────────────── */}
      <line x1="310" y1="200" x2="360" y2="200" strokeWidth="4.5" strokeLinecap="round"
        stroke={AC} strokeOpacity="0.85" />
      <line x1="310" y1="197" x2="360" y2="197" strokeWidth="1.5" strokeLinecap="round"
        stroke="white" strokeOpacity="0.3" />
      <text x="326" y="193"
        style={{ fill: AC, fontSize: 8, fontFamily: 'system-ui,sans-serif', opacity: 0.85 }}>
        AC
      </text>

      {/* ── Grid connection box ───────────────────────────────────────── */}
      <rect x="360" y="155" width="80" height="90" rx="8" strokeWidth="2.5" fill={PNL} stroke={BD} />
      <line x1="400" y1="162" x2="400" y2="242" strokeWidth="3" stroke={BD} strokeOpacity="0.6" />
      <line x1="375" y1="177" x2="425" y2="177" strokeWidth="2.5" stroke={BD} strokeOpacity="0.6" />
      <line x1="378" y1="190" x2="422" y2="190" strokeWidth="2.5" stroke={BD} strokeOpacity="0.6" />
      {[375, 425].map((x) => (
        <circle key={x} cx={x} cy="177" r="4.5" strokeWidth="1.5" fill={PNL} stroke={BD} />
      ))}

      {/* ── Battery bank ──────────────────────────────────────────────── */}
      <rect x="32" y="248" width="128" height="60" rx="6" strokeWidth="2.5" fill={PNL} stroke={BD} />
      {[48, 80, 112, 144].map((x) => (
        <rect key={x} x={x} y="258" width="22" height="40" rx="3" strokeWidth="1.5" fill={PNL} stroke={BD} />
      ))}
      <rect x="42"  y="249" width="10" height="7" rx="1.5" fill="#ef4444" />
      <rect x="148" y="249" width="10" height="7" rx="1.5" fill="#3b82f6" />

      {/* DC cable — battery → inverter */}
      <path d="M160,278 Q200,278 200,200" strokeWidth="3" strokeDasharray="6,3"
        stroke={DC} strokeOpacity="0.65" fill="none" />

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="92" y="38" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        PV ARRAY
      </text>
      <text x="255" y="148" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        INVERTER
      </text>
      <text x="400" y="148" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        GRID
      </text>
      <text x="96" y="322" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        BATTERY
      </text>
    </g>
  );
}