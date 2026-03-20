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
  const rSmall = r * 0.5;
  const rLarge = r * 1.5;

  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 0.4} fill={color} fillOpacity={active ? 0.9 : 0.3} />
      {active && (
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth={2}
          opacity={0.7}
        >
          <animate
            attributeName="r"
            values={`${rSmall};${rLarge}`}
            dur={`${duration}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.7;0"
            dur={`${duration}s`}
            repeatCount="indefinite"
          />
        </circle>
      )}
    </g>
  );
}
