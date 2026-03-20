export const LEVEL_KEYS = ['tank_level', 'level', 'fill_level', 'volume_percent', 'fill', 'water_level', 'fuel_level'];
export const FLOW_KEYS = ['flow_rate', 'flow', 'flowrate', 'water_flow', 'rate', 'throughput'];
export const RPM_KEYS = ['rpm', 'speed', 'motor_speed', 'fan_speed', 'rotor_speed', 'pump_rpm'];
export const TEMP_KEYS = ['temperature', 'temp', 'supply_temp', 'return_temp', 'ambient_temp'];
export const HUMIDITY_KEYS = ['humidity', 'relative_humidity', 'rh'];
export const POWER_KEYS = ['power', 'watts', 'kw', 'load', 'output_power', 'active_power'];
export const PRESSURE_KEYS = ['pressure', 'psi', 'bar', 'inlet_pressure', 'outlet_pressure'];
export const MOISTURE_KEYS = ['moisture', 'soil_moisture', 'volumetric_water_content', 'vwc'];
export const POSITION_KEYS = ['position', 'valve_position', 'opening', 'percent_open'];
export const IRRADIANCE_KEYS = ['irradiance', 'solar_irradiance', 'ghi', 'radiation'];

/**
 * Search telemetry for the first matching key from candidates.
 * Returns the numeric value or fallback.
 */
export function resolveNumeric(
  telemetry: Record<string, number | string | null> | undefined,
  keys: string[],
  fallback = 0
): number {
  if (!telemetry) return fallback;
  for (const k of keys) {
    const v = telemetry[k];
    if (v !== null && v !== undefined && !isNaN(Number(v))) return Number(v);
  }
  return fallback;
}