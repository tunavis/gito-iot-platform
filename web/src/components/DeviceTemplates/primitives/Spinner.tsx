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
    <g style={{
      transformOrigin: `${cx}px ${cy}px`,
      animationName: active ? 'template-spin' : 'none',
      animationDuration: `${duration}s`,
      animationTimingFunction: 'linear',
      animationIterationCount: 'infinite',
    }}>
      {children}
    </g>
  );
}
