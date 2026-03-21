'use client';

/**
 * DeviceVisualization — Live Device Visualization Panel
 *
 * Connects the data layer (useDeviceMetrics) to the rendering layer (MetricRenderer).
 * Builds a MetricSchema from the device type's telemetry_schema, then renders
 * a responsive grid of MetricRenderer cards — one per live telemetry metric.
 *
 * This component is the direct replacement for the old HMIRenderer.
 * It contains zero device-specific or category-specific rendering logic.
 */

import React, { useMemo } from 'react';
import { Wifi, WifiOff, Clock, Bell } from 'lucide-react';
import useDeviceMetrics from './useDeviceMetrics';
import MetricRenderer from './MetricRenderer';
import { buildMetricSchema, inferMetricDefinition } from './effects';
import type { MetricDefinition, DeviceMetrics } from './types';
import { TemplateRenderer, resolveTemplate } from '@/components/DeviceTemplates';

interface DeviceVisualizationProps {
  deviceId: string;
  tenantId: string;
  /** telemetry_schema from the device type — used to determine MetricDefinitions */
  telemetrySchema?: Record<string, { type?: string; unit?: string; min?: number; max?: number }>;
  /** device type category — used to resolve the device illustration template */
  deviceCategory?: string;
  /** Current device status from the API — used to show stale-data indicator */
  deviceStatus?: 'online' | 'offline' | 'unknown' | 'idle';
  /**
   * Pre-fetched metrics from the parent page's useDeviceMetrics call.
   * When provided, the component skips its own hook call (single source of truth).
   */
  metrics?: DeviceMetrics;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const sec  = Math.floor(diff / 1000);
  if (sec < 5)   return 'Just now';
  if (sec < 60)  return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export default function DeviceVisualization({
  deviceId,
  tenantId,
  telemetrySchema = {},
  deviceCategory,
  deviceStatus,
  metrics: externalMetrics,
}: DeviceVisualizationProps) {
  const isOffline = deviceStatus === 'offline';
  // Use parent-provided metrics when available (avoids a second hook + WebSocket connection).
  // Fall back to an internal hook only when rendered standalone (e.g. in tests or Storybook).
  const internalMetrics = useDeviceMetrics(deviceId, tenantId, !externalMetrics);
  const { latestValues, lastUpdated, loading, error, wsConnected, activeAlarmCount } =
    externalMetrics ?? internalMetrics;

  // Resolve device illustration template (null = no matching template → metric grid only)
  const templateConfig = useMemo(
    () => resolveTemplate(deviceCategory, telemetrySchema),
    [deviceCategory, telemetrySchema]
  );

  // Build schema-based definitions once; fall back to runtime inference for ad-hoc metrics
  const schemaDefinitions = useMemo(
    () => buildMetricSchema(telemetrySchema),
    [telemetrySchema]
  );

  // Merge schema definitions with any ad-hoc metrics seen in live values.
  // When a device type schema is declared, only show schema fields — any extra
  // keys the device sends (e.g. "location", "sample_count") are silently ignored.
  // When no schema is declared, fall back to showing every non-null metric.
  const schemaKeys = useMemo(() => Object.keys(telemetrySchema), [telemetrySchema]);

  // Metrics already rendered as overlays on the illustration — exclude from the grid
  const overlayMetricKeys = useMemo(
    () => new Set(templateConfig?.overlays.map(o => o.metric) ?? []),
    [templateConfig]
  );

  const resolvedMetrics = useMemo<Array<{ key: string; def: MetricDefinition }>>(() => {
    return Object.entries(latestValues)
      .filter(([key, val]) => {
        if (val === null) return false;
        if (schemaKeys.length > 0) return schemaKeys.includes(key);
        return true;
      })
      .map(([key, val]) => ({
        key,
        def: schemaDefinitions[key] ?? inferMetricDefinition(key, val),
      }));
  }, [latestValues, schemaDefinitions, schemaKeys]);

  // When a template is active, only the metrics NOT already shown as overlays
  // appear in the right-hand grid — avoids showing the same value twice.
  const gridMetrics = useMemo(
    () => templateConfig
      ? resolvedMetrics.filter(({ key }) => !overlayMetricKeys.has(key))
      : resolvedMetrics,
    [resolvedMetrics, overlayMetricKeys, templateConfig]
  );

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 rounded-xl border gito-card">
        <div className="flex flex-col items-center gap-3" style={{ color: 'var(--color-text-muted)' }}>
          <div className="w-8 h-8 border-2 border-t-blue-500 rounded-full animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: '#3b82f6' }} />
          <span className="text-sm">Loading telemetry…</span>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex items-center justify-center h-48 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'rgba(239,68,68,0.3)' }}>
        <span className="text-sm text-red-500">{error}</span>
      </div>
    );
  }

  // ── No data state ─────────────────────────────────────────────────────────
  if (resolvedMetrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 rounded-xl border gito-card">
        <WifiOff className="w-8 h-8" style={{ color: 'var(--color-text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No telemetry received yet</p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Waiting for data from device…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Offline banner — shown when device status is offline */}
      {isOffline && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          <span>
            Device is offline — showing last known values. Still checking every 15s and will update instantly when the device reconnects.
          </span>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <span className={`flex items-center gap-1.5 ${wsConnected ? 'text-emerald-500' : ''}`} style={wsConnected ? {} : { color: 'var(--color-text-muted)' }}>
            {wsConnected
              ? <><Wifi className="w-3.5 h-3.5" /> Live</>
              : <><WifiOff className="w-3.5 h-3.5" /> Polling 15s</>
            }
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {isOffline ? `Last seen ${formatRelative(lastUpdated)}` : formatRelative(lastUpdated)}
          </span>
          {activeAlarmCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <Bell className="w-3.5 h-3.5" />
              {activeAlarmCount} active alarm{activeAlarmCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {templateConfig ? (
        /* ── Template layout: illustration left, metrics right ── */
        <div className={`flex flex-col lg:flex-row gap-4 transition-opacity ${isOffline ? 'opacity-50' : 'opacity-100'}`}>
          {/* Illustration — constrained width so it never dominates */}
          <div
            className="rounded-xl overflow-hidden border flex-shrink-0"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-page)', width: '100%', maxWidth: 360 }}
          >
            <TemplateRenderer config={templateConfig} telemetry={latestValues} deviceStatus={deviceStatus === 'idle' ? 'unknown' : deviceStatus} />
          </div>
          {/* Metric grid — only metrics not already shown as overlays on the illustration */}
          {gridMetrics.length > 0 && (
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
              {gridMetrics.map(({ key, def }) => (
                <MetricRenderer key={key} metricKey={key} value={latestValues[key] ?? null} definition={def} />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── No template: standard metric grid ── */
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 transition-opacity ${isOffline ? 'opacity-50' : 'opacity-100'}`}>
          {resolvedMetrics.map(({ key, def }) => (
            <MetricRenderer key={key} metricKey={key} value={latestValues[key] ?? null} definition={def} />
          ))}
        </div>
      )}
    </div>
  );
}
// v2
