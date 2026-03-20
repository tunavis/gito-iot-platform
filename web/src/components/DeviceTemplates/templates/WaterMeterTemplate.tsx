import React from 'react';
import type { TemplateProps } from '../TemplateRenderer';
import { ArcSweep, DashFlow, resolveNumeric, FLOW_KEYS } from '../primitives';

const BD  = 'var(--color-border)';
const PNL = 'var(--color-panel)';
const W  = '#3b82f6';

export function WaterMeterTemplate({ width, height, telemetry, deviceStatus }: TemplateProps) {
  const paused = deviceStatus === 'offline';
  const flow = resolveNumeric(telemetry, FLOW_KEYS);
  const flowIntensity = Math.min(flow / 100, 1);

  return (
    <svg width={width} height={height} viewBox="0 0 500 400" aria-hidden="true">

      {/* ── Inlet pipe (left section, y=200) ──────────────────────────── */}
      <DashFlow x1={30} y1={200} x2={172} y2={200} intensity={flowIntensity} paused={paused} color="#3b82f6" shadowColor="#1d4ed8" highlightColor="#93c5fd" strokeWidth={10} />
      {/* Flow arrow */}
      <polyline points="95,192 112,200 95,208" strokeWidth="2" strokeLinejoin="round" stroke="#93c5fd" fill="none" />

      {/* ── Outlet pipe (right section, y=200) ────────────────────────── */}
      <DashFlow x1={328} y1={200} x2={470} y2={200} intensity={flowIntensity} paused={paused} color="#3b82f6" shadowColor="#1d4ed8" highlightColor="#93c5fd" strokeWidth={10} />
      {/* Flow arrow */}
      <polyline points="378,192 395,200 378,208" strokeWidth="2" strokeLinejoin="round" stroke="#93c5fd" fill="none" />

      {/* ── Pipe stubs through meter housing ──────────────────────────── */}
      <line x1="172" y1="200" x2="198" y2="200" strokeWidth="10" strokeLinecap="round" stroke={W} strokeOpacity="0.7" />
      <line x1="302" y1="200" x2="328" y2="200" strokeWidth="10" strokeLinecap="round" stroke={W} strokeOpacity="0.7" />

      {/* ── Flanges (connection collars) ──────────────────────────────── */}
      <rect x="161" y="184" width="14" height="32" rx="2" strokeWidth="2" fill={PNL} stroke={BD} />
      <rect x="325" y="184" width="14" height="32" rx="2" strokeWidth="2" fill={PNL} stroke={BD} />

      {/* ── Meter housing ─────────────────────────────────────────────── */}
      <rect x="176" y="120" width="148" height="160" rx="10" strokeWidth="3" fill={PNL} stroke={BD} />
      {/* Housing left sheen */}
      <rect x="181" y="126" width="4" height="148" rx="2" fill="white" fillOpacity="0.06" />

      {/* ── Display face ──────────────────────────────────────────────── */}
      <rect x="198" y="142" width="104" height="80" rx="6" strokeWidth="2"
        style={{ fill: 'var(--color-page)', stroke: BD }} />
      {/* Tick arc background */}
      {[-30, -18, -6, 6, 18, 30].map((dx) => (
        <line key={dx}
          x1={250 + dx} y1="150" x2={250 + dx} y2="160"
          strokeWidth="1.5" stroke={BD} />
      ))}
      {/* Major ticks */}
      {[-30, 0, 30].map((dx) => (
        <line key={`maj-${dx}`}
          x1={250 + dx} y1="149" x2={250 + dx} y2="162"
          strokeWidth="2.5" stroke={BD} strokeOpacity="0.8" />
      ))}
      {/* ArcSweep replaces static needle — shows flow rate as gauge position */}
      <ArcSweep cx={250} cy={182} r={28} intensity={flowIntensity} paused={paused} color="#3b82f6" sweep={180} startAngle={180} strokeWidth={3} />

      {/* ── Serial register display ───────────────────────────────────── */}
      <rect x="198" y="238" width="104" height="28" rx="4" strokeWidth="1.5"
        style={{ fill: 'var(--color-page)', stroke: BD }} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={203 + i * 16} y="243" width="10" height="18" rx="2"
          style={{ fill: 'var(--color-page)', stroke: BD }} strokeWidth="1" />
      ))}

      {/* ── Labels ────────────────────────────────────────────────────── */}
      <text x="30" y="190"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        IN
      </text>
      <text x="456" y="190" textAnchor="end"
        style={{ fill: 'var(--color-text-muted)', fontSize: 10, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.06em' }}>
        OUT
      </text>
      <text x="250" y="113" textAnchor="middle"
        style={{ fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'system-ui,sans-serif', letterSpacing: '0.08em' }}>
        FLOW METER
      </text>
    </svg>
  );
}
