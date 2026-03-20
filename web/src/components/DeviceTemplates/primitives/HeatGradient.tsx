'use client';
import React, { useId } from 'react';

interface HeatGradientProps {
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number;
  paused: boolean;
  steps?: [string, string, string, string];
  direction?: 'vertical' | 'horizontal';
  rx?: number;
}

const HEAT_STEPS: [string, string, string, string] = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444'];

export function HeatGradient({
  x, y, width, height,
  intensity,
  paused,
  steps = HEAT_STEPS,
  direction = 'vertical',
  rx = 0,
}: HeatGradientProps) {
  const id = useId();
  const gradId = `hg-${id.replace(/:/g, '')}`;
  const stepIndex = Math.min(Math.floor(intensity * 3.99), 3);
  const fillColor = paused ? '#6b7280' : steps[stepIndex];
  const isVertical = direction === 'vertical';

  return (
    <g>
      <defs>
        <linearGradient id={gradId}
          x1={isVertical ? '0' : '0'} y1={isVertical ? '1' : '0'}
          x2={isVertical ? '0' : '1'} y2={isVertical ? '0' : '0'}
        >
          <stop offset="0%" stopColor={steps[0]} stopOpacity={0.2} />
          <stop offset="100%" stopColor={fillColor} stopOpacity={0.6}
            style={{ transition: 'stop-color 0.8s ease' }}
          />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={height} rx={rx}
        fill={`url(#${gradId})`}
        style={{ transition: 'fill 0.8s ease' }}
      />
    </g>
  );
}
