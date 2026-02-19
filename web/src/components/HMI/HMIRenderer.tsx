'use client';

import useHMIData from './useHMIData';
import LiveDeviceLayout from './layout/LiveDeviceLayout';
import { CATEGORY_RENDERERS, FALLBACK_RENDERER } from './index';
import {
  classifyMetrics,
  METER_RULES,
  SENSOR_RULES,
  GATEWAY_RULES,
  CONTROLLER_RULES,
  ACTUATOR_RULES,
  TRACKER_RULES,
} from './classifyMetrics';

interface HMIRendererProps {
  deviceId: string;
  tenantId: string;
  device: any;
  deviceType: any;
  enabled?: boolean;
}

// Map device category to classification rules
const CATEGORY_RULES: Record<string, any> = {
  meter: METER_RULES,
  sensor: SENSOR_RULES,
  gateway: GATEWAY_RULES,
  controller: CONTROLLER_RULES,
  actuator: ACTUATOR_RULES,
  tracker: TRACKER_RULES,
};

export default function HMIRenderer({
  deviceId,
  tenantId,
  device,
  deviceType,
  enabled = true,
}: HMIRendererProps) {
  const { latestValues, units, sparklineData, activeAlarmCount, lastUpdated, loading, error, wsConnected } = useHMIData(
    deviceId,
    tenantId,
    enabled
  );

  const category = deviceType?.category?.toLowerCase() || 'other';
  const Renderer = CATEGORY_RENDERERS[category] || FALLBACK_RENDERER;

  // Get classification rules for this device category
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const rules = CATEGORY_RULES[category] || METER_RULES;
  const { groups, ungrouped } = classifyMetrics(schema, latestValues, rules);

  // Collect all secondary metrics (combine all groups except hero)
  const secondaryMetricsList = [
    ...Object.values(groups).flat(),
    ...ungrouped,
  ];

  const hasData = Object.keys(latestValues).length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--hmi-bg-surface)' }}>
        <div className="text-center" style={{ color: 'var(--hmi-text-muted)' }}>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: 'var(--hmi-gauge-track)' }} />
          <p>Loading device data...</p>
        </div>
      </div>
    );
  }

  if (!hasData && !loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--hmi-bg-surface)' }}>
        <div className="text-center max-w-md" style={{ color: 'var(--hmi-text-muted)' }}>
          <div className="text-4xl mb-4">📡</div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--hmi-text-primary)' }}>
            Waiting for telemetry data
          </h3>
          <p className="text-sm">
            {error || "This device hasn't sent any telemetry data in the last 24 hours."}
          </p>
          <p className="text-xs mt-2">
            Data will appear automatically once the device starts reporting.
          </p>
        </div>
      </div>
    );
  }

  return (
    <LiveDeviceLayout
      device={device}
      deviceType={deviceType}
      latestValues={latestValues}
      units={units}
      activeAlarmCount={activeAlarmCount}
      loading={loading}
      secondaryMetrics={secondaryMetricsList}
      wsConnected={wsConnected}
    >
      <Renderer
        device={device}
        deviceType={deviceType}
        latestValues={latestValues}
        units={units}
        sparklineData={sparklineData}
        activeAlarmCount={activeAlarmCount}
        loading={loading}
      />
    </LiveDeviceLayout>
  );
}
