'use client';
import React, { useId } from 'react';

interface PulseRingProps {
  cx: number;
  cy: number;
  r: number;
  intensity: number;
  paused: boolean;
  color: string;
}

/**
 * PulseRing — a glowing status beacon with two staggered expanding rings.
 */
export function PulseRing({ cx, cy, r, intensity, paused, color }: PulseRingProps) {
  const raw = useId().replace(/:/g, '');
  const glowId = `pr-glow-${raw}`;
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.6 + (1 - intensity) * 1.9 : 0;

  return (
    <g>
      <defs>
        <filter id={glowId} x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="1.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* core dot — glows when active */}
      <circle cx={cx} cy={cy} r={r * 0.4} fill={color}
        fillOpacity={active ? 0.95 : 0.3}
        filter={active ? `url(#${glowId})` : undefined} />
      {active && [0, 0.5].map((delay, i) => (
        <circle key={i}
          cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth={1.6}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animationName: 'pulse-ring-expand',
            animationDuration: `${duration}s`,
            animationDelay: `${-duration * delay}s`,
            animationTimingFunction: 'ease-out',
            animationIterationCount: 'infinite',
          }}
        />
      ))}
    </g>
  );
}
