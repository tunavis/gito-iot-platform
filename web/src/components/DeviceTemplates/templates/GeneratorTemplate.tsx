'use client';
import React from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  ArcSweep, WaveLevel, Blink, HeatGradient,
  useMaterials, AOShadow, GlassFace, MetalBody,
  resolveNumeric, POWER_KEYS, LEVEL_KEYS,
} from '../primitives';

const BD = 'var(--color-border)';
const PNL = 'var(--color-panel)';
const MUT = 'var(--color-text-muted)';
const E = '#f59e0b'; // amber accent — electrical/fuel

/** Display slots — the control panel glass (192-308 × 150-262) is the readout */
export const slots = {
  load:      { x: 250, y: 200, width: 88, fontSize: 19, glow: E },
  voltage:   { x: 212, y: 256, width: 34, fontSize: 8.5 },
  frequency: { x: 288, y: 256, width: 34, fontSize: 8.5 },
  fuel:      { x: 429, y: 274, width: 36, fontSize: 9 },
} as const;

export function GeneratorTemplate({ width, height, telemetry, deviceStatus }: TemplateProps) {
  const m = useMaterials();
  const paused = deviceStatus === 'offline';
  const load = resolveNumeric(telemetry, POWER_KEYS);
  const loadIntensity = Math.min(load / 100, 1);
  const fuel = resolveNumeric(telemetry, LEVEL_KEYS);
  const fuelIntensity = Math.min(fuel / 100, 1);
  const running = !paused && loadIntensity > 0.02;

  return (
    <g>
      {m.defs}

      {/* ── Ground shadow ─────────────────────────────────────────────── */}
      <AOShadow cx={250} cy={306} rx={205} ry={7} soft={m.soft} />

      {/* ── Exhaust stub (top-left, behind canopy) ────────────────────── */}
      <MetalBody x={98} y={84} width={16} height={30} rx={3} m={m} />
      <rect x={94} y={79} width={24} height={7} rx={2} fill={PNL} stroke={BD} strokeWidth="1.5" />
      <rect x={94} y={79} width={24} height={7} rx={2} fill={m.metalV} />
      {/* heat shimmer — only while running */}
      {running && [103, 107, 111].map((x, i) => (
        <path key={x} d={`M${x},76 q3,-6 0,-11 q-3,-5 0,-9`}
          fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" opacity="0">
          <animate attributeName="opacity" values="0;0.45;0" dur="2.4s"
            begin={`${i * -0.8}s`} repeatCount="indefinite" />
          <animateMotion path="M0,0 L0,-8" dur="2.4s"
            begin={`${i * -0.8}s`} repeatCount="indefinite" />
        </path>
      ))}

      {/* ── Skid base with forklift slots ─────────────────────────────── */}
      <MetalBody x={60} y={284} width={390} height={20} rx={3} m={m} />
      <rect x={140} y={289} width={40} height={10} rx={2} fill="#000" fillOpacity="0.4" />
      <rect x={320} y={289} width={40} height={10} rx={2} fill="#000" fillOpacity="0.4" />

      {/* ── Canopy enclosure ──────────────────────────────────────────── */}
      <MetalBody x={72} y={110} width={376} height={174} rx={10} m={m} />
      {/* roof seam + section seams */}
      <line x1="80" y1="124" x2="440" y2="124" stroke="#000" strokeOpacity="0.15" strokeWidth="1.5" />
      <line x1="184" y1="118" x2="184" y2="278" stroke="#000" strokeOpacity="0.18" strokeWidth="1.5" />
      <line x1="352" y1="118" x2="352" y2="278" stroke="#000" strokeOpacity="0.18" strokeWidth="1.5" />
      {/* corner bolts */}
      {[[82, 120], [438, 120], [82, 274], [438, 274]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={2.4} fill={PNL} stroke={BD} strokeWidth="1" />
      ))}

      {/* ── Engine section (left): heat tint + vent louvres ───────────── */}
      <HeatGradient x={84} y={130} width={94} height={146} rx={6}
        intensity={loadIntensity} paused={paused} />
      {[142, 158, 174, 190, 206, 222, 238, 254].map((y) => (
        <g key={y}>
          <line x1="94" y1={y} x2="168" y2={y} stroke="#000" strokeOpacity="0.35"
            strokeWidth="3" strokeLinecap="round" />
          <line x1="94" y1={y + 2.5} x2="168" y2={y + 2.5} stroke="#fff" strokeOpacity="0.1"
            strokeWidth="1" strokeLinecap="round" />
        </g>
      ))}

      {/* ── Control panel (center): glass face + load gauge ───────────── */}
      <GlassFace x={192} y={150} width={116} height={112} rx={8} m={m} />
      <text x="250" y="165" textAnchor="middle"
        style={{ fill: '#94a3b8', fontSize: 8, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.14em' }}>
        kW LOAD
      </text>
      {/* gauge ticks — left / top / right */}
      <line x1="219" y1="246" x2="214" y2="246" stroke="#94a3b8" strokeWidth="1.5" />
      <line x1="250" y1="215" x2="250" y2="210" stroke="#94a3b8" strokeWidth="1.5" />
      <line x1="281" y1="246" x2="286" y2="246" stroke="#94a3b8" strokeWidth="1.5" />
      <ArcSweep cx={250} cy={246} r={26} intensity={loadIntensity} paused={paused}
        color={E} sweep={180} startAngle={270} strokeWidth={3} />
      {/* run-status LED beside panel */}
      <Blink cx={322} cy={160} r={4} intensity={running ? Math.max(0.3, loadIntensity) : 0}
        paused={paused} color={E} />

      {/* ── Fuel section (right): sight-glass with amber fuel ─────────── */}
      <text x="429" y="156" textAnchor="middle"
        style={{ fill: MUT, fontSize: 8, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.12em' }}>
        FUEL
      </text>
      <GlassFace x={410} y={164} width={38} height={94} rx={5} m={m} />
      <WaveLevel containerX={413} containerY={167} containerWidth={32} containerHeight={88}
        intensity={fuelIntensity} paused={paused} color={E} highlightColor="#fbbf24" />
      {/* sight-glass graduations */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="413" y1={167 + 88 * f} x2="419" y2={167 + 88 * f}
          stroke="#e2e8f0" strokeOpacity="0.5" strokeWidth="1" />
      ))}

      {/* ── Etched model label ────────────────────────────────────────── */}
      <text x="250" y="277" textAnchor="middle"
        style={{ fill: MUT, fontSize: 9, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.18em', opacity: 0.8 }}>
        GITO GN-450
      </text>
    </g>
  );
}
