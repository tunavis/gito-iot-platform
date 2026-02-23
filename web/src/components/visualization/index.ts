/**
 * Gito IoT Platform — Visualization Layer
 *
 * State-driven animated SVG visualization system.
 * Telemetry → Metric Definition → Renderer → Animated SVG
 *
 * Public API:
 *   DeviceVisualization  — main integration component (replaces HMIRenderer)
 *   MetricRenderer       — generic per-metric card (flow/scalar/level/state)
 *   FlowLine             — core SVG flow animation primitive
 *   useDeviceMetrics     — real-time telemetry data hook (WS + polling)
 *   classifyMetric       — infer MetricDefinition from schema field
 *   buildMetricSchema    — build full MetricSchema from device type schema
 *   EFFECT_STYLES        — visual style constants per flow medium
 */

export { default as DeviceVisualization } from './DeviceVisualization';
export { default as MetricRenderer }      from './MetricRenderer';
export { default as FlowLine }            from './FlowLine';
export { default as useDeviceMetrics }    from './useDeviceMetrics';

export { classifyMetric, buildMetricSchema, inferMetricDefinition, getEffectStyle, EFFECT_STYLES } from './effects';

export type {
  FlowEffect,
  FlowDirection,
  MetricCategory,
  MetricDefinition,
  MetricSchema,
  DeviceMetrics,
} from './types';

export type { FlowLineProps }       from './FlowLine';
export type { MetricRendererProps } from './MetricRenderer';
