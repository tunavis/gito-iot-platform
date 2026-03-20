'use client';
import React from 'react';

interface PulseRingProps {
  cx: number;
  cy: number;
  r: number;
  intensity: number;
  paused: boolean;
  color: string;
}

export function PulseRing({ cx, cy, r, intensity, paused, color }: PulseRingProps) {
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.6 + (1 - intensity) * 1.9 : 0;

  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 0.4} fill={color} fillOpacity={active ? 0.9 : 0.3} />
      {active && (
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth={2}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animationName: 'pulse-ring-expand',
            animationDuration: `${duration}s`,
            animationTimingFunction: 'ease-out',
            animationIterationCount: 'infinite',
          }}
        />
      )}
    </g>
  );
}
