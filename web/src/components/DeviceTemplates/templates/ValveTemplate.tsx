'use client';
import React, { useId } from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  ArcSweep, Blink, DashFlow, GlassFace, MetalBody, AOShadow,
  useMaterials, useSmoothed, resolveNumeric, FLOW_KEYS, POSITION_KEYS,
} from '../primitives';

const BD = 'var(--color-border)';
const ACCENT = '#fbbf24';          // actuator / control accent (amber)
const FLUID = '#22d3ee';           // process fluid (cyan, matches pump)
const FLUID_HI = '#a5f3fc';
const FLUID_LO = '#0e7490';

/** Display slots — regions of the artwork designed to show live values */
export const slots = {
  /** actuator face readout — valve position % open */
  position: { x: 235, y: 100, width: 56, fontSize: 13, glow: ACCENT },
  /** upstream pressure chip, left of the valve body */
  p_up:     { x: 96,  y: 163, width: 56, fontSize: 11 },
  /** downstream pressure chip, right of the valve body */
  p_down:   { x: 404, y: 163, width: 56, fontSize: 11 },
} as const;

/**
 * Industrial control valve — flanged globe-valve body on a horizontal pipe
 * (DashFlow carries the flow), actuator on top with position gauge + readout,
 * and a glass window into the body where the gate visibly travels with
 * valve position (%open). Upstream/downstream pressure chips flank the body.
 */
export function ValveTemplate({ telemetry, deviceStatus }: TemplateProps) {
  const m = useMaterials();
  const clipId = `valve-window-${useId().replace(/:/g, '')}`;
  const paused = deviceStatus === 'offline';
  const position = resolveNumeric(telemetry, POSITION_KEYS);
  const flow = resolveNumeric(telemetry, FLOW_KEYS);
  const posIntensity = Math.max(0, Math.min(position / 100, 1));
  const flowIntensity = Math.min(flow / 100, 1);
  // gate slides down into the window as the valve closes (1 = fully open)
  const pos01 = useSmoothed(posIntensity, 600);
  const gateH = Math.max(0, 1 - pos01) * 52; // 52 = travel to the seat line at y=225
  const gateEdge = paused ? '#475569' : ACCENT;
  const label = { fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' } as const;

  return (
    <g>
      {m.defs}

      {/* ── Ground shadow ─────────────────────────────────────────────── */}
      <AOShadow cx={250} cy={262} rx={130} ry={6} soft={m.soft} opacity={0.22} />

      {/* ── Pressure taps (rendered first, pipe covers the joints) ────── */}
      <rect x={90} y={176} width={6} height={24} rx={1.5}
        style={{ fill: 'var(--color-panel)', stroke: BD }} strokeWidth="1" />
      <rect x={404} y={176} width={6} height={24} rx={1.5}
        style={{ fill: 'var(--color-panel)', stroke: BD }} strokeWidth="1" />

      {/* ── Through-pipe: DashFlow IS the pipe (30,200) → (470,200) ───── */}
      <DashFlow x1={30} y1={200} x2={470} y2={200} intensity={flowIntensity} paused={paused}
        color={FLUID} shadowColor={FLUID_LO} highlightColor={FLUID_HI} strokeWidth={10} />

      {/* Direction chevrons above the pipe */}
      {[152, 338].map((x) => (
        <polyline key={x} points={`${x},178 ${x + 10},183 ${x},188`}
          fill="none" stroke={FLUID_HI} strokeWidth="2" strokeLinejoin="round" strokeOpacity="0.6" />
      ))}

      {/* ── Bolted flanges at both body joints ────────────────────────── */}
      <MetalBody x={196} y={176} width={14} height={48} rx={3} m={m} />
      <MetalBody x={290} y={176} width={14} height={48} rx={3} m={m} />
      {[[203, 184], [203, 216], [297, 184], [297, 216]].map(([bx, by]) => (
        <g key={`${bx}-${by}`}>
          <circle cx={bx} cy={by} r={1.9} fill="#0b1220" fillOpacity="0.65" />
          <circle cx={bx - 0.5} cy={by - 0.5} r={0.7} fill="#ffffff" fillOpacity="0.4" />
        </g>
      ))}

      {/* ── Actuator on top ───────────────────────────────────────────── */}
      <MetalBody x={192} y={72} width={116} height={56} rx={8} m={m} />
      <Blink cx={202} cy={79} r={3} intensity={posIntensity} paused={paused} color={ACCENT} />
      {/* position readout face (slot `position` renders here) */}
      <GlassFace x={202} y={84} width={66} height={32} rx={5} m={m} />
      {/* position gauge — dark instrument glass + amber arc */}
      <circle cx="287" cy="100" r="17" fill={m.glass} />
      <circle cx="287" cy="100" r="17" fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="1.5" />
      <circle cx="287" cy="100" r="18" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />
      <ArcSweep cx={287} cy={100} r={12} intensity={posIntensity} paused={paused}
        color={ACCENT} sweep={240} startAngle={150} strokeWidth={2.5} />
      <text x="235" y="123" textAnchor="middle"
        style={{ ...label, fontSize: 7.5, letterSpacing: '0.14em' }}>
        GITO CV-100
      </text>

      {/* ── Mounting flange + stem down to the bonnet ─────────────────── */}
      <MetalBody x={228} y={128} width={44} height={8} rx={2} m={m} />
      <MetalBody x={244} y={136} width={12} height={28} rx={2} m={m} />

      {/* ── Valve body — globe casing on the pipe ─────────────────────── */}
      <circle cx="250" cy="200" r="40" style={{ fill: 'var(--color-panel)' }} />
      <circle cx="250" cy="200" r="40" fill={m.metalV} />
      <circle cx="250" cy="200" r="40" fill="none" stroke={BD} strokeWidth="2" />
      {/* top-left catch-light on the casing rim */}
      <path d="M 222 172 A 40 40 0 0 1 250 160" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round" />
      {/* rim bolts */}
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const a = ((deg + 30) * Math.PI) / 180;
        return <circle key={deg} cx={250 + 34 * Math.cos(a)} cy={200 + 34 * Math.sin(a)}
          r="2.2" fill="#0b1220" fillOpacity="0.5" />;
      })}
      {/* bonnet — bolted on top of the body, stem passes through */}
      <MetalBody x={230} y={158} width={40} height={16} rx={3} m={m} />
      {/* drain plug */}
      <MetalBody x={241} y={238} width={18} height={10} rx={2} m={m} />

      {/* ── Gate window — dark glass; gate travels with position ──────── */}
      <clipPath id={clipId}>
        <circle cx="250" cy="200" r="26" />
      </clipPath>
      <circle cx="250" cy="200" r="26" fill={m.glass} />
      <circle cx="250" cy="200" r="26" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="250" cy="200" r="27.5" fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />
      <g clipPath={`url(#${clipId})`}>
        {/* seat line the gate closes against */}
        <line x1="228" y1="225" x2="272" y2="225" stroke="#475569" strokeWidth="1.5" strokeOpacity="0.7" />
        {/* gate — drops as the valve closes */}
        {gateH > 0.5 && (
          <g>
            <rect x={235} y={173} width={30} height={gateH} fill="#334155" />
            <rect x={235} y={173} width={30} height={gateH} fill={m.metalV} />
            <line x1={235} y1={173 + gateH} x2={265} y2={173 + gateH}
              stroke={gateEdge} strokeWidth="2.5" strokeLinecap="round"
              strokeOpacity={0.9} filter={paused ? undefined : m.glowSm} />
          </g>
        )}
      </g>
      {/* glass sheen on top of everything in the window */}
      <circle cx="250" cy="200" r="26" fill={m.sheen} pointerEvents="none" />

      {/* ── Pressure chips (slots p_up / p_down render here) ──────────── */}
      <GlassFace x={62} y={150} width={68} height={26} rx={4} m={m} />
      <GlassFace x={370} y={150} width={68} height={26} rx={4} m={m} />
      <text x="96" y="144" textAnchor="middle" style={{ ...label, fontSize: 7.5, letterSpacing: '0.1em' }}>UPSTREAM</text>
      <text x="404" y="144" textAnchor="middle" style={{ ...label, fontSize: 7.5, letterSpacing: '0.1em' }}>DOWNSTREAM</text>

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="30" y="222" style={label}>INLET</text>
      <text x="470" y="222" textAnchor="end" style={label}>OUTLET</text>
    </g>
  );
}
