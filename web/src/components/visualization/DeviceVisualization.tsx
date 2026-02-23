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
import type { MetricDefinition } from './types';

interface DeviceVisualizationProps {
  deviceId: string;
  tenantId: string;
  /** telemetry_schema from the device type — used to determine MetricDefinitions */
  telemetrySchema?: Record<string, { type?: string; unit?: string; min?: number; max?: number }>;
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
}: DeviceVisualizationProps) {
  const { latestValues, lastUpdated, loading, error, wsConnected, activeAlarmCount } =
    useDeviceMetrics(deviceId, tenantId, true);

  // Build schema-based definitions once; fall back to runtime inference for ad-hoc metrics
  const schemaDefinitions = useMemo(
    () => buildMetricSchema(telemetrySchema),
    [telemetrySchema]
  );

  // Merge schema definitions with any ad-hoc metrics seen in live values
  const resolvedMetrics = useMemo<Array<{ key: string; def: MetricDefinition }>>(() => {
    return Object.entries(latestValues)
      .filter(([, val]) => val !== null)
      .map(([key, val]) => ({
        key,
        def: schemaDefinitions[key] ?? inferMetricDefinition(key, val),
      }));
  }, [latestValues, schemaDefinitions]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 bg-slate-900/40 rounded-xl border border-slate-800">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">Loading telemetry…</span>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex items-center justify-center h-48 bg-slate-900/40 rounded-xl border border-red-800/40">
        <span className="text-sm text-red-400">{error}</span>
      </div>
    );
  }

  // ── No data state ─────────────────────────────────────────────────────────
  if (resolvedMetrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 bg-slate-900/40 rounded-xl border border-slate-800">
        <WifiOff className="w-8 h-8 text-slate-600" />
        <p className="text-sm text-slate-500">No telemetry received yet</p>
        <p className="text-xs text-slate-600">Waiting for data from device…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Status bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className={`flex items-center gap-1.5 ${wsConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
            {wsConnected
              ? <><Wifi className="w-3.5 h-3.5" /> Live</>
              : <><WifiOff className="w-3.5 h-3.5" /> Polling 15s</>
            }
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {formatRelative(lastUpdated)}
          </span>
          {activeAlarmCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <Bell className="w-3.5 h-3.5" />
              {activeAlarmCount} active alarm{activeAlarmCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Metric grid — responsive: 1 col mobile, 2 col tablet, 3 col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {resolvedMetrics.map(({ key, def }) => (
          <MetricRenderer
            key={key}
            metricKey={key}
            value={latestValues[key] ?? null}
            definition={def}
          />
        ))}
      </div>
    </div>
  );
}
