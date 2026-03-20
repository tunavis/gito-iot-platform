'use client';
import React, { useId } from 'react';

interface SpinnerProps {
  cx: number;
  cy: number;
  children: React.ReactNode;
  intensity: number;
  paused: boolean;
}

export function Spinner({ cx, cy, children, intensity, paused }: SpinnerProps) {
  const id = useId();
  const animId = `spin-${id.replace(/:/g, '')}`;
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.5 + (1 - intensity) * 3.5 : 0;

  return (
    <g
      style={active ? {
        transformOrigin: `${cx}px ${cy}px`,
        animation: `${animId} ${duration}s linear infinite`,
        willChange: 'transform',
      } : {
        transformOrigin: `${cx}px ${cy}px`,
      }}
    >
      {children}
      {active && (
        <style>{`
          @keyframes ${animId} {
            to { transform: rotate(360deg); }
          }
        `}</style>
      )}
    </g>
  );
}