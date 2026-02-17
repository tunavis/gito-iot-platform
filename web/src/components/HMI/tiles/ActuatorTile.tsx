'use client';

import SVGValveSymbol from '../svg/SVGValveSymbol';
import SVGStateBadge from '../svg/SVGStateBadge';
import SVGMetricLabel from '../svg/SVGMetricLabel';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';

const VB_W = 200;
const VB_H = 140;
const STATE_KEYS = ['state', 'status', 'mode', 'valve_state', 'switch', 'relay'];
const POSITION_KEYS = ['position', 'setpoint', 'angle', 'opening'];

export default function ActuatorTile({ deviceType, latestValues, units, loading }: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};

  let stateKey: string | null = null;
  let positionKey: string | null = null;

  for (const [key, meta] of Object.entries(schema)) {
    const k = key.toLowerCase();
    if (!stateKey && (STATE_KEYS.some(s => k.includes(s)) || meta.type === 'string')) stateKey = key;
    else if (!positionKey && POSITION_KEYS.some(p => k.includes(p))) positionKey = key;
  }

  const positionVal = positionKey && typeof latestValues[positionKey] === 'number'
    ? latestValues[positionKey] as number : null;
  const stateVal = stateKey
    ? (latestValues[stateKey] !== null ? String(latestValues[stateKey]) : null) : null;

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {/* Mini valve symbol */}
      <SVGValveSymbol
        cx={VB_W / 2}
        cy={45}
        size={40}
        position={positionVal}
        state={stateVal}
      />

      {/* State badge */}
      {stateKey && (
        <SVGStateBadge
          x={VB_W / 2 - 30}
          y={80}
          value={stateVal}
          size="sm"
        />
      )}

      {/* Position value */}
      {positionKey && (
        <SVGMetricLabel
          x={VB_W / 2}
          y={105}
          label={formatMetricLabel(positionKey)}
          value={positionVal}
          unit={getMetricUnit(positionKey, units, schema)}
          size="sm"
          align="center"
        />
      )}

      {!stateKey && !positionKey && !loading && (
        <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" dominantBaseline="central" fill="var(--hmi-text-muted)" fontSize={10}>
          No metrics
        </text>
      )}
    </svg>
  );
}
