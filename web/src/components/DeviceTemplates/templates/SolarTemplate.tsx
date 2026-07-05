'use client';
import React, { useId } from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  DashFlow, WaveLevel, Blink,
  useMaterials, AOShadow, GlassFace, MetalBody,
  resolveNumeric, IRRADIANCE_KEYS, POWER_KEYS, LEVEL_KEYS,
} from '../primitives';

const SUN  = '#fbbf24';
const BATT = '#34d399';
const BD   = 'var(--color-border)';
const MUT  = 'var(--color-text-muted)';

/** Display slots — inverter glass face + battery charge window */
export const slots = {
  ac:      { x: 250, y: 198, width: 60, fontSize: 12, glow: SUN },
  battery: { x: 79,  y: 305, width: 58, fontSize: 10, glow: BATT },
} as const;
const LBL: React.CSSProperties = { fontSize: 6.5, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.12em', fill: MUT };

export function SolarTemplate({ width, height, telemetry, deviceStatus }: TemplateProps) {
  const paused = deviceStatus === 'offline';
  const m = useMaterials();
  const clipId = `sv-glint-${useId().replace(/:/g, '')}`;

  const irradiance = resolveNumeric(telemetry, IRRADIANCE_KEYS);
  const power      = resolveNumeric(telemetry, POWER_KEYS);
  const battery    = resolveNumeric(telemetry, LEVEL_KEYS);
  const irrIntensity = Math.min(irradiance / 1000, 1);
  // ponytail: unit heuristic — power > 200 treated as watts (5 kW cap), else kW (10 kW cap)
  const pvIntensity  = Math.min(power / (power > 200 ? 5000 : 10), 1);
  const battLevel    = Math.max(0, Math.min(battery / 100, 1));
  const genIntensity = Math.max(pvIntensity, irrIntensity);
  const generating   = genIntensity > 0.05 && !paused;

  return (
    <g>
      {m.defs}

      {/* ── Ground shadows ────────────────────────────────────────────── */}
      <AOShadow cx={112} cy={226} rx={72} ry={5} soft={m.soft} opacity={0.2} />
      <AOShadow cx={250} cy={254} rx={48} soft={m.soft} />
      <AOShadow cx={100} cy={334} rx={70} ry={5} soft={m.soft} />
      <AOShadow cx={468} cy={236} rx={22} ry={4} soft={m.soft} opacity={0.2} />

      {/* ── Sun — glow tracks irradiance ──────────────────────────────── */}
      <circle cx={36} cy={58} r={19} fill={SUN} fillOpacity={0.1 + irrIntensity * 0.4} filter={m.soft} />
      <circle cx={36} cy={58} r={10} fill={SUN} fillOpacity={0.3 + irrIntensity * 0.7} />
      <circle cx={33} cy={55} r={3.2} fill="#fff" fillOpacity={0.4} />

      {/* ── Energy conduits (under the bodies) ────────────────────────── */}
      {/* DC: array → inverter */}
      <DashFlow x1={182} y1={164} x2={230} y2={182} intensity={genIntensity} paused={paused}
        color={SUN} shadowColor="#78350f" highlightColor="#fde68a" strokeWidth={6} />
      {/* DC: battery ↔ inverter */}
      <DashFlow x1={152} y1={292} x2={214} y2={244} intensity={genIntensity} paused={paused}
        color={SUN} shadowColor="#78350f" highlightColor="#fde68a" strokeWidth={5} />
      {/* AC: inverter → grid (anchor 350,200 → 470,200) */}
      <DashFlow x1={293} y1={200} x2={466} y2={200} intensity={pvIntensity} paused={paused}
        color={SUN} shadowColor="#78350f" highlightColor="#fde68a" strokeWidth={7} />

      {/* ── PV array — tilted, framed glass with cell grid + glint ────── */}
      {/* mount braces + ground rail */}
      <line x1={58} y1={176} x2={48} y2={222} stroke={BD} strokeWidth={4} strokeLinecap="round" />
      <line x1={164} y1={166} x2={176} y2={222} stroke={BD} strokeWidth={4} strokeLinecap="round" />
      <line x1={38} y1={222} x2={186} y2={222} stroke={BD} strokeWidth={4} strokeLinecap="round" />
      <g transform="rotate(-6 108 132)">
        <MetalBody x={26} y={92} width={164} height={84} rx={5} m={m} />
        <GlassFace x={31} y={97} width={154} height={74} rx={3} m={m} />
        {/* cell grid */}
        {[1, 2, 3, 4].map(i => (
          <line key={`v${i}`} x1={31 + i * 30.8} y1={98} x2={31 + i * 30.8} y2={170}
            stroke="#64748b" strokeOpacity={0.35} strokeWidth={1} />
        ))}
        {[1, 2].map(j => (
          <line key={`h${j}`} x1={32} y1={97 + j * 24.7} x2={184} y2={97 + j * 24.7}
            stroke="#64748b" strokeOpacity={0.35} strokeWidth={1} />
        ))}
        {/* corner frame bolts */}
        {[[31, 97], [185, 97], [31, 171], [185, 171]].map(([bx, by]) => (
          <circle key={`${bx}-${by}`} cx={bx} cy={by} r={1.6} fill={BD} />
        ))}
        {/* sun-glint sweep — diagonal highlight when generating */}
        {generating && (
          <g clipPath={`url(#${clipId})`}>
            <rect y={50} width={26} height={170} fill="#ffffff"
              fillOpacity={0.06 + irrIntensity * 0.12} transform="rotate(18 108 132)">
              <animate attributeName="x" values="-30;220" dur="4.8s" repeatCount="indefinite" />
            </rect>
          </g>
        )}
        <clipPath id={clipId}><rect x={31} y={97} width={154} height={74} rx={3} /></clipPath>
      </g>

      {/* ── Inverter cabinet ──────────────────────────────────────────── */}
      <MetalBody x={205} y={152} width={90} height={98} rx={8} m={m} />
      <text x={250} y={172} textAnchor="middle" style={LBL}>GITO SV-500</text>
      <GlassFace x={215} y={182} width={70} height={36} rx={4} m={m} />
      {/* face ticks (chip lands mid-face; ticks along lower edge stay visible) */}
      {[0, 1, 2, 3, 4].map(i => (
        <line key={i} x1={224 + i * 13} y1={211} x2={224 + i * 13} y2={214}
          stroke="#94a3b8" strokeOpacity={0.7} strokeWidth={1} />
      ))}
      {/* vent slots + status LED */}
      {[218, 228, 238, 248, 258].map(x => (
        <line key={x} x1={x} y1={232} x2={x} y2={242} stroke={BD} strokeWidth={2} strokeLinecap="round" />
      ))}
      <Blink cx={278} cy={237} r={4} intensity={genIntensity} paused={paused} color={BATT} />
      {/* mounting bolts */}
      <circle cx={212} cy={159} r={1.8} fill={BD} />
      <circle cx={288} cy={159} r={1.8} fill={BD} />

      {/* ── Battery bank — charge window (green) ──────────────────────── */}
      <rect x={42} y={274} width={11} height={8} rx={1.5} fill="#ef4444" />
      <rect x={147} y={274} width={11} height={8} rx={1.5} fill="#3b82f6" />
      <MetalBody x={30} y={280} width={140} height={54} rx={6} m={m} />
      <GlassFace x={40} y={288} width={78} height={30} rx={3} m={m} />
      <WaveLevel containerX={42} containerY={290} containerWidth={74} containerHeight={26}
        intensity={battLevel} paused={paused} color={BATT} highlightColor="#a7f3d0"
        rippleIntensity={genIntensity} />
      <text x={144} y={300} textAnchor="middle" style={LBL}>BS-48</text>
      {/* vent slots on right cell */}
      {[132, 140, 148, 156].map(x => (
        <line key={x} x1={x} y1={306} x2={x} y2={314} stroke={BD} strokeWidth={1.5} strokeLinecap="round" />
      ))}

      {/* ── Grid pylon (right edge) ───────────────────────────────────── */}
      <line x1={466} y1={110} x2={466} y2={234} stroke={BD} strokeWidth={5} strokeLinecap="round" />
      <line x1={448} y1={122} x2={484} y2={122} stroke={BD} strokeWidth={3} strokeLinecap="round" />
      <line x1={452} y1={146} x2={480} y2={146} stroke={BD} strokeWidth={3} strokeLinecap="round" />
      <line x1={456} y1={234} x2={476} y2={234} stroke={BD} strokeWidth={4} strokeLinecap="round" />
      {[[450, 122], [482, 122], [466, 146]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={2.2} fill={BD} />
      ))}
      <text x={466} y={100} textAnchor="middle" style={LBL}>GRID</text>
    </g>
  );
}
