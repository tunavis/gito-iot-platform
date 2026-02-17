'use client';

import SVGNetworkNode from '../svg/SVGNetworkNode';
import SVGMetricLabel from '../svg/SVGMetricLabel';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';

const VB_W = 200;
const VB_H = 140;
const UTILIZATION_KEYS = ['cpu', 'memory', 'disk', 'ram', 'load'];

export default function GatewayTile({ deviceType, latestValues, units, loading }: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};

  let utilizationKey: string | null = null;
  const otherKeys: string[] = [];

  for (const [key] of Object.entries(schema)) {
    const k = key.toLowerCase();
    if (!utilizationKey && UTILIZATION_KEYS.some(u => k.includes(u))) {
      utilizationKey = key;
    } else if (otherKeys.length < 3) {
      otherKeys.push(key);
    }
  }

  // Infer connected count
  const connectedKey = Object.keys(latestValues).find(k => k.toLowerCase().includes('connected'));
  const connectedVal = connectedKey && typeof latestValues[connectedKey] === 'number'
    ? latestValues[connectedKey] as number : null;

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {/* Mini network node */}
      <SVGNetworkNode
        cx={55}
        cy={50}
        size={50}
        connectedCount={connectedVal}
      />

      {/* Side metrics */}
      {otherKeys.slice(0, 2).map((key, i) => (
        <SVGMetricLabel
          key={key}
          x={110}
          y={25 + i * 38}
          label={formatMetricLabel(key)}
          value={typeof latestValues[key] === 'number' ? latestValues[key] as number : latestValues[key] ?? null}
          unit={getMetricUnit(key, units, schema)}
          size="sm"
        />
      ))}

      {/* Utilization metric at bottom */}
      {utilizationKey && (
        <SVGMetricLabel
          x={VB_W / 2}
          y={108}
          label={formatMetricLabel(utilizationKey)}
          value={typeof latestValues[utilizationKey] === 'number' ? latestValues[utilizationKey] as number : null}
          unit={getMetricUnit(utilizationKey, units, schema) || '%'}
          size="sm"
          align="center"
        />
      )}
    </svg>
  );
}
