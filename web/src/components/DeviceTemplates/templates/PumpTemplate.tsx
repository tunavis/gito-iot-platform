'use client';
import React from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  Spinner, DashFlow, ArcSweep, Blink,
  useMaterials, AOShadow, MetalBody,
  resolveNumeric, RPM_KEYS, FLOW_KEYS,
} from '../primitives';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
const ACCENT = '#22d3ee';
const ACCENT_HI = '#a5f3fc';
const ACCENT_LO = '#0e7490';

/** No display slots — a pump has no digital face; its metrics live in the
 *  side grid, and the impeller/pipes/LED carry the live state visually. */
export const slots = {} as const;

export function PumpTemplate({ width, height, telemetry, deviceStatus }: TemplateProps) {
  const m = useMaterials();
  const paused = deviceStatus === 'offline';
  const rpm = resolveNumeric(telemetry, RPM_KEYS);
  const flow = resolveNumeric(telemetry, FLOW_KEYS);
  const rpmIntensity = Math.min(rpm / 3000, 1);
  const flowIntensity = Math.min(flow / 100, 1);
  const bladeColor = paused ? '#475569' : ACCENT;
  const label = { fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' } as const;

  return (
    <g>
      {m.defs}

      {/* ── Ground shadow ─────────────────────────────────────────────── */}
      <AOShadow cx={250} cy={316} rx={135} ry={7} soft={m.soft} />

      {/* ── Base plate + pedestal ─────────────────────────────────────── */}
      <MetalBody x={150} y={296} width={200} height={18} rx={3} m={m} />
      {[164, 336].map((x) => (
        <g key={x}>
          <circle cx={x} cy={305} r={3.2} fill="#0b1220" fillOpacity="0.55" />
          <circle cx={x - 0.8} cy={304.2} r={1} fill="#ffffff" fillOpacity="0.35" />
        </g>
      ))}
      <text x="250" y="309" textAnchor="middle"
        style={{ ...label, fontSize: 7.5, letterSpacing: '0.14em' }}>
        GITO CP-450
      </text>
      <MetalBody x={232} y={282} width={36} height={16} rx={2} m={m} />

      {/* ── Junction box (behind motor top edge) + status LED ─────────── */}
      <MetalBody x={184} y={80} width={34} height={26} rx={3} m={m} />

      {/* ── Motor — horizontal cylinder with cooling fins ─────────────── */}
      <MetalBody x={170} y={100} width={160} height={72} rx={12} m={m} horizontal />
      {Array.from({ length: 9 }, (_, i) => 182 + i * 11).map((x) => (
        <line key={x} x1={x} y1={106} x2={x} y2={166} strokeWidth="1" stroke={BD} strokeOpacity="0.45" />
      ))}
      {/* drive-end bell seam */}
      <line x1="286" y1="103" x2="286" y2="169" strokeWidth="1.5" stroke={BD} strokeOpacity="0.6" />
      {/* end-bell RPM dial — dark instrument glass + gauge */}
      <circle cx="308" cy="136" r="17" fill={m.glass} />
      <circle cx="308" cy="136" r="17" fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="1.5" />
      <circle cx="308" cy="136" r="18" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />
      <ArcSweep cx={308} cy={136} r={12} intensity={rpmIntensity} paused={paused}
        color={ACCENT} sweep={240} startAngle={150} strokeWidth={2.5} />
      <Blink cx={201} cy={90} r={3.5} intensity={rpmIntensity} paused={paused} color={ACCENT} />

      {/* ── Shaft coupling (motor → volute, tucked behind casing) ─────── */}
      <MetalBody x={238} y={164} width={24} height={20} rx={3} m={m} />

      {/* ── Suction / discharge — DashFlow IS the pipe ─────────────────── */}
      <DashFlow x1={30} y1={200} x2={210} y2={200} intensity={flowIntensity} paused={paused}
        color={ACCENT} shadowColor={ACCENT_LO} highlightColor={ACCENT_HI} strokeWidth={10} />
      <DashFlow x1={290} y1={200} x2={470} y2={200} intensity={flowIntensity} paused={paused}
        color={ACCENT} shadowColor={ACCENT_LO} highlightColor={ACCENT_HI} strokeWidth={10} />

      {/* ── Pipe flanges (chip anchors land on these) ─────────────────── */}
      {[75, 425].map((x) => (
        <g key={x}>
          <MetalBody x={x - 9} y={182} width={18} height={36} rx={2} m={m} />
          <circle cx={x} cy={188} r={2} fill="#0b1220" fillOpacity="0.55" />
          <circle cx={x} cy={212} r={2} fill="#0b1220" fillOpacity="0.55" />
        </g>
      ))}

      {/* ── Volute casing ─────────────────────────────────────────────── */}
      <circle cx="250" cy="235" r="60" style={{ fill: PNL }} />
      <circle cx="250" cy="235" r="60" fill={m.metalV} />
      <circle cx="250" cy="235" r="60" fill="none" stroke={BD} strokeWidth="2" />
      {/* top-left catch-light on the casing rim */}
      <path d="M 208 193 A 60 60 0 0 1 250 175" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round" />
      {/* rim bolts */}
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const a = ((deg + 30) * Math.PI) / 180;
        return <circle key={deg} cx={250 + 53 * Math.cos(a)} cy={235 + 53 * Math.sin(a)}
          r="2.4" fill="#0b1220" fillOpacity="0.5" />;
      })}

      {/* ── Impeller viewport — dark glass window into the volute ─────── */}
      <circle cx="250" cy="235" r="45" fill={m.glass} />
      <circle cx="250" cy="235" r="45" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="250" cy="235" r="46.5" fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />
      {/* impeller — 5 curved blades, hero motion driven by RPM */}
      <Spinner cx={250} cy={235} intensity={rpmIntensity} paused={paused}>
        {[0, 72, 144, 216, 288].map((deg) => {
          const a = (deg * Math.PI) / 180;
          const p0x = 250 + 13 * Math.cos(a),        p0y = 235 + 13 * Math.sin(a);
          const cx  = 250 + 28 * Math.cos(a + 0.45), cy  = 235 + 28 * Math.sin(a + 0.45);
          const p1x = 250 + 38 * Math.cos(a + 0.85), p1y = 235 + 38 * Math.sin(a + 0.85);
          return (
            <path key={deg} d={`M ${p0x} ${p0y} Q ${cx} ${cy} ${p1x} ${p1y}`}
              fill="none" stroke={bladeColor} strokeWidth="5" strokeLinecap="round"
              strokeOpacity={0.5 + rpmIntensity * 0.5}
              filter={!paused && rpmIntensity > 0.05 ? m.glowSm : undefined} />
          );
        })}
      </Spinner>
      {/* shaft hub */}
      <circle cx="250" cy="235" r="9" fill="#1f2937" stroke="#4b5563" strokeWidth="1.5" />
      <circle cx="247.5" cy="232.5" r="2" fill="#ffffff" fillOpacity="0.4" />
      {/* glass sheen on top of everything in the window */}
      <circle cx="250" cy="235" r="45" fill={m.sheen} pointerEvents="none" />

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="30" y="186" style={label}>INLET</text>
      <text x="470" y="186" textAnchor="end" style={label}>OUTLET</text>
    </g>
  );
}
