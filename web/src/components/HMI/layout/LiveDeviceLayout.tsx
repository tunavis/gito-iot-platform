'use client';

import { ReactNode } from 'react';
import DeviceHeader from './DeviceHeader';
import DeviceFooter from './DeviceFooter';
import HMISecondaryStrip from './HMISecondaryStrip';
import HMIWorkspace from './HMIWorkspace';
import { formatMetricLabel, getMetricUnit } from '../index';
import type { ClassifiedMetric } from '../classifyMetrics';

interface LiveDeviceLayoutProps {
  device: any;
  deviceType: any;
  latestValues: Record<string, number | string | null>;
  units: Record<string, string>;
  activeAlarmCount: number;
  loading: boolean;
  secondaryMetrics: ClassifiedMetric[];
  wsConnected?: boolean;
  children: ReactNode; // The renderer component
}

/**
 * LiveDeviceLayout - Main orchestrator for Live Device view
 *
 * Responsibilities:
 * - Owns the entire screen layout (Header, Workspace, Secondary Strip, Footer)
 * - Manages data flow to chrome components
 * - Delegates visualization to the appropriate Renderer (passed as children)
 */
export default function LiveDeviceLayout({
  device,
  deviceType,
  latestValues,
  units,
  activeAlarmCount,
  loading,
  secondaryMetrics,
  wsConnected = false,
  children,
}: LiveDeviceLayoutProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const protocol = deviceType?.connectivity?.protocol;

  // Transform secondary metrics for the strip
  const metricsForStrip = secondaryMetrics.map((m) => ({
    key: m.key,
    label: formatMetricLabel(m.key),
    value: latestValues[m.key],
    unit: getMetricUnit(m.key, units, schema),
  }));

  return (
    <div className="flex flex-col h-full w-full">
      {/* Zone 1: Header */}
      <DeviceHeader
        status={device.status}
        lastSeen={device.last_seen}
        isLoading={loading}
        wsConnected={wsConnected}
      />

      {/* Zone 2: Primary Visualization (Renderer) */}
      <HMIWorkspace>
        {children}
      </HMIWorkspace>

      {/* Zone 3: Secondary Metrics Strip */}
      <HMISecondaryStrip metrics={metricsForStrip} />

      {/* Zone 4: Footer */}
      <DeviceFooter
        protocol={protocol}
        deviceType={device.device_type}
        alarmCount={activeAlarmCount}
      />
    </div>
  );
}
