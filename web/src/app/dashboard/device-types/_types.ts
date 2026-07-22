import { ProtocolConfig } from '@/components/ProtocolConfigForm';

export interface DataModelField {
  name: string;
  type: string;
  unit: string;
  description: string;
  min_value?: number;
  max_value?: number;
  required: boolean;
}

export interface DefaultSettings {
  heartbeat_interval: number;
  telemetry_interval: number;
  offline_threshold: number;
}

/** One byte-layout field in a declarative payload decoder. */
export interface DecoderField {
  name: string;
  offset: number;
  length: number;
  type: 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32' | 'bcd';
  endian?: 'big' | 'little';
  scale?: number;
  value_offset?: number;
  /** Extract a single bit (0-7) from the unpacked field instead of its whole
   * numeric value — e.g. reading one flag out of a packed alarm byte. Not
   * valid on 'bcd' or 'float32' fields. */
  bit?: number;
  /** Name of another field in this same decoder whose value is a wM-Bus-style
   * VIF exponent byte — multiplies this field's value by 10 ** (that field's
   * value - scale_exponent_base). For counters that step to a coarser unit on
   * overflow instead of resetting (e.g. B METERS: litres -> decalitres -> ...). */
  scale_exponent_ref?: string;
  /** The ref field's value that means "no extra scaling" (10**0). */
  scale_exponent_base?: number;
}

/**
 * Declarative LoRaWAN payload decoder — used ONLY when the network server
 * hasn't decoded the uplink itself (no NS 'object'). No code execution.
 */
export interface PayloadDecoder {
  type: 'declarative';
  f_port?: number;
  fields: DecoderField[];
}

export interface CommandParameter {
  name: string;
  type: 'float' | 'integer' | 'string' | 'boolean';
  unit?: string;
  min?: number;
  max?: number;
  enum?: string[];
  required?: boolean;
  description?: string;
}

export interface CommandSchemaEntry {
  description: string;
  parameters: CommandParameter[];
}

export interface DeviceType {
  id: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  category: string;
  icon: string;
  color: string;
  data_model: DataModelField[];
  capabilities: string[];
  default_settings?: DefaultSettings;
  connectivity?: ProtocolConfig;
  decoder?: PayloadDecoder | null;
  key_mapping?: Record<string, string>;
  command_schema?: Record<string, CommandSchemaEntry>;
  is_active: boolean;
  device_count: number;
  created_at: string;
  updated_at: string;
}

/** Form-shaped command — same fields as CommandSchemaEntry, name pulled out of
 * the dict key into a real field so it's editable like everything else. */
export interface CommandDef {
  name: string;
  description: string;
  parameters: CommandParameter[];
}

export interface DeviceTypeForm {
  name: string;
  description: string;
  manufacturer: string;
  model: string;
  category: string;
  icon: string;
  color: string;
  // Unified metric list — merged from / split back into data_model + decoder +
  // key_mapping at load/save (see _metrics.ts). The backend storage is unchanged.
  metrics: UnifiedMetric[];
  decoderFPort: number | null;
  capabilities: string[];
  default_settings: DefaultSettings;
  connectivity: ProtocolConfig;
  // Merged from / split back into command_schema at load/save (see _commands.ts).
  commands: CommandDef[];
  is_active: boolean;
}

export interface DiscoveredMetric {
  key: string;
  device_count: number;
  last_seen: string | null;
  in_schema: boolean;
}

/**
 * A single metric, defined once. Unifies what were three disconnected
 * mechanisms — data_model (schema), decoder.fields (byte layout), key_mapping
 * (raw→canonical rename) — into one row. Merged from / split back to those three
 * stored columns by _metrics.ts; the backend storage is unchanged.
 */
export type MetricSource =
  | { mode: 'direct' }
  | {
      mode: 'decode';
      offset: number;
      length: number;
      byteType: DecoderField['type'];
      endian: 'big' | 'little';
      scale: number;
      value_offset: number;
      bit?: number;
      scale_exponent_ref?: string;
      scale_exponent_base?: number;
    }
  | { mode: 'rename'; rawKey: string };

export interface UnifiedMetric {
  name: string;
  type: string;          // schema type: float | integer | boolean | string | ...
  unit: string;
  description: string;
  min_value?: number;
  max_value?: number;
  required: boolean;
  source: MetricSource;  // HOW it arrives
}
