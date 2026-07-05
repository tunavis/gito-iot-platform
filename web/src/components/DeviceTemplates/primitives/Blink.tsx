'use client';
import React, { useId } from 'react';

interface BlinkProps {
  cx: number;
  cy: number;
  r: number;
  intensity: number;
  paused: boolean;
  color?: string;
  glowColor?: string;
}

/**
 * Blink — a real indicator LED: domed lens (radial gradient), glow halo
 * when lit, specular catch-light. Blink rate tracks intensity.
 */
export function Blink({ cx, cy, r, intensity, paused, color = '#22c55e', glowColor }: BlinkProps) {
  const raw = useId().replace(/:/g, '');
  const lensId = `bl-lens-${raw}`;
  const glowId = `bl-glow-${raw}`;
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.3 + (1 - intensity) * 1.7 : 0;
  const halo = glowColor ?? color;

  return (
    <g>
      <defs>
        <radialGradient id={lensId} cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="25%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.75" />
        </radialGradient>
        <filter id={glowId} x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation={r * 0.9} />
        </filter>
      </defs>

      {/* bezel */}
      <circle cx={cx} cy={cy} r={r + 1.4} fill="#0b1220" fillOpacity={0.8} />
      {/* glow halo */}
      {active && (
        <circle cx={cx} cy={cy} r={r * 1.8} fill={halo} fillOpacity={0.35}
          filter={`url(#${glowId})`}
          style={{
            animationName: 'blink-led',
            animationDuration: `${duration}s`,
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
          }} />
      )}
      {/* lens */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${lensId})`}
        style={{
          fillOpacity: active ? 1 : 0.25,
          animationName: active ? 'blink-led' : 'none',
          animationDuration: `${duration}s`,
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
        }}
      />
      {/* specular */}
      <circle cx={cx - r * 0.3} cy={cy - r * 0.32} r={r * 0.28}
        fill="white" fillOpacity={0.65} />
    </g>
  );
}
