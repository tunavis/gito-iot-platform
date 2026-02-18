'use client';

import SVGValveSymbol from '../svg/SVGValveSymbol';
import SVGStateBadge from '../svg/SVGStateBadge';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';
import { classifyMetrics, ACTUATOR_RULES } from '../classifyMetrics';

// Simplified: Only renders Zone 2 (Primary Visualization)
const VB_W = 800;
const VB_H = 440;

const VALVE_CX = VB_W / 2;
const VALVE_CY = VB_H / 2 - 50;
const VALVE_SIZE = 200;

export default function ActuatorRenderer({
  device,
  deviceType,
  latestValues,
  units,
  loading,
}: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const isOffline = device.status?.toLowerCase() === 'offline';

  const { groups } = classifyMetrics(schema, latestValues, ACTUATOR_RULES);

  const stateMetrics = groups['STATE'] || [];
  const positionMetrics = groups['POSITION'] || [];

  const primaryState = stateMetrics[0] || null;
  const primaryPosition = positionMetrics[0] || null;
  const positionVal = primaryPosition && typeof latestValues[primaryPosition.key] === 'number'
    ? latestValues[primaryPosition.key] as number : null;
  const stateVal = primaryState
    ? (latestValues[primaryState.key] !== null ? String(latestValues[primaryState.key]) : null)
    : null;

  const hasContent = primaryState || positionMetrics.length > 0;

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
        <filter id="actuator-offline">
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
      </defs>

      <g filter={isOffline ? 'url(#actuator-offline)' : undefined} opacity={isOffline ? 0.6 : 1}>
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />

        {/* Primary Visualization - Valve Symbol + State Badge */}
        <SVGValveSymbol
          cx={VALVE_CX}
          cy={VALVE_CY}
          size={VALVE_SIZE}
          position={positionVal}
          state={stateVal}
          offline={isOffline}
        />

        {/* State badge below valve */}
        {primaryState && (
          <SVGStateBadge
            x={VALVE_CX - 100}
            y={VALVE_CY + VALVE_SIZE / 2 + 50}
            value={stateVal}
            label={formatMetricLabel(primaryState.key)}
            size="lg"
          />
        )}
      </g>
    </svg>
  );
}