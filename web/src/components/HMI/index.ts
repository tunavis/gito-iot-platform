'use client';

import type { ComponentType } from 'react';

// --- HMI Renderer Props Interface ---
// All renderers (full + tile) receive this interface from the dispatcher.

export interface HMIRendererProps {
  device: any;
  deviceType: any;
  latestValues: Record<string, number | string | null>;
  units: Record<string, string>;
  sparklineData: Record<string, number[]>;
  activeAlarmCount: number;
  loading: boolean;
}

// --- Utility: Format metric key into human-readable label ---
export function formatMetricLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// --- Utility: Get display unit for a metric ---
export function getMetricUnit(
  key: string,
  units: Record<string, string>,
  schema?: Record<string, any>
): string | undefined {
  return units[key] || schema?.[key]?.unit;
}

// --- Utility: Format a numeric value for display ---
export function formatMetricValue(value: number | string | null, precision = 1): string {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'string') return value;
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(precision);
}

// --- Device categories (must match backend DeviceCategory enum) ---
export type DeviceCategory =
  | 'sensor'
  | 'gateway'
  | 'actuator'
  | 'tracker'
  | 'meter'
  | 'camera'
  | 'controller'
  | 'other';

// --- Category to Renderer Registry ---

import GenericDeviceView from './renderers/GenericDeviceView';
import SensorRenderer from './renderers/SensorRenderer';
import MeterRenderer from './renderers/MeterRenderer';
import GatewayRenderer from './renderers/GatewayRenderer';
import TrackerRenderer from './renderers/TrackerRenderer';
import ActuatorRenderer from './renderers/ActuatorRenderer';
import ControllerRenderer from './renderers/ControllerRenderer';

export const CATEGORY_RENDERERS: Record<string, ComponentType<HMIRendererProps>> = {
  sensor: SensorRenderer,
  meter: MeterRenderer,
  gateway: GatewayRenderer,
  tracker: TrackerRenderer,
  actuator: ActuatorRenderer,
  controller: ControllerRenderer,
  camera: GenericDeviceView,
  other: GenericDeviceView,
};

export const FALLBACK_RENDERER = GenericDeviceView;

// Re-exports for convenience
export { default as HMIRenderer } from './HMIRenderer';
export { default as useHMIData } from './useHMIData';
export { classifyMetrics } from './classifyMetrics';
export type { ClassificationResult, ClassifiedMetric, ClassificationRule } from './classifyMetrics';
