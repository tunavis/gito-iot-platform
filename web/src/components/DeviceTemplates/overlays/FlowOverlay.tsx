'use client';

import React from 'react';
import FlowLine from '@/components/visualization/FlowLine';
import type { FlowOverlay } from '../types';
import { inferMetricDefinition } from '@/components/visualization/effects';

interface Props {
  overlay: FlowOverlay;
  value: number | string | null;
  /** Pixels per SVG unit (containerWidth / 500). Used to size FlowLine correctly. */
  svgScale: number;
}

export default function FlowOverlayWidget({ overlay, value, svgScale }: Props) {
  const numVal = value === null || value === undefined ? 0 : Number(value);
  const max    = overlay.max ?? 100;

  const dx = overlay.end.x - overlay.start.x;
  const dy = overlay.end.y - overlay.start.y;
  const svgLength   = Math.sqrt(dx * dx + dy * dy);
  const pixelLength = Math.max(svgLength * svgScale, 20);
  const angleDeg    = Math.atan2(dy, dx) * (180 / Math.PI);

  // Infer effect from metric key (water/gas/energy/air)
  const def    = inferMetricDefinition(overlay.metric, numVal);
  const effect = def.effect ?? 'water';

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left:  `${(overlay.start.x / 500) * 100}%`,
        top:   `${(overlay.start.y / 400) * 100}%`,
        transform: `rotate(${angleDeg}deg)`,
        transformOrigin: '0 50%',
        width: pixelLength,
        height: 'auto',
        pointerEvents: 'none',
      }}
    >
      <FlowLine
        value={isNaN(numVal) ? 0 : numVal}
        maxValue={max}
        effect={effect}
        direction="horizontal"
        thickness={6}
        length={pixelLength}
      />
    </div>
  );
}
