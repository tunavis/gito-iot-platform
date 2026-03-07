/**
 * resolveTemplate — Device Type → TemplateConfig
 *
 * Matches a device type's category string against known templates, then
 * builds an overlay config from the device's telemetry_schema.
 *
 * Resolution order (callers should respect this):
 *   1. deviceType.metadata?.visualization_config (explicit, DB-stored)
 *   2. resolveTemplate(category, schema)          (auto-detect)
 *   3. null                                       (fall back to metric grid)
 *
 * Metric slot matching:
 *   - Tries candidates in order: exact key match first, then substring match.
 *   - Slots that don't match any key in the schema are silently skipped.
 *   - This means partial template configs are valid and display gracefully.
 */

import type { TemplateConfig, Overlay, TelemetrySchema } from './types';

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
 * Excludes already-used keys to prevent duplicate overlays.
 */
function findKey(
  schema: TelemetrySchema,
  candidates: string[],
  used: Set<string> = new Set(),
): string | null {
  // Exact match
  for (const c of candidates) {
    if (c in schema && !used.has(c)) return c;
  }
  // Substring match
  const keys = Object.keys(schema).filter(k => !used.has(k));
  for (const c of candidates) {
    const hit = keys.find(k => k.toLowerCase().includes(c.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

// ─── Per-template overlay builders ───────────────────────────────────────────

function buildWaterTankOverlays(schema: TelemetrySchema): Overlay[] {
  const overlays: Overlay[] = [];
  const used = new Set<string>();

  const mark = (k: string) => { used.add(k); return k; };

  const levelKey = findKey(schema, ['tank_level', 'level', 'fill_level', 'volume_percent', 'fill', 'water_level'], used);
  if (levelKey) {
    overlays.push({ type: 'level', metric: mark(levelKey), position: { x: 267, y: 200 }, unit: schema[levelKey].unit, capacity: schema[levelKey].max ?? 100 });
  }

  const inletKey = findKey(schema, ['inlet_flow', 'flow_in', 'input_flow', 'inflow', 'flow_rate', 'flow'], used);
  if (inletKey) {
    overlays.push({ type: 'flow', metric: mark(inletKey), start: { x: 30, y: 95 }, end: { x: 182, y: 95 }, max: schema[inletKey].max, unit: schema[inletKey].unit });
  }

  const outletKey = findKey(schema, ['outlet_flow', 'flow_out', 'output_flow', 'outflow', 'discharge', 'flow'], used);
  if (outletKey) {
    overlays.push({ type: 'flow', metric: mark(outletKey), start: { x: 250, y: 358 }, end: { x: 435, y: 358 }, max: schema[outletKey].max, unit: schema[outletKey].unit });
  }

  const tempKey = findKey(schema, ['temperature', 'temp', 'water_temp', 'fluid_temp'], used);
  if (tempKey) {
    overlays.push({ type: 'value', metric: mark(tempKey), position: { x: 267, y: 300 }, unit: schema[tempKey].unit, label: schema[tempKey].description ?? 'Temp' });
  }

  const pumpKey = findKey(schema, ['pump_running', 'pump_status', 'pump_on', 'running', 'pump'], used);
  if (pumpKey) {
    overlays.push({ type: 'status', metric: mark(pumpKey), position: { x: 463, y: 358 }, trueLabel: 'Pump ON', falseLabel: 'Pump OFF' });
  }

  const pressureKey = findKey(schema, ['pressure', 'inlet_pressure', 'system_pressure'], used);
  if (pressureKey) {
    overlays.push({ type: 'value', metric: mark(pressureKey), position: { x: 390, y: 130 }, unit: schema[pressureKey].unit, label: 'Pressure' });
  }

  return overlays;
}

function buildWaterMeterOverlays(schema: TelemetrySchema): Overlay[] {
  const overlays: Overlay[] = [];
  const used = new Set<string>();
  const mark = (k: string) => { used.add(k); return k; };

  const flowKey = findKey(schema, ['flow_rate', 'flow', 'rate', 'velocity'], used);
  if (flowKey) {
    overlays.push({ type: 'flow', metric: mark(flowKey), start: { x: 30, y: 200 }, end: { x: 470, y: 200 }, max: schema[flowKey].max, unit: schema[flowKey].unit });
  }

  const volumeKey = findKey(schema, ['total_volume', 'cumulative', 'volume', 'total_flow', 'reading'], used);
  if (volumeKey) {
    overlays.push({ type: 'value', metric: mark(volumeKey), position: { x: 250, y: 200 }, unit: schema[volumeKey].unit, label: schema[volumeKey].description ?? 'Volume' });
  }

  const pressureKey = findKey(schema, ['pressure', 'line_pressure'], used);
  if (pressureKey) {
    overlays.push({ type: 'value', metric: mark(pressureKey), position: { x: 250, y: 245 }, unit: schema[pressureKey].unit, label: 'Pressure' });
  }

  const tempKey = findKey(schema, ['temperature', 'temp', 'fluid_temp'], used);
  if (tempKey) {
    overlays.push({ type: 'value', metric: mark(tempKey), position: { x: 250, y: 280 }, unit: schema[tempKey].unit, label: 'Temp' });
  }

  return overlays;
}

function buildPumpOverlays(schema: TelemetrySchema): Overlay[] {
  const overlays: Overlay[] = [];
  const used = new Set<string>();
  const mark = (k: string) => { used.add(k); return k; };

  const statusKey = findKey(schema, ['running', 'status', 'pump_running', 'active', 'on', 'enabled'], used);
  if (statusKey) {
    overlays.push({ type: 'status', metric: mark(statusKey), position: { x: 250, y: 165 }, trueLabel: 'Running', falseLabel: 'Stopped' });
  }

  const speedKey = findKey(schema, ['speed_rpm', 'rpm', 'speed', 'frequency'], used);
  if (speedKey) {
    overlays.push({ type: 'gauge', metric: mark(speedKey), position: { x: 250, y: 225 }, min: schema[speedKey].min ?? 0, max: schema[speedKey].max ?? 3000, unit: schema[speedKey].unit ?? 'RPM' });
  }

  const inletKey = findKey(schema, ['inlet_pressure', 'suction_pressure', 'inlet', 'suction'], used);
  if (inletKey) {
    overlays.push({ type: 'value', metric: mark(inletKey), position: { x: 75, y: 200 }, unit: schema[inletKey].unit, label: 'Inlet' });
  }

  const outletKey = findKey(schema, ['outlet_pressure', 'discharge_pressure', 'outlet', 'discharge'], used);
  if (outletKey) {
    overlays.push({ type: 'value', metric: mark(outletKey), position: { x: 425, y: 200 }, unit: schema[outletKey].unit, label: 'Outlet' });
  }

  const powerKey = findKey(schema, ['power_kw', 'power', 'current', 'kw', 'watts'], used);
  if (powerKey) {
    overlays.push({ type: 'value', metric: mark(powerKey), position: { x: 250, y: 330 }, unit: schema[powerKey].unit, label: 'Power' });
  }

  return overlays;
}

function buildGeneratorOverlays(schema: TelemetrySchema): Overlay[] {
  const overlays: Overlay[] = [];
  const used = new Set<string>();
  const mark = (k: string) => { used.add(k); return k; };

  const statusKey = findKey(schema, ['running', 'status', 'generating', 'active', 'on'], used);
  if (statusKey) {
    overlays.push({ type: 'status', metric: mark(statusKey), position: { x: 250, y: 95 }, trueLabel: 'Generating', falseLabel: 'Standby' });
  }

  const loadKey = findKey(schema, ['load_percent', 'load', 'load_kva', 'kva', 'capacity_percent'], used);
  if (loadKey) {
    overlays.push({ type: 'gauge', metric: mark(loadKey), position: { x: 250, y: 210 }, min: 0, max: schema[loadKey].max ?? 100, unit: schema[loadKey].unit ?? '%', size: 80 });
  }

  const voltKey = findKey(schema, ['voltage', 'volts', 'output_voltage', 'v_ac'], used);
  if (voltKey) {
    overlays.push({ type: 'value', metric: mark(voltKey), position: { x: 100, y: 315 }, unit: schema[voltKey].unit ?? 'V', label: 'Voltage' });
  }

  const freqKey = findKey(schema, ['frequency', 'freq', 'hz'], used);
  if (freqKey) {
    overlays.push({ type: 'value', metric: mark(freqKey), position: { x: 250, y: 315 }, unit: schema[freqKey].unit ?? 'Hz', label: 'Frequency' });
  }

  const fuelKey = findKey(schema, ['fuel_level', 'fuel', 'tank_level', 'level'], used);
  if (fuelKey) {
    overlays.push({ type: 'level', metric: mark(fuelKey), position: { x: 430, y: 210 }, capacity: schema[fuelKey].max ?? 100, unit: schema[fuelKey].unit ?? '%' });
  }

  const tempKey = findKey(schema, ['engine_temp', 'coolant_temp', 'temperature', 'temp'], used);
  if (tempKey) {
    overlays.push({ type: 'value', metric: mark(tempKey), position: { x: 160, y: 215 }, unit: schema[tempKey].unit ?? '°C', label: 'Engine Temp' });
  }

  return overlays;
}

function buildSolarOverlays(schema: TelemetrySchema): Overlay[] {
  const overlays: Overlay[] = [];
  const used = new Set<string>();
  const mark = (k: string) => { used.add(k); return k; };

  const pvPowerKey = findKey(schema, ['pv_power', 'solar_power', 'panel_power', 'dc_power', 'generation'], used);
  if (pvPowerKey) {
    overlays.push({ type: 'value', metric: mark(pvPowerKey), position: { x: 105, y: 145 }, unit: schema[pvPowerKey].unit ?? 'kW', label: 'PV Output' });
  }

  const irradianceKey = findKey(schema, ['irradiance', 'solar_irradiance', 'ghi', 'radiation', 'insolation'], used);
  if (irradianceKey) {
    overlays.push({ type: 'value', metric: mark(irradianceKey), position: { x: 105, y: 70 }, unit: schema[irradianceKey].unit ?? 'W/m²', label: 'Irradiance' });
  }

  const batteryKey = findKey(schema, ['battery_soc', 'battery', 'soc', 'charge', 'battery_level'], used);
  if (batteryKey) {
    overlays.push({ type: 'level', metric: mark(batteryKey), position: { x: 100, y: 325 }, capacity: schema[batteryKey].max ?? 100, unit: schema[batteryKey].unit ?? '%' });
  }

  const gridKey = findKey(schema, ['grid_power', 'grid_export', 'grid_import', 'grid', 'ac_power'], used);
  if (gridKey) {
    overlays.push({ type: 'flow', metric: mark(gridKey), start: { x: 350, y: 200 }, end: { x: 470, y: 200 }, max: schema[gridKey].max, unit: schema[gridKey].unit });
  }

  const inverterKey = findKey(schema, ['inverter_power', 'ac_output', 'output_power', 'power'], used);
  if (inverterKey) {
    overlays.push({ type: 'value', metric: mark(inverterKey), position: { x: 250, y: 200 }, unit: schema[inverterKey].unit ?? 'kW', label: 'AC Output' });
  }

  return overlays;
}

function buildHvacOverlays(schema: TelemetrySchema): Overlay[] {
  const overlays: Overlay[] = [];
  const used = new Set<string>();
  const mark = (k: string) => { used.add(k); return k; };

  const supplyTempKey = findKey(schema, ['supply_temp', 'supply_air_temp', 'discharge_temp', 'outlet_temp'], used);
  if (supplyTempKey) {
    overlays.push({ type: 'value', metric: mark(supplyTempKey), position: { x: 420, y: 140 }, unit: schema[supplyTempKey].unit ?? '°C', label: 'Supply' });
  }

  const returnTempKey = findKey(schema, ['return_temp', 'return_air_temp', 'inlet_temp', 'room_temp', 'temperature', 'temp'], used);
  if (returnTempKey) {
    overlays.push({ type: 'value', metric: mark(returnTempKey), position: { x: 80, y: 140 }, unit: schema[returnTempKey].unit ?? '°C', label: 'Return' });
  }

  const airFlowKey = findKey(schema, ['air_flow', 'cfm', 'airflow', 'flow_rate', 'air_volume', 'fan_flow'], used);
  if (airFlowKey) {
    overlays.push({ type: 'flow', metric: mark(airFlowKey), start: { x: 50, y: 200 }, end: { x: 450, y: 200 }, max: schema[airFlowKey].max, unit: schema[airFlowKey].unit });
  }

  const loadKey = findKey(schema, ['compressor_load', 'load', 'capacity', 'duty_cycle', 'compressor'], used);
  if (loadKey) {
    overlays.push({ type: 'gauge', metric: mark(loadKey), position: { x: 250, y: 265 }, min: 0, max: schema[loadKey].max ?? 100, unit: schema[loadKey].unit ?? '%', size: 72 });
  }

  const statusKey = findKey(schema, ['cooling_active', 'heating_active', 'running', 'status', 'mode', 'active'], used);
  if (statusKey) {
    overlays.push({ type: 'status', metric: mark(statusKey), position: { x: 250, y: 155 }, trueLabel: 'Cooling', falseLabel: 'Idle' });
  }

  return overlays;
}

// ─── Public API ───────────────────────────────────────────────────────────────

const BUILDERS: Record<TemplateConfig['template'], (schema: TelemetrySchema) => Overlay[]> = {
  water_tank:   buildWaterTankOverlays,
  water_meter:  buildWaterMeterOverlays,
  pump:         buildPumpOverlays,
  generator:    buildGeneratorOverlays,
  solar_system: buildSolarOverlays,
  hvac_unit:    buildHvacOverlays,
};

/**
 * Resolve a TemplateConfig for a device type.
 *
 * @param category      - device type category string (e.g. "water_tank", "pump")
 * @param schema        - device type telemetry_schema
 * @param explicitConfig - optional override stored in deviceType.metadata.visualization_config
 * @returns TemplateConfig or null if no matching template
 */
export function resolveTemplate(
  category: string | undefined | null,
  schema: TelemetrySchema = {},
  explicitConfig?: TemplateConfig,
): TemplateConfig | null {
  // Explicit config wins — allows future admin UI customisation without code changes
  if (explicitConfig) return explicitConfig;

  if (!category) return null;

  const templateName = matchCategory(category);
  if (!templateName) return null;

  const overlays = BUILDERS[templateName](schema);

  // A template with zero matching overlays is still valid — shows illustration only
  return { template: templateName, overlays };
}
