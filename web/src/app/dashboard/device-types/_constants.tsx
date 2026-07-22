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
  Droplet,
  Droplets,
  Waves,
  Flame,
  Wind,
  Gauge,
  BatteryCharging,
  Wifi,
  Antenna,
  Video,
  Navigation,
  Satellite,
  Lightbulb,
  DoorOpen,
  Siren,
  Fan,
  Snowflake,
  Sun,
  ScanLine,
  Package,
  Shield,
  Cloud,
  Activity,
  Lock,
  Plug,
  Bell,
  type LucideIcon,
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

// --- Per-device-type icons ---
// Every device type stores its own `icon` key (e.g. 'droplets', 'zap') distinct
// from its broad category, so a water meter and an energy meter — both
// category 'meter' — don't have to look identical. Pick one per device type in
// the editor below; resolveDeviceIcon() falls back to the category icon for
// any type that predates this or was never given one.

export const ICON_OPTIONS: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: 'droplet', label: 'Water (single)', Icon: Droplet },
  { value: 'droplets', label: 'Water', Icon: Droplets },
  { value: 'waves', label: 'Flow', Icon: Waves },
  { value: 'zap', label: 'Electricity', Icon: Zap },
  { value: 'flame', label: 'Gas / Flame', Icon: Flame },
  { value: 'thermometer', label: 'Temperature', Icon: Thermometer },
  { value: 'wind', label: 'Air / HVAC', Icon: Wind },
  { value: 'gauge', label: 'Pressure', Icon: Gauge },
  { value: 'battery-charging', label: 'Battery', Icon: BatteryCharging },
  { value: 'wifi', label: 'Wifi', Icon: Wifi },
  { value: 'radio', label: 'Gateway', Icon: Radio },
  { value: 'antenna', label: 'Antenna', Icon: Antenna },
  { value: 'video', label: 'Video', Icon: Video },
  { value: 'camera', label: 'Camera', Icon: Camera },
  { value: 'toggle-right', label: 'Switch', Icon: ToggleRight },
  { value: 'map-pin', label: 'Location', Icon: MapPin },
  { value: 'navigation', label: 'Tracker', Icon: Navigation },
  { value: 'satellite', label: 'Satellite', Icon: Satellite },
  { value: 'lightbulb', label: 'Lighting', Icon: Lightbulb },
  { value: 'door-open', label: 'Access', Icon: DoorOpen },
  { value: 'siren', label: 'Alarm', Icon: Siren },
  { value: 'fan', label: 'Fan', Icon: Fan },
  { value: 'snowflake', label: 'Cooling', Icon: Snowflake },
  { value: 'sun', label: 'Solar', Icon: Sun },
  { value: 'cpu', label: 'Controller', Icon: Cpu },
  { value: 'scan-line', label: 'Scanner', Icon: ScanLine },
  { value: 'package', label: 'Asset', Icon: Package },
  { value: 'shield', label: 'Security', Icon: Shield },
  { value: 'cloud', label: 'Cloud', Icon: Cloud },
  { value: 'activity', label: 'Activity', Icon: Activity },
  { value: 'lock', label: 'Lock', Icon: Lock },
  { value: 'plug', label: 'Power', Icon: Plug },
  { value: 'bell', label: 'Notification', Icon: Bell },
];

const deviceIcons: Record<string, React.ReactNode> = Object.fromEntries(
  ICON_OPTIONS.map(({ value, Icon }) => [value, <Icon className="w-5 h-5" />])
);

export function resolveDeviceIcon(dt: { icon?: string | null; category?: string | null }): React.ReactNode {
  return (dt.icon && deviceIcons[dt.icon])
    || (dt.category && categoryIcons[dt.category])
    || <Cpu className="w-5 h-5" />;
}

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

// --- Payload Decoder byte types ---

export const DECODER_FIELD_TYPES = [
  { value: 'uint8', label: 'uint8 (1 byte)' },
  { value: 'int8', label: 'int8 (1 byte)' },
  { value: 'uint16', label: 'uint16 (2 bytes)' },
  { value: 'int16', label: 'int16 (2 bytes)' },
  { value: 'uint32', label: 'uint32 (4 bytes)' },
  { value: 'int32', label: 'int32 (4 bytes)' },
  { value: 'float32', label: 'float32 (4 bytes)' },
  { value: 'bcd', label: 'BCD (packed decimal)' },
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

// --- Unit suggestions ---
// Free-text field, not an enum — this only powers the <datalist> autocomplete so
// units with characters that are awkward to type on a standard keyboard (°, ³, Ω)
// can be picked instead of hand-typed. Any other value is still accepted.

export const UNIT_SUGGESTIONS = [
  '°C', '°F', 'K',
  '%', '%RH',
  'V', 'A', 'W', 'kW', 'kWh', 'VA', 'VAR', 'Hz', 'Ω',
  'bar', 'Pa', 'kPa', 'hPa', 'psi',
  'L', 'mL', 'm³', 'm³/h', 'L/min', 'L/h', 'gal',
  'm', 'cm', 'mm', 'km', 'ft', 'in',
  'm/s', 'km/h', 'mph',
  'kg', 'g', 'lb', 't',
  'lux', 'ppm', 'dB', 'dBm', 'rpm',
  'ms', 's', 'min', 'h',
];

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
  metrics: [],
  decoderFPort: null,
  capabilities: ['telemetry'],
  commands: [],
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
