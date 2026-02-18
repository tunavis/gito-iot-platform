'use client';

import SVGNetworkNode from '../svg/SVGNetworkNode';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';
import { classifyMetrics, GATEWAY_RULES } from '../classifyMetrics';

// Simplified: Only renders Zone 2 (Primary Visualization)
const VB_W = 800;
const VB_H = 440;

const NODE_CX = VB_W / 2;
const NODE_CY = VB_H / 2;
const NODE_SIZE = 240;

export default function GatewayRenderer({
  device,
  deviceType,
  latestValues,
  units,
  loading,
}: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const isOffline = device.status?.toLowerCase() === 'offline';

  const { hero, groups } = classifyMetrics(schema, latestValues, GATEWAY_RULES);

  const connectivityMetrics = groups['CONNECTIVITY'] || [];
  const networkMetrics = groups['NETWORK'] || [];

  // Connected device count from hero or connectivity metrics
  const connectedKey = hero?.key || connectivityMetrics.find(m => m.key.toLowerCase().includes('connected'))?.key;
  const connectedVal = connectedKey && typeof latestValues[connectedKey] === 'number'
    ? latestValues[connectedKey] as number : null;

  const hasContent = connectivityMetrics.length > 0 || networkMetrics.length > 0;

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
        <filter id="gateway-offline">
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
      </defs>

      <g filter={isOffline ? 'url(#gateway-offline)' : undefined} opacity={isOffline ? 0.6 : 1}>
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />

        {/* Primary Visualization - Network Node */}
        <SVGNetworkNode
          cx={NODE_CX}
          cy={NODE_CY}
          size={NODE_SIZE}
          connectedCount={connectedVal}
          offline={isOffline}
        />
      </g>
    </svg>
  );
}
