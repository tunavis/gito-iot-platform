export interface ClassificationRule {
  group: string;
  keywords: string[];
  dataType?: 'number' | 'string';
  isHero?: boolean;
}

export interface ClassifiedMetric {
  key: string;
  meta: Record<string, any>;
  group: string;
}

export interface ClassificationResult {
  hero: ClassifiedMetric | null;
  groups: Record<string, ClassifiedMetric[]>;
  ungrouped: ClassifiedMetric[];
}

export function classifyMetrics(
  schema: Record<string, any>,
  latestValues: Record<string, number | string | null>,
  rules: ClassificationRule[]
): ClassificationResult {
  const hero: ClassifiedMetric | null = null;
  const groups: Record<string, ClassifiedMetric[]> = {};
  const ungrouped: ClassifiedMetric[] = [];
  const classified = new Set<string>();

  // Build metric list from schema, falling back to latestValues
  const metricKeys = Object.keys(schema).length > 0
    ? Object.keys(schema)
    : Object.keys(latestValues);

  // Initialize groups
  for (const rule of rules) {
    if (!rule.isHero) {
      groups[rule.group] = [];
    }
  }

  let foundHero: ClassifiedMetric | null = null;

  // First pass: find hero
  const heroRule = rules.find(r => r.isHero);
  if (heroRule) {
    if (heroRule.keywords.length > 0) {
      // Match by keywords
      for (const key of metricKeys) {
        const k = key.toLowerCase();
        const meta = schema[key] || {};
        const val = latestValues[key];
        if (heroRule.keywords.some(kw => k.includes(kw))) {
          // Skip string values for hero unless rule specifies string type
          if (heroRule.dataType === 'string' || typeof val === 'number' || meta.type === 'float' || meta.type === 'int' || meta.type === 'number') {
            foundHero = { key, meta, group: 'HERO' };
            classified.add(key);
            break;
          }
        }
      }
    }
    // If no keyword match, use first numeric metric as hero
    if (!foundHero) {
      for (const key of metricKeys) {
        const meta = schema[key] || {};
        const val = latestValues[key];
        if (typeof val === 'number' || meta.type === 'float' || meta.type === 'int' || meta.type === 'number') {
          if (meta.type !== 'string' && meta.type !== 'boolean') {
            foundHero = { key, meta, group: 'HERO' };
            classified.add(key);
            break;
          }
        }
      }
    }
  }

  // Second pass: classify remaining metrics into groups
  for (const key of metricKeys) {
    if (classified.has(key)) continue;
    const k = key.toLowerCase();
    const meta = schema[key] || {};
    const val = latestValues[key];
    let matched = false;

    for (const rule of rules) {
      if (rule.isHero) continue;

      // Check data type filter
      if (rule.dataType === 'number' && typeof val !== 'number' && meta.type !== 'float' && meta.type !== 'int') continue;
      if (rule.dataType === 'string' && typeof val !== 'string' && meta.type !== 'string') continue;

      // Check keyword match
      if (rule.keywords.some(kw => k.includes(kw))) {
        if (!groups[rule.group]) groups[rule.group] = [];
        groups[rule.group].push({ key, meta, group: rule.group });
        classified.add(key);
        matched = true;
        break;
      }
    }

    if (!matched) {
      ungrouped.push({ key, meta, group: 'OTHER' });
    }
  }

  return { hero: foundHero, groups, ungrouped };
}

// ---- Category-specific rule sets ----

export const METER_RULES: ClassificationRule[] = [
  { group: 'HERO', keywords: ['power', 'flow', 'consumption', 'rate', 'demand', 'active_power', 'flow_rate', 'water_flow'], isHero: true },
  { group: 'ELECTRICAL', keywords: ['voltage', 'current', 'frequency', 'power_factor', 'phase', 'impedance', 'reactive', 'apparent'] },
  { group: 'CUMULATIVE', keywords: ['energy', 'kwh', 'total', 'volume', 'accumulated', 'counter', 'wh', 'consumed'] },
  { group: 'PHYSICAL', keywords: ['pressure', 'temperature', 'temp', 'level', 'depth'] },
  { group: 'SYSTEM', keywords: ['battery', 'signal', 'rssi', 'firmware', 'uptime'] },
];

export const SENSOR_RULES: ClassificationRule[] = [
  { group: 'HERO', keywords: [], isHero: true },
  { group: 'ENVIRONMENT', keywords: ['temperature', 'temp', 'humidity', 'pressure', 'co2', 'voc', 'pm25', 'pm10', 'noise', 'light', 'lux', 'uv', 'moisture', 'soil', 'wind', 'rain', 'air_quality', 'dew_point'] },
  { group: 'DEVICE HEALTH', keywords: ['battery', 'signal', 'rssi', 'snr', 'voltage', 'uptime'] },
];

export const GATEWAY_RULES: ClassificationRule[] = [
  { group: 'HERO', keywords: ['connected_devices', 'uptime', 'throughput', 'bandwidth'], isHero: true },
  { group: 'CONNECTIVITY', keywords: ['connected', 'uptime', 'throughput', 'bandwidth'] },
  { group: 'NETWORK', keywords: ['packets', 'signal', 'rssi', 'latency', 'dropped', 'errors', 'tx', 'rx', 'transmitted', 'received'] },
  { group: 'RESOURCES', keywords: ['cpu', 'memory', 'disk', 'ram', 'load', 'usage', 'swap', 'storage'] },
  { group: 'INFO', keywords: ['firmware', 'version', 'model'], dataType: 'string' },
];

export const CONTROLLER_RULES: ClassificationRule[] = [
  { group: 'CONTROL LOOP', keywords: ['pv', 'process_value', 'measured', 'actual', 'sp', 'setpoint', 'set_point', 'target', 'error', 'deviation'] },
  { group: 'OUTPUT', keywords: ['output', 'control_output', 'cv', 'duty', 'duty_cycle', 'valve_position'] },
  { group: 'MODE & TUNING', keywords: ['mode', 'control_mode', 'auto_manual', 'kp', 'ki', 'kd', 'gain', 'integral', 'derivative'] },
];

export const ACTUATOR_RULES: ClassificationRule[] = [
  { group: 'STATE', keywords: ['state', 'status', 'mode', 'valve_state', 'switch', 'relay', 'enabled', 'running'] },
  { group: 'POSITION', keywords: ['position', 'setpoint', 'angle', 'opening', 'level', 'travel', 'stroke'] },
  { group: 'ELECTRICAL', keywords: ['current', 'voltage', 'power', 'watt'] },
  { group: 'OPERATIONAL', keywords: ['cycles', 'runtime', 'hours', 'count', 'operations', 'wear'] },
];

export const TRACKER_RULES: ClassificationRule[] = [
  { group: 'POSITION', keywords: ['latitude', 'longitude', 'lat', 'lng', 'lon', 'altitude', 'alt', 'elevation'] },
  { group: 'MOTION', keywords: ['speed', 'heading', 'bearing', 'course', 'velocity', 'acceleration', 'odometer'] },
  { group: 'HEALTH', keywords: ['battery', 'satellites', 'signal', 'rssi', 'hdop', 'pdop', 'fix'] },
];
