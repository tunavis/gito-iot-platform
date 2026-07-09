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
  type: 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32';
  endian?: 'big' | 'little';
  scale?: number;
  value_offset?: number;
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
  is_active: boolean;
  device_count: number;
  created_at: string;
  updated_at: string;
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
