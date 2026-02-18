'use client';

import SVGDeviationBar from '../svg/SVGDeviationBar';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';
import { classifyMetrics, CONTROLLER_RULES } from '../classifyMetrics';

// Simplified: Only renders Zone 2 (Primary Visualization)
const VB_W = 800;
const VB_H = 440;

const PV_KEYS = ['pv', 'process_value', 'measured', 'actual'];
const SP_KEYS = ['sp', 'setpoint', 'set_point', 'target'];

export default function ControllerRenderer({
  device,
  deviceType,
  latestValues,
  units,
  loading,
}: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const isOffline = device.status?.toLowerCase() === 'offline';

  const { groups } = classifyMetrics(schema, latestValues, CONTROLLER_RULES);

  const controlLoop = groups['CONTROL LOOP'] || [];
  const outputMetrics = groups['OUTPUT'] || [];

  let pvKey: string | null = null;
  let spKey: string | null = null;

  for (const m of controlLoop) {
    const k = m.key.toLowerCase();
    if (!pvKey && PV_KEYS.some(p => k.includes(p))) pvKey = m.key;
    else if (!spKey && SP_KEYS.some(s => k.includes(s))) spKey = m.key;
  }

  const pvMeta = pvKey ? (schema[pvKey] || {}) : {};
  const spMeta = spKey ? (schema[spKey] || {}) : {};
  const pvVal = pvKey && typeof latestValues[pvKey] === 'number' ? latestValues[pvKey] as number : null;
  const spVal = spKey && typeof latestValues[spKey] === 'number' ? latestValues[spKey] as number : null;
  const devMin = pvMeta.min ?? spMeta.min ?? 0;
  const devMax = pvMeta.max ?? spMeta.max ?? 100;
  const devUnit = pvKey ? getMetricUnit(pvKey, units, schema) : (spKey ? getMetricUnit(spKey, units, schema) : undefined);

  const hasContent = pvKey || spKey || outputMetrics.length > 0;

  if (!hasContent && !loading) {
    return (
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />
        <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" fill="var(--hmi-text-muted)" fontSize={14}>
          No telemetry schema defined for this device type
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="controller-offline">
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
      </defs>

      <g filter={isOffline ? 'url(#controller-offline)' : undefined} opacity={isOffline ? 0.6 : 1}>
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />

        {/* Primary Visualization - Deviation Bar */}
        {(pvKey || spKey) && (
          <SVGDeviationBar
            x={100}
            y={VB_H / 2 - 60}
            width={VB_W - 200}
            pv={pvVal}
            sp={spVal}
            min={devMin}
            max={devMax}
            unit={devUnit}
            offline={isOffline}
          />
        )}
      </g>
    </svg>
  );
}
