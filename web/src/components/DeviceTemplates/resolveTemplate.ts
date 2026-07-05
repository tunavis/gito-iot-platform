/**
 * resolveTemplate — Device Type → TemplateConfig
 *
 * Matches a device type's category string against known templates, then binds
 * schema metrics to the template's declared display slots (see types.ts for
 * the v2 slot contract). Metrics that don't bind to a slot fall through to the
 * side metric grid — values never float over the artwork.
 *
 * Resolution order (callers should respect this):
 *   1. deviceType.metadata?.visualization_config (explicit, DB-stored)
 *   2. resolveTemplate(category, schema)          (auto-detect)
 *   3. null                                       (fall back to metric grid)
 */

import type { TemplateConfig, SlotBinding, StatusBinding, TelemetrySchema } from './types';

// ─── Category → Template mapping ─────────────────────────────────────────────

const CATEGORY_MAP: Array<{ keywords: string[]; template: TemplateConfig['template'] }> = [
  { keywords: ['water_tank', 'tank', 'reservoir', 'storage', 'cistern', 'vessel'],   template: 'water_tank'   },
  { keywords: ['water_meter', 'flow_meter', 'meter', 'utility', 'flowmeter'],        template: 'water_meter'  },
  { keywords: ['pump', 'booster', 'centrifugal', 'submersible'],                     template: 'pump'         },
  { keywords: ['generator', 'genset', 'ups', 'diesel', 'alternator'],                template: 'generator'    },
  { keywords: ['solar', 'pv', 'photovoltaic', 'renewable', 'inverter'],              template: 'solar_system' },
  { keywords: ['hvac', 'ahu', 'chiller', 'heat_pump', 'aircon', 'cooling', 'heating', 'ventilation'], template: 'hvac_unit' },
];

function matchCategory(category: string): TemplateConfig['template'] | null {
  const c = category.toLowerCase().replace(/[\s-]/g, '_');
  for (const { keywords, template } of CATEGORY_MAP) {
    if (keywords.some(kw => c.includes(kw))) return template;
  }
  return null;
}

// ─── Schema key lookup ────────────────────────────────────────────────────────

/**
 * Find the best matching key in schema for a set of candidate names.
 * Tries exact match first, then substring match.
 * Excludes already-used keys to prevent duplicate bindings.
 */
function findKey(
  schema: TelemetrySchema,
  candidates: string[],
  used: Set<string> = new Set(),
): string | null {
  for (const c of candidates) {
    if (c in schema && !used.has(c)) return c;
  }
  const keys = Object.keys(schema).filter(k => !used.has(k));
  for (const c of candidates) {
    const hit = keys.find(k => k.toLowerCase().includes(c.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

// ─── Slot-binding builders ────────────────────────────────────────────────────
// Each entry: slot name → candidate metric keys. Bindings are emitted only for
// slots whose candidates match the schema; status is a separate boolean pill.

interface BuilderSpec {
  slots: Record<string, string[]>;
  status?: { keys: string[]; trueLabel: string; falseLabel: string };
}

const BUILDER_SPECS: Record<TemplateConfig['template'], BuilderSpec> = {
  water_tank: {
    slots: {
      level: ['tank_level', 'level', 'fill_level', 'volume_percent', 'fill', 'water_level'],
    },
    status: { keys: ['pump_running', 'pump_status', 'pump_on', 'running', 'pump'], trueLabel: 'Pump ON', falseLabel: 'Pump OFF' },
  },
  water_meter: {
    slots: {
      flow:     ['flow_rate', 'flow', 'rate', 'velocity'],
      register: ['total_volume', 'cumulative', 'volume', 'total_flow', 'reading'],
    },
  },
  pump: {
    slots: {},
    status: { keys: ['running', 'status', 'pump_running', 'active', 'on', 'enabled'], trueLabel: 'Running', falseLabel: 'Stopped' },
  },
  generator: {
    slots: {
      load:      ['load_percent', 'load', 'load_kva', 'kva', 'capacity_percent'],
      voltage:   ['voltage', 'volts', 'output_voltage', 'v_ac'],
      frequency: ['frequency', 'freq', 'hz'],
      fuel:      ['fuel_level', 'fuel', 'tank_level', 'level'],
    },
    status: { keys: ['running', 'status', 'generating', 'active', 'on'], trueLabel: 'Generating', falseLabel: 'Standby' },
  },
  solar_system: {
    slots: {
      ac:      ['inverter_power', 'ac_output', 'output_power', 'ac_power', 'power'],
      battery: ['battery_soc', 'battery', 'soc', 'charge', 'battery_level'],
    },
  },
  hvac_unit: {
    slots: {
      load: ['compressor_load', 'load', 'capacity', 'duty_cycle', 'compressor'],
    },
    status: { keys: ['cooling_active', 'heating_active', 'running', 'status', 'mode', 'active'], trueLabel: 'Cooling', falseLabel: 'Idle' },
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a TemplateConfig for a device type.
 *
 * @param category       - device type category string (e.g. "water_tank", "pump")
 * @param schema         - device type telemetry_schema
 * @param explicitConfig - optional override stored in deviceType.metadata.visualization_config
 * @returns TemplateConfig or null if no matching template
 */
export function resolveTemplate(
  category: string | undefined | null,
  schema: TelemetrySchema = {},
  explicitConfig?: TemplateConfig,
): TemplateConfig | null {
  if (explicitConfig) return explicitConfig;
  if (!category) return null;

  const templateName = matchCategory(category);
  if (!templateName) return null;

  const spec = BUILDER_SPECS[templateName];
  const used = new Set<string>();
  const bindings: SlotBinding[] = [];

  for (const [slot, candidates] of Object.entries(spec.slots)) {
    const key = findKey(schema, candidates, used);
    if (key) {
      used.add(key);
      bindings.push({ slot, metric: key, unit: schema[key].unit });
    }
  }

  let status: StatusBinding | undefined;
  if (spec.status) {
    const key = findKey(schema, spec.status.keys, used);
    if (key) {
      used.add(key);
      status = { metric: key, trueLabel: spec.status.trueLabel, falseLabel: spec.status.falseLabel };
    }
  }

  return {
    template: templateName,
    bindings,
    status,
    boundMetrics: [...used],
  };
}
