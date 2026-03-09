import React from 'react';
import {
  Cpu,
  Thermometer,
  Radio,
  ToggleRight,
  MapPin,
  Zap,
  Camera,
  Settings,
} from 'lucide-react';
import { ProtocolType } from '@/components/ProtocolSelector';
import type { DeviceTypeForm } from './_types';

// --- Categories ---

export const CATEGORIES = [
  { value: 'sensor', label: 'Sensor', icon: Thermometer },
  { value: 'gateway', label: 'Gateway', icon: Radio },
  { value: 'actuator', label: 'Actuator', icon: ToggleRight },
  { value: 'tracker', label: 'Tracker', icon: MapPin },
  { value: 'meter', label: 'Meter', icon: Zap },
  { value: 'camera', label: 'Camera', icon: Camera },
  { value: 'controller', label: 'Controller', icon: Settings },
  { value: 'other', label: 'Other', icon: Cpu },
];

export const categoryIcons: Record<string, React.ReactNode> = {
  sensor: <Thermometer className="w-5 h-5" />,
  gateway: <Radio className="w-5 h-5" />,
  actuator: <ToggleRight className="w-5 h-5" />,
  tracker: <MapPin className="w-5 h-5" />,
  meter: <Zap className="w-5 h-5" />,
  camera: <Camera className="w-5 h-5" />,
  controller: <Settings className="w-5 h-5" />,
  other: <Cpu className="w-5 h-5" />,
};

export const categoryLabels: Record<string, string> = {
  sensor: 'Sensor',
  gateway: 'Gateway',
  actuator: 'Actuator',
  tracker: 'Tracker',
  meter: 'Meter',
  camera: 'Camera',
  controller: 'Controller',
  other: 'Other',
};

// --- Capabilities ---

export const CAPABILITIES = [
  { value: 'telemetry', label: 'Telemetry', description: 'Sends sensor/metric data' },
  { value: 'commands', label: 'Commands', description: 'Accepts remote commands' },
  { value: 'firmware_ota', label: 'Firmware OTA', description: 'Over-the-air updates' },
  { value: 'remote_config', label: 'Remote Config', description: 'Remote configuration' },
  { value: 'location', label: 'Location', description: 'GPS/location tracking' },
  { value: 'alerts', label: 'Alerts', description: 'Device-side alerts' },
  { value: 'file_transfer', label: 'File Transfer', description: 'Upload/download files' },
  { value: 'edge_compute', label: 'Edge Compute', description: 'Edge processing' },
];

export const capabilityColors: Record<string, { bg: string; color: string; border: string }> = {
  telemetry:     { bg: 'rgba(37,99,235,0.1)',   color: '#3b82f6', border: 'rgba(37,99,235,0.2)' },
  commands:      { bg: 'rgba(139,92,246,0.1)',  color: '#8b5cf6', border: 'rgba(139,92,246,0.2)' },
  firmware_ota:  { bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b', border: 'rgba(245,158,11,0.2)' },
  remote_config: { bg: 'rgba(20,184,166,0.1)',  color: '#14b8a6', border: 'rgba(20,184,166,0.2)' },
  location:      { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e', border: 'rgba(34,197,94,0.2)' },
  alerts:        { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444', border: 'rgba(239,68,68,0.2)' },
  file_transfer: { bg: 'rgba(99,102,241,0.1)',  color: '#6366f1', border: 'rgba(99,102,241,0.2)' },
  edge_compute:  { bg: 'rgba(236,72,153,0.1)',  color: '#ec4899', border: 'rgba(236,72,153,0.2)' },
};

export const capabilityLabels: Record<string, string> = {
  telemetry: 'Telemetry',
  commands: 'Commands',
  firmware_ota: 'OTA',
  remote_config: 'Remote Config',
  location: 'Location',
  alerts: 'Alerts',
  file_transfer: 'Files',
  edge_compute: 'Edge',
};

// --- Field Types ---

export const FIELD_TYPES = [
  { value: 'float', label: 'Float' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'string', label: 'String' },
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'json', label: 'JSON Object' },
  { value: 'array', label: 'Array' },
];

export const fieldTypeBadgeStyles: Record<string, { bg: string; color: string; border: string }> = {
  float:     { bg: 'rgba(37,99,235,0.1)',   color: '#3b82f6', border: 'rgba(37,99,235,0.2)' },
  integer:   { bg: 'rgba(37,99,235,0.1)',   color: '#3b82f6', border: 'rgba(37,99,235,0.2)' },
  boolean:   { bg: 'rgba(139,92,246,0.1)',  color: '#8b5cf6', border: 'rgba(139,92,246,0.2)' },
  string:    { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e', border: 'rgba(34,197,94,0.2)' },
  timestamp: { bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b', border: 'rgba(245,158,11,0.2)' },
  json:      { bg: 'rgba(100,116,139,0.1)', color: '#64748b', border: 'rgba(100,116,139,0.2)' },
  array:     { bg: 'rgba(100,116,139,0.1)', color: '#64748b', border: 'rgba(100,116,139,0.2)' },
};

// --- Colors ---

export const COLORS = [
  '#10b981', // Green
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#6366f1', // Indigo
];

// --- Default Form ---

export const DEFAULT_FORM: DeviceTypeForm = {
  name: '',
  description: '',
  manufacturer: '',
  model: '',
  category: 'sensor',
  icon: 'thermometer',
  color: '#10b981',
  data_model: [],
  capabilities: ['telemetry'],
  default_settings: {
    heartbeat_interval: 60,
    telemetry_interval: 300,
    offline_threshold: 900,
  },
  connectivity: {
    protocol: 'mqtt' as ProtocolType,
    mqtt: {
      topic_pattern: '{{tenant_id}}/devices/{{device_id}}/telemetry',
      qos: 1,
      retain: false,
    },
  },
  is_active: true,
};

// --- Helpers ---

export function formatSeconds(seconds: number): string {
  if (seconds < 120) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function formatRange(min?: number, max?: number): string {
  if (min != null && max != null) return `${min} – ${max}`;
  if (min != null) return `≥ ${min}`;
  if (max != null) return `≤ ${max}`;
  return '—';
}
