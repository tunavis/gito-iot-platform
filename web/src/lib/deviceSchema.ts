/**
 * Device telemetry-schema helpers.
 *
 * Lifted out of `dashboard/alert-rules/page.tsx` because the rule canvas needs
 * exactly the same metric list the rule forms offer. Two copies would let the
 * dropdown on the canvas and the dropdown in the form drift apart.
 */

export interface Device {
  id: string;
  name: string;
  device_type_id?: string;
}

export interface DeviceType {
  id: string;
  name: string;
  data_model?: Array<{ name: string; type?: string; unit?: string; description?: string }>;
  telemetry_schema?: Record<string, { type?: string; unit?: string; description?: string }>;
}

export type SchemaField = {
  type?: string;
  unit?: string;
  description?: string;
  min?: number;
  max?: number;
};
export type Schema = Record<string, SchemaField>;

const NUMERIC_FIELD_TYPES = new Set(['float', 'integer', 'number']);

export function getSchemaForDevice(
  deviceId: string,
  devices: Device[],
  deviceTypes: DeviceType[],
): Schema {
  const schemaFromType = (dt: DeviceType): Schema => {
    if (dt.telemetry_schema) return dt.telemetry_schema as Schema;
    if (dt.data_model && Array.isArray(dt.data_model)) {
      return Object.fromEntries(
        dt.data_model
          .filter((f) => f.name)
          .map((f) => [f.name, { type: f.type, unit: f.unit, description: f.description }]),
      );
    }
    return {};
  };

  if (!deviceId) {
    // Global rule: merge all schemas
    const merged: Schema = {};
    deviceTypes.forEach((dt) => Object.assign(merged, schemaFromType(dt)));
    return merged;
  }
  const device = devices.find((d) => d.id === deviceId);
  if (!device?.device_type_id) return {};
  const dt = deviceTypes.find((t) => t.id === device.device_type_id);
  return dt ? schemaFromType(dt) : {};
}

export function getMetricsForDevice(
  deviceId: string,
  devices: Device[],
  deviceTypes: DeviceType[],
  numericOnly = false,
): string[] {
  const schema = getSchemaForDevice(deviceId, devices, deviceTypes);
  const keys = Object.keys(schema).sort();
  if (!numericOnly) return keys;
  return keys.filter((k) => {
    const type = schema[k]?.type;
    return !type || NUMERIC_FIELD_TYPES.has(type); // include unknown-type fields (may be numeric)
  });
}
