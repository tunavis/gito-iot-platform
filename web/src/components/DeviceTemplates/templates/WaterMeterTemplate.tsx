'use client';
import React from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  ArcSweep, Blink, DashFlow, GlassFace, MetalBody, AOShadow,
  useMaterials, resolveNumeric, FLOW_KEYS,
} from '../primitives';

const ACCENT = '#38bdf8';
const GAUGE_CX = 250;
const GAUGE_CY = 192;

/** Display slots — regions of the artwork designed to show live values */
export const slots = {
  /** digital inset on the gauge face, between arc and pivot */
  flow:     { x: 250, y: 178, width: 64, fontSize: 11, glow: ACCENT },
  /** odometer register strip — like a real meter's totalizer */
  register: { x: 250, y: 233, width: 84, fontSize: 12 },
} as const;

/** Point on the gauge face at angle deg (0 = up) and radius r */
function tickPoint(deg: number, r: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [GAUGE_CX + r * Math.sin(rad), GAUGE_CY - r * Math.cos(rad)];
}

const TICK_ANGLES = [-90, -60, -30, 0, 30, 60, 90];
const BOLTS: Array<[number, number]> = [[176, 186], [176, 214], [324, 186], [324, 214]];

/**
 * Inline utility flow meter — horizontal pipe (DashFlow) passing through a
 * bolted meter housing. Glass gauge face + odometer register under glass.
 */
export function WaterMeterTemplate({ telemetry, deviceStatus }: TemplateProps) {
  const m = useMaterials();
  const paused = deviceStatus === 'offline';
  const flow = resolveNumeric(telemetry, FLOW_KEYS);
  const flowIntensity = Math.min(flow / 100, 1);

  return (
    <g>
      {m.defs}

      {/* ── Ground shadow ─────────────────────────────────────────────── */}
      <AOShadow cx={250} cy={285} rx={165} ry={6} soft={m.soft} opacity={0.22} />

      {/* ── Sensor taps (pressure left, temperature right) ────────────── */}
      {[127, 367].map((x) => (
        <g key={x}>
          <rect x={x} y={176} width={6} height={22} rx={1.5}
            style={{ fill: 'var(--color-panel)', stroke: 'var(--color-border)' }} strokeWidth="1" />
          <rect x={x - 3} y={173} width={12} height={6} rx={1.5}
            style={{ fill: 'var(--color-panel)', stroke: 'var(--color-border)' }} strokeWidth="1" />
        </g>
      ))}

      {/* ── Through-pipe: DashFlow IS the pipe (30,200) → (470,200) ───── */}
      <DashFlow x1={30} y1={200} x2={470} y2={200} intensity={flowIntensity} paused={paused}
        color={ACCENT} shadowColor="#0b1220" highlightColor="#bae6fd" strokeWidth={11} />

      {/* Direction chevrons above the pipe */}
      {[92, 396].map((x) => (
        <polyline key={x} points={`${x},178 ${x + 10},183 ${x},188`}
          fill="none" stroke="#bae6fd" strokeWidth="2" strokeLinejoin="round" strokeOpacity="0.6" />
      ))}

      {/* ── Bolted flanges at both pipe joints ────────────────────────── */}
      <MetalBody x={168} y={178} width={16} height={44} rx={3} m={m} />
      <MetalBody x={316} y={178} width={16} height={44} rx={3} m={m} />
      {BOLTS.map(([bx, by]) => (
        <g key={`${bx}-${by}`}>
          <circle cx={bx} cy={by} r={1.9} fill="#0b1220" fillOpacity="0.65" />
          <circle cx={bx - 0.5} cy={by - 0.5} r={0.7} fill="#ffffff" fillOpacity="0.4" />
        </g>
      ))}

      {/* ── Mounting feet + meter housing ─────────────────────────────── */}
      <rect x={198} y={276} width={18} height={9} rx={2} fill="#0b1220" fillOpacity="0.5" />
      <rect x={284} y={276} width={18} height={9} rx={2} fill="#0b1220" fillOpacity="0.5" />
      <MetalBody x={186} y={112} width={128} height={166} rx={10} m={m} />

      {/* Status LED */}
      <Blink cx={301} cy={124} r={2.8} intensity={flowIntensity} paused={paused} color={ACCENT} />

      {/* ── Gauge face: dark glass, ticks, needle gauge ───────────────── */}
      <GlassFace x={200} y={136} width={100} height={62} rx={6} m={m} />
      {TICK_ANGLES.map((a) => {
        const major = a % 90 === 0;
        const [x1, y1] = tickPoint(a, major ? 29 : 30);
        const [x2, y2] = tickPoint(a, major ? 35 : 34);
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={major ? '#e2e8f0' : '#94a3b8'}
          strokeWidth={major ? 1.6 : 1} strokeOpacity={major ? 0.85 : 0.6} />;
      })}
      <ArcSweep cx={GAUGE_CX} cy={GAUGE_CY} r={26} intensity={flowIntensity} paused={paused}
        color={ACCENT} sweep={180} startAngle={-90} strokeWidth={3.5} />

      {/* ── Etched model label ────────────────────────────────────────── */}
      <text x={250} y={210} textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 8, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.14em' }}>
        GITO WM-200
      </text>

      {/* ── Mechanical register: odometer digit drums under glass ─────── */}
      <GlassFace x={204} y={216} width={92} height={28} rx={4} m={m} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={210 + i * 14} y={222} width={11} height={16} rx={1.5}
          fill="#ffffff" fillOpacity="0.05"
          stroke={i === 5 ? ACCENT : '#475569'} strokeWidth="1"
          strokeOpacity={i === 5 ? 0.75 : 0.8} />
      ))}

      {/* Vent slots — lower housing face */}
      {[0, 1, 2].map((i) => (
        <line key={i} x1={200 + i * 7} y1={256} x2={200 + i * 7} y2={268}
          stroke="#000000" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" />
      ))}
    </g>
  );
}
