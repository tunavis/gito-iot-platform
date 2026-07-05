'use client';
import React, { useId } from 'react';

interface DashFlowProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  intensity: number;
  paused: boolean;
  color: string;
  strokeWidth?: number;
  shadowColor?: string;
  highlightColor?: string;
}

/**
 * DashFlow — a liquid-carrying pipe.
 *
 * Layers (bottom → top):
 *   1. tube casing (dark, wider than the bore)
 *   2. liquid base (accent, always visible so an idle pipe still reads as full)
 *   3. animated dash core with glow — speed tracks |intensity|
 *   4. particles riding the flow (SMIL animateMotion, staggered)
 *   5. specular catch-light along the top of the tube
 */
export function DashFlow({
  x1, y1, x2, y2,
  intensity,
  paused,
  color,
  strokeWidth = 4,
  shadowColor,
  highlightColor,
}: DashFlowProps) {
  const raw = useId().replace(/:/g, '');
  const glowId = `df-glow-${raw}`;
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.4 + (1 - intensity) * 2.6 : 0;
  const particleDur = active ? 1.2 + (1 - intensity) * 3 : 0;
  const casing = shadowColor ?? '#0b1220';
  const spec = highlightColor ?? '#ffffff';
  const len = Math.hypot(x2 - x1, y2 - y1);
  const particleCount = len > 120 ? 3 : 2;

  return (
    <g>
      <defs>
        <filter id={glowId} x="-60%" y="-300%" width="220%" height="700%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 1 — tube casing */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={casing} strokeWidth={strokeWidth + 5}
        strokeLinecap="round" strokeOpacity={0.85} />
      {/* casing rim light */}
      <line x1={x1} y1={y1 - (strokeWidth + 3) / 2} x2={x2} y2={y2 - (strokeWidth + 3) / 2}
        stroke="#ffffff" strokeWidth={1} strokeLinecap="round" strokeOpacity={0.12} />

      {/* 2 — liquid base */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={strokeWidth + 1}
        strokeLinecap="round" strokeOpacity={active ? 0.45 : 0.22}
        style={{ transition: 'stroke-opacity 0.5s ease' }} />

      {/* 3 — animated dash core */}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color}
        strokeWidth={strokeWidth - 1}
        strokeLinecap="round"
        strokeDasharray="8 6"
        filter={active ? `url(#${glowId})` : undefined}
        style={{
          strokeOpacity: 0.35 + intensity * 0.65,
          animationName: active ? 'dash-flow-fwd' : 'none',
          animationDuration: `${duration}s`,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
        }}
      />

      {/* 4 — particles riding the flow */}
      {active && Array.from({ length: particleCount }, (_, i) => (
        <circle key={i} r={Math.max(1.4, strokeWidth * 0.22)} fill={spec} fillOpacity={0.85}
          filter={`url(#${glowId})`}>
          <animateMotion
            dur={`${particleDur}s`}
            begin={`${-(particleDur / particleCount) * i}s`}
            repeatCount="indefinite"
            path={`M ${x1} ${y1} L ${x2} ${y2}`}
          />
        </circle>
      ))}

      {/* 5 — specular catch-light */}
      <line x1={x1} y1={y1 - strokeWidth * 0.28} x2={x2} y2={y2 - strokeWidth * 0.28}
        stroke={spec} strokeWidth={1.2}
        strokeLinecap="round" strokeOpacity={0.28} />
    </g>
  );
}
