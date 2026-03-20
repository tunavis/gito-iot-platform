'use client';
import React from 'react';

interface SpinnerProps {
  cx: number;
  cy: number;
  children: React.ReactNode;
  intensity: number;
  paused: boolean;
}

export function Spinner({ cx, cy, children, intensity, paused }: SpinnerProps) {
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.5 + (1 - intensity) * 3.5 : 0;

  return (
    <g>
      {children}
      {active && (
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${cx} ${cy}`}
          to={`360 ${cx} ${cy}`}
          dur={`${duration}s`}
          repeatCount="indefinite"
        />
      )}
    </g>
  );
}
