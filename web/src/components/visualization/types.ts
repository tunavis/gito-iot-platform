/**
 * Gito IoT Platform — Visualization Layer Types
 *
 * This is the foundation type system for the state-driven SVG visualization engine.
 * All visualizations are driven by telemetry values + metric definitions.
 * No device-specific or hardcoded logic lives here.
 */

/** Flow medium — controls visual styling only, never animation logic */
export type FlowEffect = 'water' | 'gas' | 'energy' | 'air';

/** How a metric should be rendered */
export type MetricCategory =
  | 'flow'        // Directional flow: FlowLine animation speed-proportional to value
  | 'scalar'      // Single numeric value with unit
  | 'level'       // Fill level (0–max): tank, battery, progress bar
  | 'state'       // Discrete string states: online/offline, running/stopped
  | 'time-series'; // Historical chart (future phase — shows latest value now)

/** Layout direction for FlowLine */
export type FlowDirection = 'horizontal' | 'vertical';

/**
 * MetricDefinition: the contract between telemetry data and the renderer.
 *
 * Derived from device type telemetry_schema, or inferred from metric key/unit keywords.
 * Never references device names or IDs.
 */
export interface MetricDefinition {
  category: MetricCategory;
  unit?: string;
  max?: number;
  min?: number;
  /** Only used when category === 'flow' */
  effect?: FlowEffect;
  /** Display label — defaults to the metric key if absent */
  label?: string;
}

/** Map of metric key → MetricDefinition (derived from device type schema) */
export type MetricSchema = Record<string, MetricDefinition>;

/** Runtime telemetry values returned by useDeviceMetrics */
export interface DeviceMetrics {
  latestValues: Record<string, number | string | null>;
  units: Record<string, string>;
  lastUpdated: string | null;
  loading: boolean;
  error: string | null;
  wsConnected: boolean;
  activeAlarmCount: number;
}
