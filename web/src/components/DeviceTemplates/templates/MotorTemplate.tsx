'use client';
import React from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  Spinner, ArcSweep, Blink, HeatGradient,
  useMaterials, AOShadow, GlassFace, MetalBody,
  resolveNumeric, RPM_KEYS, TEMP_KEYS, CURRENT_KEYS, VIBRATION_KEYS,
} from '../primitives';

const BD = 'var(--color-border)';
const PNL = 'var(--color-panel)';
const ACCENT = '#a78bfa'; // violet — electric drive

/** Display slots — glass readouts on the terminal/drive box on top */
export const slots = {
  speed:   { x: 225, y: 132, width: 46, fontSize: 12, glow: ACCENT },
  current: { x: 283, y: 132, width: 40, fontSize: 12 },
} as const;

/**
 * 3-phase electric motor — finned cylindrical body between a fan cowl and a
 * drive-end bell, shaft with a spinning coupling disc (RPM), heat tint over
 * the fins (winding temp), vibration dial, and a terminal/drive box on top
 * with speed + current readouts.
 */
export function MotorTemplate({ telemetry, deviceStatus }: TemplateProps) {
  const m = useMaterials();
  const paused = deviceStatus === 'offline';
  const rpm = resolveNumeric(telemetry, RPM_KEYS);
  const temp = resolveNumeric(telemetry, ['winding_temp', 'motor_temp', ...TEMP_KEYS]);
  const amps = resolveNumeric(telemetry, CURRENT_KEYS);
  const vib = resolveNumeric(telemetry, VIBRATION_KEYS);
  const rpmIntensity = Math.min(rpm / 3000, 1);
  const tempIntensity = Math.max(0, Math.min(temp / 120, 1)); // class-F winding ≈ hot at 120°C
  const ampIntensity = Math.min(amps / 100, 1);
  const vibIntensity = Math.max(0, Math.min(vib / 10, 1));    // ISO 10816: >7 mm/s is rough
  const keyColor = paused ? '#475569' : ACCENT;
  const label = { fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' } as const;

  return (
    <g>
      {m.defs}

      {/* ── Ground shadow ─────────────────────────────────────────────── */}
      <AOShadow cx={270} cy={312} rx={160} ry={7} soft={m.soft} />

      {/* ── Base plate + feet ─────────────────────────────────────────── */}
      <MetalBody x={152} y={282} width={36} height={12} rx={2} m={m} />
      <MetalBody x={316} y={282} width={36} height={12} rx={2} m={m} />
      <MetalBody x={120} y={292} width={270} height={16} rx={3} m={m} />
      {[134, 376].map((x) => (
        <g key={x}>
          <circle cx={x} cy={300} r={3.2} fill="#0b1220" fillOpacity="0.55" />
          <circle cx={x - 0.8} cy={299.2} r={1} fill="#ffffff" fillOpacity="0.35" />
        </g>
      ))}
      <text x="255" y="303" textAnchor="middle"
        style={{ ...label, fontSize: 7.5, letterSpacing: '0.14em' }}>
        GITO EM-750
      </text>

      {/* ── Fan cowl (non-drive end) with vent louvres ────────────────── */}
      <MetalBody x={94} y={180} width={40} height={94} rx={10} m={m} />
      {[194, 206, 218, 230, 242, 254].map((y) => (
        <g key={y}>
          <line x1="102" y1={y} x2="126" y2={y} stroke="#000" strokeOpacity="0.35"
            strokeWidth="2.5" strokeLinecap="round" />
          <line x1="102" y1={y + 2} x2="126" y2={y + 2} stroke="#fff" strokeOpacity="0.1"
            strokeWidth="1" strokeLinecap="round" />
        </g>
      ))}

      {/* ── Motor body — horizontal cylinder, heat tint + cooling fins ── */}
      <MetalBody x={132} y={168} width={224} height={116} rx={16} m={m} horizontal />
      <HeatGradient x={140} y={174} width={196} height={104} rx={8}
        intensity={tempIntensity} paused={paused} />
      {Array.from({ length: 17 }, (_, i) => 148 + i * 12).map((x) => (
        <line key={x} x1={x} y1={174} x2={x} y2={278} strokeWidth="1" stroke={BD} strokeOpacity="0.45" />
      ))}

      {/* ── Vibration dial — dark instrument glass + needle (mm/s) ────── */}
      <circle cx="326" cy="208" r="17" fill={m.glass} />
      <circle cx="326" cy="208" r="17" fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="1.5" />
      <circle cx="326" cy="208" r="18" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />
      <ArcSweep cx={326} cy={208} r={12} intensity={vibIntensity} paused={paused}
        color={ACCENT} sweep={240} startAngle={150} strokeWidth={2.5} />

      {/* ── Drive-end bell + shaft + coupling disc (hero motion) ──────── */}
      <MetalBody x={356} y={182} width={24} height={88} rx={5} m={m} />
      <MetalBody x={380} y={217} width={32} height={18} rx={3} m={m} horizontal />
      <circle cx="436" cy="226" r="24" style={{ fill: PNL }} />
      <circle cx="436" cy="226" r="24" fill={m.metalV} />
      <circle cx="436" cy="226" r="24" fill="none" stroke={BD} strokeWidth="2" />
      <path d="M 419 209 A 24 24 0 0 1 436 202" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round" />
      <Spinner cx={436} cy={226} intensity={rpmIntensity} paused={paused}>
        {[45, 135, 225, 315].map((deg) => {
          const a = (deg * Math.PI) / 180;
          return <circle key={deg} cx={436 + 15 * Math.cos(a)} cy={226 + 15 * Math.sin(a)}
            r="2.4" fill="#0b1220" fillOpacity="0.55" />;
        })}
        {/* keyway mark — accent, makes the rotation readable */}
        <rect x={434.4} y={206} width={3.2} height={12} rx={1.2}
          fill={keyColor} fillOpacity={0.5 + rpmIntensity * 0.5}
          filter={!paused && rpmIntensity > 0.05 ? m.glowSm : undefined} />
      </Spinner>
      <circle cx="436" cy="226" r="7" fill="#1f2937" stroke="#4b5563" strokeWidth="1.5" />
      <circle cx="434" cy="224" r="1.6" fill="#ffffff" fillOpacity="0.4" />

      {/* ── Terminal / drive box with readouts (slots render here) ────── */}
      <MetalBody x={190} y={110} width={126} height={58} rx={6} m={m} />
      <GlassFace x={198} y={118} width={54} height={28} rx={4} m={m} />
      <GlassFace x={258} y={118} width={50} height={28} rx={4} m={m} />
      <text x="225" y="158" textAnchor="middle"
        style={{ ...label, fontSize: 6.5, letterSpacing: '0.12em' }}>SPEED</text>
      <text x="283" y="158" textAnchor="middle"
        style={{ ...label, fontSize: 6.5, letterSpacing: '0.12em' }}>CURRENT</text>
      <Blink cx={309} cy={158} r={3} intensity={ampIntensity} paused={paused} color={ACCENT} />
      {/* cable gland + supply cable dropping behind the body */}
      <rect x={181} y={128} width={9} height={14} rx={2} fill={PNL} stroke={BD} strokeWidth="1" />
      <path d="M 185 142 C 185 156 170 160 158 168" fill="none"
        stroke="#475569" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}
