'use client';

/**
 * OverlayWidget — Dispatcher
 *
 * Routes each Overlay to the correct component and positions it in SVG coordinate space.
 * Non-flow overlays are centered on their `position` point using translate(-50%,-50%).
 * Flow overlays handle their own positioning (see FlowOverlay.tsx).
 */

import React from 'react';
import type { Overlay } from '../types';
import ValueLabelOverlayWidget from './ValueLabelOverlay';
import GaugeOverlayWidget      from './GaugeOverlay';
import LevelOverlayWidget      from './LevelOverlay';
import StatusOverlayWidget     from './StatusOverlay';
import FlowOverlayWidget       from './FlowOverlay';

interface Props {
  overlay: Overlay;
  value: number | string | null;
  /** Pixels per SVG unit — required by FlowOverlay */
  svgScale: number;
  /** ViewBox crop applied to the SVG container — used to align overlay y-positions */
  crop: { y: number; h: number };
}

export default function OverlayWidget({ overlay, value, svgScale, crop }: Props) {
  // Flow overlays position themselves absolutely — skip the wrapper
  if (overlay.type === 'flow') {
    return <FlowOverlayWidget overlay={overlay} value={value} svgScale={svgScale} crop={crop} />;
  }

  // All other overlays are centered on their `position` point
  const pos = overlay.position;
  return (
    <div
      style={{
        position: 'absolute',
        left:      `${(pos.x / 500) * 100}%`,
        top:       `${((pos.y - crop.y) / crop.h) * 100}%`,
        transform: 'translate(-50%, -50%)',
        zIndex:    10,
      }}
    >
      {overlay.type === 'value'  && <ValueLabelOverlayWidget overlay={overlay} value={value} />}
      {overlay.type === 'gauge'  && <GaugeOverlayWidget      overlay={overlay} value={value} />}
      {overlay.type === 'level'  && <LevelOverlayWidget      overlay={overlay} value={value} />}
      {overlay.type === 'status' && <StatusOverlayWidget     overlay={overlay} value={value} />}
    </div>
  );
}
