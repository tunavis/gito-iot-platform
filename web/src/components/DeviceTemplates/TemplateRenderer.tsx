'use client';

/**
 * TemplateRenderer
 *
 * Renders a device illustration (SVG) with live telemetry overlays.
 *
 * Each template defines a CROP that trims empty vertical space from the 500×400 viewBox.
 * The container aspect-ratio and overlay y-positions are both derived from the crop so
 * they stay perfectly aligned at any container width.
 *
 * Coordinate system (x unchanged, y adjusted for crop):
 *   left = (x / 500) * 100%
 *   top  = ((y - crop.y) / crop.h) * 100%
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

/** Template props — telemetry is optional, used by templates that render data-driven fills */
export interface TemplateProps {
  width: number;
  height: number;
  telemetry?: Record<string, number | string | null>;
}

const TEMPLATE_MAP: Record<TemplateConfig['template'], React.FC<TemplateProps>> = {
  water_tank:   WaterTankTemplate,
  water_meter:  WaterMeterTemplate,
  pump:         PumpTemplate,
  generator:    GeneratorTemplate,
  solar_system: SolarTemplate,
  hvac_unit:    HvacTemplate,
};

/** Crops remove empty vertical padding from the 500×400 viewBox. */
interface ViewBoxCrop { y: number; h: number; }

const TEMPLATE_CROPS: Record<TemplateConfig['template'], ViewBoxCrop> = {
  water_tank:   { y: 45,  h: 335 },  // content: inlet cap at top ~y45, base ~y380
  water_meter:  { y: 80,  h: 215 },  // content: pipe top ~y80, pipe bottom ~y295
  pump:         { y: 70,  h: 260 },  // content: motor top ~y70, base bottom ~y330
  generator:    { y: 45,  h: 270 },  // content: exhaust top ~y45, frame bottom ~y315
  solar_system: { y: 30,  h: 310 },  // content: panel label ~y30, battery label ~y340
  hvac_unit:    { y: 60,  h: 325 },  // content: duct top ~y60, label bottom ~y385
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

  const crop = TEMPLATE_CROPS[config.template] ?? { y: 0, h: 400 };

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ aspectRatio: `500 / ${crop.h}`, overflow: 'hidden' }}
    >
      {/* Layer 1: SVG illustration — cropped viewBox removes empty vertical space */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 ${crop.y} 500 ${crop.h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <Template width={500} height={400} telemetry={telemetry} />
      </svg>

      {/* Layer 2: Live telemetry overlays */}
      {config.overlays.map((overlay, i) => (
        <OverlayWidget
          key={`${overlay.metric}-${i}`}
          overlay={overlay}
          value={telemetry[overlay.metric] ?? null}
          svgScale={svgScale}
          crop={crop}
        />
      ))}
    </div>
  );
}