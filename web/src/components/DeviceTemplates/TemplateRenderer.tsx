'use client';

/**
 * TemplateRenderer
 *
 * Renders a device illustration (SVG) with live values etched into the
 * template's declared display slots (see types.ts — v2 slot contract).
 *
 * - Slot values are SVG <text>: they scale losslessly with the artwork and
 *   can never cover it, because the artwork reserved those regions by design.
 * - One optional status pill renders in the container's top-right corner.
 * - No other HTML floats over the illustration.
 *
 * Each template defines a CROP that trims empty vertical space from the
 * 500×400 viewBox.
 */

import React from 'react';
import type { TemplateConfig, ValueSlot } from './types';
import StatusPill from './overlays/StatusOverlay';
import { OfflineBadge } from './OfflineBadge';
import { useSmoothed } from './primitives';
import { WaterTankTemplate,  slots as waterTankSlots }  from './templates/WaterTankTemplate';
import { WaterMeterTemplate, slots as waterMeterSlots } from './templates/WaterMeterTemplate';
import { PumpTemplate,       slots as pumpSlots }       from './templates/PumpTemplate';
import { GeneratorTemplate,  slots as generatorSlots }  from './templates/GeneratorTemplate';
import { SolarTemplate,      slots as solarSlots }      from './templates/SolarTemplate';
import { HvacTemplate,       slots as hvacSlots }       from './templates/HvacTemplate';

/** Template props — telemetry drives all motion; templates render artwork only */
export interface TemplateProps {
  width: number;
  height: number;
  telemetry?: Record<string, number | string | null>;
  deviceStatus?: 'online' | 'offline' | 'unknown';
}

const TEMPLATE_MAP: Record<TemplateConfig['template'], {
  Component: React.FC<TemplateProps>;
  slots: Record<string, ValueSlot>;
}> = {
  water_tank:   { Component: WaterTankTemplate,  slots: waterTankSlots },
  water_meter:  { Component: WaterMeterTemplate, slots: waterMeterSlots },
  pump:         { Component: PumpTemplate,       slots: pumpSlots },
  generator:    { Component: GeneratorTemplate,  slots: generatorSlots },
  solar_system: { Component: SolarTemplate,      slots: solarSlots },
  hvac_unit:    { Component: HvacTemplate,       slots: hvacSlots },
};

/** Crops remove empty vertical padding from the 500×400 viewBox. */
interface ViewBoxCrop { y: number; h: number; }

const TEMPLATE_CROPS: Record<TemplateConfig['template'], ViewBoxCrop> = {
  water_tank:   { y: 45,  h: 335 },
  water_meter:  { y: 80,  h: 215 },
  pump:         { y: 70,  h: 260 },
  generator:    { y: 45,  h: 270 },
  solar_system: { y: 30,  h: 310 },
  hvac_unit:    { y: 60,  h: 325 },
};

function formatValue(val: number | string): string {
  if (typeof val !== 'number') return String(val);
  if (Math.abs(val) >= 10000) return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(val) >= 100)   return val.toFixed(1);
  if (Math.abs(val) >= 10)    return val.toFixed(1);
  return val.toFixed(2);
}

/** One live value etched into a display slot — smoothed, autoscaled to fit */
function SlotValue({ slot, value, unit, paused }: {
  slot: ValueSlot;
  value: number | string;
  unit?: string;
  paused: boolean;
}) {
  const numeric = typeof value === 'number';
  const smoothed = useSmoothed(numeric ? (value as number) : 0, 500);
  const text = numeric ? formatValue(smoothed) : String(value);
  const fontSize = slot.fontSize ?? 14;
  // Mono glyphs ≈ 0.62em wide; shrink font so value + unit fit the slot width
  const unitLen = unit ? unit.length * 0.75 + 0.5 : 0;
  const estWidth = (text.length + unitLen) * fontSize * 0.62;
  const fitted = estWidth > slot.width ? fontSize * (slot.width / estWidth) : fontSize;
  const color = slot.color ?? '#f1f5f9';

  return (
    <text
      x={slot.x} y={slot.y}
      textAnchor="middle" dominantBaseline="middle"
      style={{
        fill: color,
        fontSize: fitted,
        fontWeight: 700,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        ...(slot.glow && !paused ? { filter: `drop-shadow(0 0 ${fitted * 0.35}px ${slot.glow})` } : {}),
      }}
    >
      {text}
      {unit && (
        <tspan dx={fitted * 0.18} style={{ fontSize: fitted * 0.62, fontWeight: 500, fillOpacity: 0.75 }}>
          {unit}
        </tspan>
      )}
    </text>
  );
}

interface TemplateRendererProps {
  config: TemplateConfig;
  /** Live telemetry values keyed by metric name */
  telemetry: Record<string, number | string | null>;
  deviceStatus?: 'online' | 'offline' | 'unknown';
}

export default function TemplateRenderer({ config, telemetry, deviceStatus }: TemplateRendererProps) {
  const entry = TEMPLATE_MAP[config.template];
  if (!entry) return null;
  const { Component, slots } = entry;

  const crop = TEMPLATE_CROPS[config.template] ?? { y: 0, h: 400 };
  const isOffline = deviceStatus === 'offline';
  const statusClass = isOffline ? 'device-template--offline' : 'device-template--online';
  const statusValue = config.status ? telemetry[config.status.metric] : null;

  return (
    <div
      className={`relative w-full ${statusClass}`}
      style={{ aspectRatio: `500 / ${crop.h}`, overflow: 'hidden' }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 ${crop.y} 500 ${crop.h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <g className="device-template-content">
          <Component width={500} height={400} telemetry={telemetry} deviceStatus={deviceStatus} />
          {/* Live values etched into the template's display slots */}
          {(config.bindings ?? []).map(({ slot, metric, unit }) => {
            const def = slots[slot];
            const value = telemetry[metric];
            if (!def || value === null || value === undefined) return null;
            return <SlotValue key={slot} slot={def} value={value} unit={unit} paused={isOffline} />;
          })}
        </g>
        {isOffline && (
          <OfflineBadge crop={{ x: 0, y: crop.y, w: 500, h: crop.h }} />
        )}
      </svg>

      {/* Corner status pill — reserved space, never over the artwork */}
      {config.status && statusValue !== null && statusValue !== undefined && (
        <div style={{ position: 'absolute', top: 6, right: 8, zIndex: 10 }}>
          <StatusPill
            value={statusValue}
            trueLabel={config.status.trueLabel}
            falseLabel={config.status.falseLabel}
          />
        </div>
      )}
    </div>
  );
}
