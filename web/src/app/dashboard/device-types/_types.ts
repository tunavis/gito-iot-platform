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
  data_model: DataModelField[];
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
