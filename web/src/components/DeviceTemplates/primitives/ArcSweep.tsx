'use client';
import React, { useId } from 'react';
import { useSmoothed } from './useSmoothed';

interface ArcSweepProps {
  cx: number;
  cy: number;
  r: number;
  intensity: number;
  paused: boolean;
  color: string;
  sweep?: number;
  startAngle?: number;
  strokeWidth?: number;
}

function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

/**
 * ArcSweep — an instrument gauge: glowing value arc plus a physical needle
 * with a machined pivot. Needle angle transitions smoothly on live updates.
 */
export function ArcSweep({
  cx, cy, r,
  intensity,
  paused,
  color,
  sweep = 240,
  startAngle = 150,
  strokeWidth = 3,
}: ArcSweepProps) {
  const raw = useId().replace(/:/g, '');
  const glowId = `as-glow-${raw}`;
  const pivotId = `as-pivot-${raw}`;

  // rAF smoothing drives BOTH the arc and the needle so they stay in lockstep
  const smoothIntensity = useSmoothed(intensity, 600);
  const clampedIntensity = Math.max(0, Math.min(1, smoothIntensity));
  const endAngle = startAngle + sweep;
  const valueAngle = startAngle + sweep * clampedIntensity;
  const displayColor = paused ? '#6b7280' : color;

  return (
    <g>
      <defs>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={pivotId} cx="0.35" cy="0.35" r="1">
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="55%" stopColor="#4b5563" />
          <stop offset="100%" stopColor="#1f2937" />
        </radialGradient>
      </defs>

      {/* track */}
      <path d={describeArc(cx, cy, r, startAngle, endAngle)}
        fill="none" stroke={displayColor} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeOpacity={0.14} />
      {/* value arc — glowing */}
      {clampedIntensity > 0.01 && (
        <path d={describeArc(cx, cy, r, startAngle, valueAngle)}
          fill="none" stroke={displayColor} strokeWidth={strokeWidth}
          strokeLinecap="round" strokeOpacity={0.9}
          filter={paused ? undefined : `url(#${glowId})`}
          style={{ transition: 'stroke 0.5s ease' }} />
      )}

      {/* needle — rotates about the pivot, smooth on live updates */}
      <g style={{
        transformOrigin: `${cx}px ${cy}px`,
        transform: `rotate(${valueAngle}deg)`,
      }}>
        {/* main needle points "up" (0deg baseline) */}
        <polygon
          points={`${cx - 1.4},${cy} ${cx},${cy - r + strokeWidth + 2} ${cx + 1.4},${cy}`}
          fill={displayColor} fillOpacity={0.95} />
        {/* counterweight tail */}
        <rect x={cx - 1.2} y={cy} width={2.4} height={r * 0.22}
          rx={1.2} fill={displayColor} fillOpacity={0.55} />
      </g>

      {/* machined pivot dome */}
      <circle cx={cx} cy={cy} r={Math.max(3, strokeWidth + 1)} fill={`url(#${pivotId})`} />
      <circle cx={cx - 1} cy={cy - 1} r={1} fill="#ffffff" fillOpacity={0.5} />
    </g>
  );
}
