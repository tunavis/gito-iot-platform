'use client';
import React from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import {
  useMaterials, MetalBody, GlassFace, AOShadow,
  DashFlow, Spinner, ArcSweep, Blink,
  resolveNumeric, FLOW_KEYS, RPM_KEYS, POWER_KEYS,
} from '../primitives';

const BD = 'var(--color-border)';
const MUT = 'var(--color-text-muted)';
// Accent — teal (conditioned air / active systems)
const AC = '#2dd4bf';
const ACD = '#0f766e';
const ACL = '#99f6e4';

/** Display slots — the compressor instrument strip (180-320 × 246-286) */
export const slots = {
  load: { x: 258, y: 271, width: 68, fontSize: 13, glow: AC },
} as const;

export function HvacTemplate({ width, height, telemetry, deviceStatus }: TemplateProps) {
  const m = useMaterials();
  const paused = deviceStatus === 'offline';
  const flow = resolveNumeric(telemetry, FLOW_KEYS);
  const rpm = resolveNumeric(telemetry, RPM_KEYS);
  const airIntensity = Math.min(Math.max(flow / 100, rpm / 3000), 1);
  const load = resolveNumeric(telemetry, POWER_KEYS);
  const loadIntensity = Math.min(load / 100, 1);

  return (
    <g>
      {m.defs}

      {/* ── Ground shadow + roof stand feet ─────────────────────────────── */}
      <AOShadow cx={250} cy={352} rx={175} ry={8} soft={m.soft} />
      <MetalBody x={140} y={328} width={30} height={20} rx={2} m={m} />
      <MetalBody x={330} y={328} width={30} height={20} rx={2} m={m} />

      {/* ── Exhaust cowl on the roof ────────────────────────────────────── */}
      <MetalBody x={292} y={72} width={68} height={26} rx={4} m={m} />
      {[304, 318, 332, 346].map((x) => (
        <line key={x} x1={x} y1={79} x2={x} y2={91} stroke={BD} strokeWidth="1.5" strokeOpacity="0.8" />
      ))}

      {/* ── Return & supply ducts (chips land on their faces) ──────────── */}
      <MetalBody x={30} y={120} width={84} height={112} rx={4} m={m} />
      <MetalBody x={386} y={120} width={84} height={112} rx={4} m={m} />
      {/* flange bolts at the cabinet joints */}
      {[[104, 130], [104, 222], [396, 130], [396, 222]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={1.8} fill={MUT} fillOpacity="0.6" />
      ))}
      <text x="72" y="246" textAnchor="middle"
        style={{ fill: MUT, fontSize: 9, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        RETURN
      </text>
      <text x="428" y="246" textAnchor="middle"
        style={{ fill: MUT, fontSize: 9, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        SUPPLY
      </text>

      {/* ── Cabinet ─────────────────────────────────────────────────────── */}
      <MetalBody x={110} y={95} width={280} height={235} rx={10} m={m} />
      {/* panel seams */}
      <line x1="200" y1="100" x2="200" y2="325" stroke={BD} strokeWidth="1" strokeOpacity="0.55" />
      <line x1="300" y1="100" x2="300" y2="325" stroke={BD} strokeWidth="1" strokeOpacity="0.55" />
      {/* corner rivets */}
      {[[120, 105], [380, 105], [120, 320], [380, 320]].map(([x, y]) => (
        <circle key={`rv-${x}-${y}`} cx={x} cy={y} r={1.6} fill={MUT} fillOpacity="0.55" />
      ))}
      {/* vent slots, top-left panel */}
      {[110, 117, 124].map((y) => (
        <line key={y} x1={128} y1={y} x2={166} y2={y} stroke={BD} strokeWidth="1.5" strokeOpacity="0.7" />
      ))}
      {/* etched model label */}
      <text x="378" y="316" textAnchor="end"
        style={{ fill: MUT, fontSize: 8, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.1em', opacity: 0.8 }}>
        GITO AH-450
      </text>

      {/* ── Condenser coil (left section, behind the air stream) ───────── */}
      <path d="M132 168 H188 V182 H132 V196 H188 V210 H132 V224 H188 V238 H132 V252 H188"
        fill="none" stroke={MUT} strokeWidth="1.5" strokeOpacity="0.5" strokeLinejoin="round" />

      {/* ── Fan cutaway window (hero motion) ────────────────────────────── */}
      <circle cx={315} cy={200} r={42} fill={m.glass} />
      <circle cx={315} cy={200} r={42} fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="2" />
      <circle cx={315} cy={200} r={43.5} fill="none" stroke={BD} strokeWidth="2" />
      <Spinner cx={315} cy={200} intensity={airIntensity} paused={paused}>
        {[0, 72, 144, 216, 288].map((deg) => {
          const a1 = (deg * Math.PI) / 180;
          const a2 = ((deg + 30) * Math.PI) / 180;
          return (
            <line key={deg}
              x1={315 + 10 * Math.cos(a1)} y1={200 + 10 * Math.sin(a1)}
              x2={315 + 35 * Math.cos(a2)} y2={200 + 35 * Math.sin(a2)}
              stroke="#94a3b8" strokeWidth="5.5" strokeLinecap="round" strokeOpacity="0.9" />
          );
        })}
      </Spinner>
      {/* protective grille rings + hub */}
      <circle cx={315} cy={200} r={20} fill="none" stroke="#e2e8f0" strokeWidth="0.8" strokeOpacity="0.18" />
      <circle cx={315} cy={200} r={32} fill="none" stroke="#e2e8f0" strokeWidth="0.8" strokeOpacity="0.18" />
      <circle cx={315} cy={200} r={8} fill="#1f2937" stroke="#475569" strokeWidth="1.5" />

      {/* ── Airflow through the machine (in front of coil + fan) ───────── */}
      <DashFlow x1={50} y1={200} x2={450} y2={200} intensity={airIntensity} paused={paused}
        color={AC} shadowColor={ACD} highlightColor={ACL} strokeWidth={10} />

      {/* ── Compressor-load instrument strip ────────────────────────────── */}
      <GlassFace x={180} y={246} width={140} height={40} rx={6} m={m} />
      <ArcSweep cx={202} cy={268} r={14} intensity={loadIntensity} paused={paused}
        color={AC} sweep={240} startAngle={150} strokeWidth={3} />
      <text x="312" y="258" textAnchor="end"
        style={{ fill: '#94a3b8', fontSize: 7, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.12em' }}>
        COMP
      </text>

      {/* ── Status LED on top of the unit ───────────────────────────────── */}
      <Blink cx={180} cy={111} r={4} intensity={paused ? 0 : Math.max(airIntensity, 0.3)}
        paused={paused} color={AC} />
    </g>
  );
}
