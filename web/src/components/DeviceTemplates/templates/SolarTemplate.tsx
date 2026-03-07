import React from 'react';

const B = { stroke: 'var(--color-border)', fill: 'none' } as const;
const P = { fill: 'var(--color-panel)',    stroke: 'var(--color-border)' } as const;

export function SolarTemplate({ width, height }: { width: number; height: number }) {
  // Panel grid: 3 columns × 4 rows
  const PANEL_COLS  = 3;
  const PANEL_ROWS  = 4;
  const CELL_W      = 40;
  const CELL_H      = 28;
  const PANEL_GAP   = 4;
  const ORIGIN_X    = 28;
  const ORIGIN_Y    = 48;

  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Solar panel array ─────────────────────────────────── */}
      {Array.from({ length: PANEL_ROWS }, (_, row) =>
        Array.from({ length: PANEL_COLS }, (_, col) => {
          const x = ORIGIN_X + col * (CELL_W + PANEL_GAP);
          const y = ORIGIN_Y + row * (CELL_H + PANEL_GAP);
          return (
            <g key={`${row}-${col}`}>
              <rect x={x} y={y} width={CELL_W} height={CELL_H} rx="2" strokeWidth="1.5"
                style={{ fill: 'var(--color-panel)', stroke: 'var(--color-border)' }} />
              {/* Cell grid lines */}
              <line x1={x + CELL_W / 2} y1={y} x2={x + CELL_W / 2} y2={y + CELL_H} strokeWidth="0.7"
                style={{ stroke: 'var(--color-border)', opacity: 0.5 }} />
              <line x1={x} y1={y + CELL_H / 2} x2={x + CELL_W} y2={y + CELL_H / 2} strokeWidth="0.7"
                style={{ stroke: 'var(--color-border)', opacity: 0.5 }} />
            </g>
          );
        })
      )}

      {/* Panel frame border */}
      <rect x="24" y="44"
        width={PANEL_COLS * CELL_W + (PANEL_COLS - 1) * PANEL_GAP + 8}
        height={PANEL_ROWS * CELL_H + (PANEL_ROWS - 1) * PANEL_GAP + 8}
        rx="4" strokeWidth="2.5" fill="none" style={{ stroke: 'var(--color-border)' }} />

      {/* Panel tilt stand */}
      <line x1="36"  y1="204" x2="28"  y2="220" strokeWidth="3" strokeLinecap="round" {...B} />
      <line x1="148" y1="204" x2="156" y2="220" strokeWidth="3" strokeLinecap="round" {...B} />
      <line x1="22"  y1="220" x2="162" y2="220" strokeWidth="3" strokeLinecap="round" {...B} />

      {/* ── DC cable from panels to inverter ─────────────────── */}
      <path d="M160,125 Q220,125 220,160" strokeWidth="3" strokeLinecap="round" strokeDasharray="6,3"
        style={{ stroke: '#f59e0b', opacity: 0.7 }} fill="none" />

      {/* ── Inverter box ─────────────────────────────────────── */}
      <rect x="200" y="155" width="110" height="90" rx="8" strokeWidth="3" {...P} />
      {/* Inverter display */}
      <rect x="215" y="170" width="80" height="40" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: 'var(--color-border)' }} />
      {/* Status LED */}
      <circle cx="266" cy="220" r="5" style={{ fill: '#22c55e', opacity: 0.9 }} />
      {/* Heat sink fins (bottom) */}
      {[210, 225, 240, 255, 270, 285, 300].map((x) => (
        <line key={x} x1={x} y1="245" x2={x} y2="258" strokeWidth="2" strokeLinecap="round" {...B} />
      ))}

      {/* ── AC cable from inverter to grid ───────────────────── */}
      <path d="M310,200 Q360,200 360,200" strokeWidth="4" strokeLinecap="round"
        style={{ stroke: 'var(--color-border)' }} fill="none" />

      {/* ── Grid connection ───────────────────────────────────── */}
      <rect x="360" y="155" width="80" height="90" rx="8" strokeWidth="2.5" {...P} />
      {/* Utility pole symbol */}
      <line x1="400" y1="160" x2="400" y2="245" strokeWidth="3" style={{ stroke: 'var(--color-border)' }} />
      <line x1="375" y1="175" x2="425" y2="175" strokeWidth="2.5" style={{ stroke: 'var(--color-border)' }} />
      <line x1="378" y1="188" x2="422" y2="188" strokeWidth="2.5" style={{ stroke: 'var(--color-border)' }} />
      {/* Insulators */}
      {[375, 425].map((x) => (
        <circle key={x} cx={x} cy="175" r="4" strokeWidth="1.5" {...P} />
      ))}

      {/* ── Battery bank ─────────────────────────────────────── */}
      <rect x="32" y="248" width="128" height="60" rx="6" strokeWidth="2.5" {...P} />
      {/* Battery cells */}
      {[48, 80, 112, 144].map((x) => (
        <rect key={x} x={x} y="258" width="22" height="40" rx="3" strokeWidth="1.5" {...P} />
      ))}
      {/* Battery terminals */}
      <rect x="42"  y="250" width="10" height="6" rx="1" strokeWidth="1" style={{ fill: '#ef4444' }} />
      <rect x="148" y="250" width="10" height="6" rx="1" strokeWidth="1" style={{ fill: '#3b82f6' }} />

      {/* DC cable battery → inverter */}
      <path d="M160,278 Q200,278 200,200" strokeWidth="3" strokeDasharray="6,3"
        style={{ stroke: '#f59e0b', opacity: 0.6 }} fill="none" />

      {/* ── Labels ────────────────────────────────────────────── */}
      <text x="92"  y="38"  textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>PV ARRAY</text>
      <text x="255" y="148" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>INVERTER</text>
      <text x="400" y="148" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>GRID</text>
      <text x="96"  y="325" textAnchor="middle" style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif' }}>BATTERY</text>
    </svg>
  );
}
