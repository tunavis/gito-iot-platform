'use client';
import React from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  WaveLevel, DashFlow, ArcSweep, Blink,
  useMaterials, AOShadow, MetalBody,
  resolveNumeric, LEVEL_KEYS, FLOW_KEYS, PRESSURE_KEYS,
} from '../primitives';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
const ACC = '#38bdf8';  // sky accent — active elements
const LIQ = '#0ea5e9';  // liquid
const HI  = '#bae6fd';  // specular highlight

/** Display slots — level % reads large on the tank shell, like painted markings */
export const slots = {
  level: { x: 267, y: 218, width: 110, fontSize: 24, glow: ACC },
} as const;

export function WaterTankTemplate({ width, height, telemetry, deviceStatus }: TemplateProps) {
  const paused = deviceStatus === 'offline';
  const m = useMaterials();

  const levelRaw = resolveNumeric(telemetry, LEVEL_KEYS);
  const levelIntensity = Math.min(levelRaw / 100, 1);
  const flow = resolveNumeric(telemetry, FLOW_KEYS);
  const flowIntensity = Math.min(flow / 100, 1);
  // ponytail: assumes 0-10 bar span; widen if a site reports kPa/psi
  const pressure = resolveNumeric(telemetry, PRESSURE_KEYS);
  const pressureIntensity = Math.min(pressure / 10, 1);

  // Sight glass echoes the tank level over its own bore
  const sgTop = 124, sgBot = 328;
  const sgLiquidH = (sgBot - sgTop) * Math.max(0, Math.min(1, levelIntensity));

  return (
    <g>
      {m.defs}

      {/* ── Ground shadows ─────────────────────────────────────────────── */}
      <AOShadow cx={267} cy={371} rx={100} ry={6} soft={m.soft} />
      <AOShadow cx={463} cy={376} rx={26} ry={4} soft={m.soft} opacity={0.2} />

      {/* ── Legs + feet ────────────────────────────────────────────────── */}
      <MetalBody x={203} y={330} width={13} height={34} rx={2} m={m} />
      <MetalBody x={318} y={330} width={13} height={34} rx={2} m={m} />
      <rect x={197} y={364} width={25} height={5} rx={2} fill={PNL} stroke={BD} strokeWidth={1.2} />
      <rect x={312} y={364} width={25} height={5} rx={2} fill={PNL} stroke={BD} strokeWidth={1.2} />

      {/* ── Tank shell ─────────────────────────────────────────────────── */}
      <MetalBody x={182} y={84} width={170} height={258} rx={10} m={m} />

      {/* Liquid — driven by level telemetry (level chip lands at 267,200) */}
      <WaveLevel
        containerX={186} containerY={96} containerWidth={162} containerHeight={242}
        intensity={levelIntensity} paused={paused}
        color={LIQ} highlightColor="#7dd3fc"
      />
      {/* Cylindrical shading re-applied over the liquid */}
      <rect x={182} y={84} width={170} height={258} rx={10} fill={m.metalV} fillOpacity={0.5} pointerEvents="none" />
      <rect x={188} y={96} width={7} height={240} rx={3} fill="#ffffff" fillOpacity={0.05} />
      <rect x={338} y={96} width={12} height={240} fill="#000000" fillOpacity={0.1} />

      {/* Etched level marks 25/50/75 on right shell edge */}
      {([156.5, 217, 277.5] as const).map((y, i) => (
        <g key={y}>
          <line x1={342} y1={y} x2={350} y2={y} stroke="#e2e8f0" strokeOpacity={0.5} strokeWidth={1.2} />
          <text x={339} y={y + 3} textAnchor="end"
            style={{ fill: '#e2e8f0', fillOpacity: 0.5, fontSize: 8, fontFamily: 'system-ui,sans-serif' }}>
            {['75', '50', '25'][i]}
          </text>
        </g>
      ))}

      {/* Etched model label */}
      <text x={267} y={330} textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 9, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.14em' }}>
        GITO WT-500
      </text>

      {/* ── Top rim + vent cap ─────────────────────────────────────────── */}
      <ellipse cx={267} cy={84} rx={85} ry={12} fill={PNL} />
      <ellipse cx={267} cy={84} rx={85} ry={12} fill={m.metalV} />
      <ellipse cx={267} cy={84} rx={85} ry={12} fill="none" stroke={BD} strokeWidth={1.5} />
      <ellipse cx={267} cy={83} rx={72} ry={8.5} fill="none" stroke="#ffffff" strokeOpacity={0.1} strokeWidth={1} />
      <MetalBody x={255} y={56} width={24} height={18} rx={3} m={m} />
      <line x1={259} y1={62} x2={275} y2={62} stroke={BD} strokeWidth={1} />
      <line x1={259} y1={66} x2={275} y2={66} stroke={BD} strokeWidth={1} />

      {/* ── Inlet pipe (top-left) — DashFlow IS the pipe ───────────────── */}
      <DashFlow x1={30} y1={95} x2={182} y2={95} intensity={flowIntensity} paused={paused}
        color={LIQ} shadowColor="#082f49" highlightColor={HI} strokeWidth={10} />
      {/* Bolted flange where the inlet meets the shell */}
      <rect x={176} y={83} width={12} height={24} rx={2} fill={PNL} stroke={BD} strokeWidth={1.5} />
      <circle cx={182} cy={87.5} r={1.4} fill={BD} />
      <circle cx={182} cy={102.5} r={1.4} fill={BD} />

      {/* ── Sight glass (left side, echoes level) ──────────────────────── */}
      <rect x={176} y={127} width={8} height={6} fill={PNL} stroke={BD} strokeWidth={1} />
      <rect x={176} y={319} width={8} height={6} fill={PNL} stroke={BD} strokeWidth={1} />
      <rect x={166} y={120} width={12} height={212} rx={5} fill={m.glass} stroke={BD} strokeWidth={1.2} />
      {sgLiquidH > 2 && (
        <rect x={168.5} y={sgBot - sgLiquidH} width={7} height={sgLiquidH} rx={3} fill={LIQ} fillOpacity={0.85} />
      )}
      <rect x={168} y={124} width={2} height={204} rx={1} fill="#ffffff" fillOpacity={0.18} />

      {/* ── Outlet (base → right), flanged at the shell ────────────────── */}
      <DashFlow x1={250} y1={338} x2={250} y2={356} intensity={flowIntensity} paused={paused}
        color={LIQ} shadowColor="#082f49" highlightColor={HI} strokeWidth={10} />
      <rect x={241} y={340} width={18} height={7} rx={2} fill={PNL} stroke={BD} strokeWidth={1.2} />
      <DashFlow x1={250} y1={358} x2={435} y2={358} intensity={flowIntensity} paused={paused}
        color={LIQ} shadowColor="#082f49" highlightColor={HI} strokeWidth={10} />

      {/* ── Pump at outlet end (status chip lands at 463,358) ──────────── */}
      <circle cx={463} cy={358} r={21} fill={PNL} />
      <circle cx={463} cy={358} r={21} fill={m.metalV} />
      <circle cx={463} cy={358} r={21} fill="none" stroke={BD} strokeWidth={1.5} />
      <circle cx={463} cy={358} r={14} fill="none" stroke={BD} strokeOpacity={0.4} strokeWidth={1} />
      <Blink cx={463} cy={340} r={3.2} intensity={flowIntensity} paused={paused} color={ACC} />

      {/* ── Pressure gauge, shell-mounted upper right (chip at 390,130) ── */}
      <MetalBody x={348} y={136} width={20} height={12} rx={2} m={m} horizontal />
      <circle cx={390} cy={142} r={30} fill={PNL} />
      <circle cx={390} cy={142} r={30} fill={m.metalV} />
      <circle cx={390} cy={142} r={30} fill="none" stroke={BD} strokeWidth={1.5} />
      <circle cx={390} cy={142} r={24} fill={m.glass} />
      <circle cx={390} cy={142} r={24} fill={m.sheen} />
      <circle cx={390} cy={142} r={24} fill="none" stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />
      <ArcSweep cx={390} cy={142} r={17} intensity={pressureIntensity} paused={paused}
        color={ACC} sweep={240} startAngle={150} strokeWidth={3} />
      <text x={390} y={161} textAnchor="middle"
        style={{ fill: '#94a3b8', fontSize: 6, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.1em' }}>
        BAR
      </text>
    </g>
  );
}
