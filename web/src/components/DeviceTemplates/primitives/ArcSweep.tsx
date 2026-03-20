'use client';
import React from 'react';

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

export function ArcSweep({
  cx, cy, r,
  intensity,
  paused,
  color,
  sweep = 240,
  startAngle = 150,
  strokeWidth = 3,
}: ArcSweepProps) {
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  const endAngle = startAngle + sweep;
  const valueAngle = startAngle + sweep * clampedIntensity;
  const displayColor = paused ? '#6b7280' : color;
  const pos = polarToCartesian(cx, cy, r, valueAngle);

  return (
    <g>
      <path d={describeArc(cx, cy, r, startAngle, endAngle)}
        fill="none" stroke={displayColor} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeOpacity={0.15} />
      {clampedIntensity > 0.01 && (
        <path d={describeArc(cx, cy, r, startAngle, valueAngle)}
          fill="none" stroke={displayColor} strokeWidth={strokeWidth}
          strokeLinecap="round" strokeOpacity={0.8}
          style={{ transition: 'stroke 0.5s ease' }} />
      )}
      <circle cx={pos.x} cy={pos.y} r={strokeWidth}
        fill={displayColor} fillOpacity={0.9} />
    </g>
  );
}
