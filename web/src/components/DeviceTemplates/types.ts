/**
 * DeviceTemplates — Type System
 *
 * Rendering contract (v2 — display slots):
 *   - Templates own ALL artwork and motion (pipes, dials, liquid, LEDs).
 *   - Live values render ONLY inside `ValueSlot` regions the template declares —
 *     display areas designed into the artwork (a gauge face, a control panel).
 *     They are SVG text, so they scale losslessly and can never cover artwork.
 *   - One optional status pill renders in the container corner (reserved space).
 *   - Every other metric falls through to the metric grid beside the illustration.
 *
 * Resolution order (in DeviceVisualization):
 *   1. deviceType.metadata?.visualization_config  → explicit DB config
 *   2. resolveTemplate(category, schema)           → auto-detect by category + schema
 *   3. null                                        → metric grid only
 */

export type TemplateName =
  | 'water_tank'
  | 'water_meter'
  | 'pump'
  | 'generator'
  | 'solar_system'
  | 'hvac_unit'
  | 'valve'
  | 'motor';

/**
 * A display region designed into the template artwork.
 * Declared by each template module (`export const slots`) in SVG coordinates
 * (viewBox 0 0 500 400). `x,y` is the CENTER of the value text.
 */
export interface ValueSlot {
  x: number;
  y: number;
  /** Max text width in SVG units — the renderer shrinks the font to fit */
  width: number;
  fontSize?: number;
  /** Value text color (default #f1f5f9 — light, for dark glass faces) */
  color?: string;
  /** Optional glow color behind the digits (accent tint) */
  glow?: string;
}

/** Binds a telemetry metric to a named slot in the template's slot map */
export interface SlotBinding {
  slot: string;
  metric: string;
  unit?: string;
}

/** Boolean state metric rendered as a corner status pill */
export interface StatusBinding {
  metric: string;
  trueLabel?: string;
  falseLabel?: string;
}

export interface TemplateConfig {
  template: TemplateName;
  /** Values rendered into the template's declared display slots */
  bindings: SlotBinding[];
  /** Optional corner status pill */
  status?: StatusBinding;
  /**
   * All metrics consumed by the illustration (slot bindings + status).
   * DeviceVisualization excludes these from the side metric grid; everything
   * else stays in the grid so every metric is always visible somewhere.
   */
  boundMetrics: string[];
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
