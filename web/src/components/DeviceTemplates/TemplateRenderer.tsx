'use client';

/**
 * TemplateRenderer
 *
 * Renders a device illustration (SVG) with live telemetry overlays.
 *
 * Layout:
 *   - Container: width=100%, aspect-ratio 5:4 (matches viewBox 500x400)
 *   - SVG illustration: absolute inset-0, fills container
 *   - Overlays: absolutely positioned using % coords derived from SVG space
 *
 * Coordinate system:
 *   overlay.position = SVG viewBox units (0–500 x, 0–400 y)
 *   DOM position     = (x/500)*100% left, (y/400)*100% top
 *
 * FlowOverlay requires svgScale (containerWidth/500) to compute pixel length.
 * This is obtained via ResizeObserver on the container div.
 */

import React, { useRef, useState, useEffect } from 'react';
import type { TemplateConfig } from './types';
import OverlayWidget from './overlays/OverlayWidget';
import { WaterTankTemplate  } from './templates/WaterTankTemplate';
import { WaterMeterTemplate } from './templates/WaterMeterTemplate';
import { PumpTemplate       } from './templates/PumpTemplate';
import { GeneratorTemplate  } from './templates/GeneratorTemplate';
import { SolarTemplate      } from './templates/SolarTemplate';
import { HvacTemplate       } from './templates/HvacTemplate';

const TEMPLATE_MAP: Record<TemplateConfig['template'], React.FC<{ width: number; height: number }>> = {
  water_tank:   WaterTankTemplate,
  water_meter:  WaterMeterTemplate,
  pump:         PumpTemplate,
  generator:    GeneratorTemplate,
  solar_system: SolarTemplate,
  hvac_unit:    HvacTemplate,
};

interface TemplateRendererProps {
  config: TemplateConfig;
  /** Live telemetry values keyed by metric name */
  telemetry: Record<string, number | string | null>;
}

export default function TemplateRenderer({ config, telemetry }: TemplateRendererProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const [svgScale, setSvgScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 500;
      setSvgScale(w / 500);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const Template = TEMPLATE_MAP[config.template];
  if (!Template) return null;

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ aspectRatio: '5 / 4', overflow: 'hidden' }}
    >
      {/* Layer 1: Static SVG illustration */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 500 400"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <Template width={500} height={400} />
      </svg>

      {/* Layer 2: Live telemetry overlays */}
      {config.overlays.map((overlay, i) => (
        <OverlayWidget
          key={`${overlay.metric}-${i}`}
          overlay={overlay}
          value={telemetry[overlay.metric] ?? null}
          svgScale={svgScale}
        />
      ))}
    </div>
  );
}
