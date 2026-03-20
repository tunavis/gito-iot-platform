'use client';
import React, { useId } from 'react';

interface DashFlowProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  intensity: number;
  paused: boolean;
  color: string;
  strokeWidth?: number;
  shadowColor?: string;
  highlightColor?: string;
}

export function DashFlow({
  x1, y1, x2, y2,
  intensity,
  paused,
  color,
  strokeWidth = 4,
  shadowColor,
  highlightColor,
}: DashFlowProps) {
  const id = useId();
  const active = intensity > 0.05 && !paused;
  const duration = active ? 0.4 + (1 - intensity) * 2.6 : 0;
  const dashLen = 8;
  const gapLen = 6;
  const totalDash = dashLen + gapLen;

  return (
    <g className={paused ? 'device-primitive--paused' : ''}>
      {shadowColor && (
        <line x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={shadowColor} strokeWidth={strokeWidth + 4}
          strokeLinecap="round" strokeOpacity={0.3} />
      )}
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={strokeWidth + 2}
        strokeLinecap="round" strokeOpacity={0.25} />
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dashLen} ${gapLen}`}
        strokeOpacity={0.3 + intensity * 0.6}
        style={active ? {
          animation: `dashflow-${id.replace(/:/g, '')} ${duration}s linear infinite`,
        } : undefined}
      />
      {highlightColor && (
        <line x1={x1} y1={y1 - 1} x2={x2} y2={y2 - 1}
          stroke={highlightColor} strokeWidth={1.5}
          strokeLinecap="round" strokeOpacity={0.3} />
      )}
      {active && (
        <style>{`
          @keyframes dashflow-${id.replace(/:/g, '')} {
            to { stroke-dashoffset: -${totalDash}px; }
          }
        `}</style>
      )}
    </g>
  );
}