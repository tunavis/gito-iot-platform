/**
 * DeviceTemplates — Type System
 *
 * All overlay coordinates use SVG space (viewBox 0 0 500 400).
 * TemplateRenderer converts them to percentage-based positions for the DOM layer.
 *
 * Resolution order (in DeviceVisualization):
 *   1. deviceType.metadata?.visualization_config  → explicit DB config (future admin UI)
 *   2. resolveTemplate(category, schema)           → auto-detect by category + schema
 *   3. null                                        → fall back to metric grid
 */

export type TemplateName =
  | 'water_tank'
  | 'water_meter'
  | 'pump'
  | 'generator'
  | 'solar_system'
  | 'hvac_unit';

/** SVG coordinate (viewBox 0 0 500 400) */
export interface Point { x: number; y: number; }

interface BaseOverlay {
  /** Key into the live telemetry record */
  metric: string;
  /** Optional display label override */
  label?: string;
}

/** Numeric value + unit at a fixed SVG position */
export interface ValueLabelOverlay extends BaseOverlay {
  type: 'value';
  position: Point;
  unit?: string;
}

/** Arc gauge for a bounded numeric metric */
export interface GaugeOverlay extends BaseOverlay {
  type: 'gauge';
  position: Point;
  min: number;
  max: number;
  unit?: string;
  /** Diameter in px — scales with container (default 72) */
  size?: number;
}

/** Animated FlowLine between two SVG points (reuses existing FlowLine component) */
export interface FlowOverlay extends BaseOverlay {
  type: 'flow';
  start: Point;
  end: Point;
  max?: number;
  unit?: string;
}

/** Vertical fill bar for level/battery/tank metrics */
export interface LevelOverlay extends BaseOverlay {
  type: 'level';
  position: Point;
  /** Absolute max value; if omitted the value is treated as 0–100 */
  capacity?: number;
  unit?: string;
  /** Bar width in px (default 18) */
  width?: number;
  /** Bar height in px (default 72) */
  height?: number;
}

/** Online/offline style status badge */
export interface StatusOverlay extends BaseOverlay {
  type: 'status';
  position: Point;
  trueLabel?: string;
  falseLabel?: string;
}

export type Overlay =
  | ValueLabelOverlay
  | GaugeOverlay
  | FlowOverlay
  | LevelOverlay
  | StatusOverlay;

export interface TemplateConfig {
  template: TemplateName;
  overlays: Overlay[];
}

/** Schema shape passed in from device type */
export type TelemetrySchemaEntry = {
  type?: string;
  unit?: string;
  min?: number;
  max?: number;
  description?: string;
};
export type TelemetrySchema = Record<string, TelemetrySchemaEntry>;
