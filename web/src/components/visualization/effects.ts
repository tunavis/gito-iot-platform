/**
 * Effect Style System
 *
 * Defines visual styling per flow medium.
 * Effect only changes appearance — animation logic is identical for all effects.
 *
 * Effects:
 *   water  → blue, strong dash, solid feel
 *   gas    → lime green, wide gaps, light opacity
 *   energy → amber/orange, tight dash, glow
 *   air    → slate, very subtle, thin lines
 */

import type { FlowEffect, FlowDirection, MetricCategory, MetricDefinition } from './types';

export interface EffectStyle {
  stroke: string;
  glowColor?: string;
  dashWidth: number;
  gapWidth: number;
  baseOpacity: number;
  /** Total dash pattern length = dashWidth + gapWidth */
  readonly patternLength: number;
}

export const EFFECT_STYLES: Record<FlowEffect, Omit<EffectStyle, 'patternLength'>> = {
  water: {
    stroke: '#3b82f6',       // blue-500
    dashWidth: 8,
    gapWidth: 6,
    baseOpacity: 0.65,
  },
  gas: {
    stroke: '#a3e635',       // lime-400
    dashWidth: 5,
    gapWidth: 10,
    baseOpacity: 0.45,
  },
  energy: {
    stroke: '#f59e0b',       // amber-400
    glowColor: '#fcd34d',    // amber-300 glow
    dashWidth: 6,
    gapWidth: 4,
    baseOpacity: 0.75,
  },
  air: {
    stroke: '#cbd5e1',       // slate-300
    dashWidth: 3,
    gapWidth: 12,
    baseOpacity: 0.35,
  },
};

export function getEffectStyle(effect: FlowEffect): EffectStyle {
  const base = EFFECT_STYLES[effect];
  return { ...base, patternLength: base.dashWidth + base.gapWidth };
}

// ─── Metric Classification ────────────────────────────────────────────────────

/** Keywords that indicate each metric category (checked against key.toLowerCase()) */
const FLOW_KEYWORDS   = ['flow', 'rate', 'throughput', 'discharge', 'flux'];
const LEVEL_KEYWORDS  = ['level', 'fill', 'tank', 'volume', 'capacity', 'depth', 'battery', 'charge'];
const STATE_KEYWORDS  = ['state', 'status', 'mode', 'alarm', 'active', 'enable', 'fault', 'flag'];

/** Keywords that map to a flow effect (checked in order) */
const WATER_KEYWORDS  = ['water', 'hydro', 'liquid', 'coolant', 'sewage', 'drain'];
const GAS_KEYWORDS    = ['gas', 'methane', 'ch4', 'lpg', 'natural', 'air', 'steam', 'vapour', 'vapor'];
const ENERGY_KEYWORDS = ['power', 'energy', 'watt', 'kw', 'electric', 'volt', 'current', 'amp'];

/** Units that imply water flow */
const WATER_UNITS = ['l/min', 'l/h', 'lph', 'lpm', 'm³', 'm3', 'gal', 'gpm', 'gph', 'ml'];
/** Units that imply electrical energy */
const ENERGY_UNITS = ['w', 'kw', 'mw', 'kwh', 'mwh', 'a', 'v', 'va', 'var'];

function matchesAny(str: string, keywords: string[]): boolean {
  return keywords.some(kw => str.includes(kw));
}

/**
 * Infer a FlowEffect from the metric key and unit.
 * Falls back to 'water' for generic flow metrics.
 */
function inferEffect(key: string, unit = ''): FlowEffect {
  const k = key.toLowerCase();
  const u = unit.toLowerCase();

  if (matchesAny(k, ENERGY_KEYWORDS) || matchesAny(u, ENERGY_UNITS)) return 'energy';
  if (matchesAny(k, GAS_KEYWORDS)) return 'gas';
  if (matchesAny(k, WATER_KEYWORDS) || matchesAny(u, WATER_UNITS)) return 'water';

  return 'water'; // sensible default for unknown flow metrics
}

/**
 * Classify a single metric from a device type telemetry_schema field.
 *
 * Input is a raw schema entry:
 *   { type: "number", unit: "L/min", min: 0, max: 500 }
 *
 * Returns a MetricDefinition ready for MetricRenderer.
 */
export function classifyMetric(
  key: string,
  schema: { type?: string; unit?: string; description?: string; min?: number; max?: number } = {}
): MetricDefinition {
  const k = key.toLowerCase();
  const unit = schema.unit ?? '';
  const label = schema.description || undefined;

  // State metrics: string type OR state-like keywords
  if (schema.type === 'string' || schema.type === 'boolean' || matchesAny(k, STATE_KEYWORDS)) {
    return { category: 'state', unit, label };
  }

  // Level metrics
  if (matchesAny(k, LEVEL_KEYWORDS)) {
    return { category: 'level', unit, min: schema.min, max: schema.max ?? 100, label };
  }

  // Flow metrics
  if (matchesAny(k, FLOW_KEYWORDS)) {
    return {
      category: 'flow',
      unit,
      min: schema.min,
      max: schema.max,
      effect: inferEffect(key, unit),
      label,
    };
  }

  // Default: scalar
  return { category: 'scalar', unit, min: schema.min, max: schema.max, label };
}

/**
 * Build a MetricSchema from a device type telemetry_schema.
 * Falls back gracefully if schema is absent.
 */
export function buildMetricSchema(
  telemetrySchema: Record<string, { type?: string; unit?: string; min?: number; max?: number }> = {}
): Record<string, MetricDefinition> {
  return Object.fromEntries(
    Object.entries(telemetrySchema).map(([key, def]) => [key, classifyMetric(key, def)])
  );
}

/**
 * Infer a MetricDefinition for a metric key that has no schema entry.
 * Used for ad-hoc metrics sent by devices outside their declared schema.
 */
export function inferMetricDefinition(
  key: string,
  value: number | string | null
): MetricDefinition {
  if (typeof value === 'string') {
    return classifyMetric(key, { type: 'string' });
  }
  return classifyMetric(key, {});
}
