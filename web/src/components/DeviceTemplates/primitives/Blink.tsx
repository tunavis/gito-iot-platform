'use client';
import React from 'react';

interface BlinkProps {
  cx: number;
  cy: number;
  r: number;
  intensity: number;
  paused: boolean;
  color?: string;
  glowColor?: string;
}

export function Blink({ cx, cy, r, intensity, paused, color = '#22c55e', glowColor }: BlinkProps) {
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.3 + (1 - intensity) * 1.7 : 0;

  return (
    <g>
      {active && glowColor && (
        <circle cx={cx} cy={cy} r={r * 2} fill={glowColor} fillOpacity={0.15} />
      )}
      <circle cx={cx} cy={cy} r={r} fill={color}
        style={{
          fillOpacity: active ? 0.9 : 0.2,
          animationName: active ? 'blink-led' : 'none',
          animationDuration: `${duration}s`,
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        }}
      />
      <circle cx={cx - r * 0.25} cy={cy - r * 0.25} r={r * 0.35}
        fill="white" fillOpacity={0.4} />
    </g>
  );
}
