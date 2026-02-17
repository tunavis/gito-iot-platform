'use client';

import SVGMetricLabel from '../svg/SVGMetricLabel';
import { getMetricUnit, type HMIRendererProps } from '../index';
import { formatCompactValue } from '../svg/helpers';

const VB_W = 200;
const VB_H = 140;
const PV_KEYS = ['pv', 'process_value', 'measured', 'actual'];
const SP_KEYS = ['sp', 'setpoint', 'set_point', 'target'];
const OUTPUT_KEYS = ['output', 'control_output', 'cv', 'duty'];

export default function ControllerTile({ deviceType, latestValues, units, loading }: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};

  let pvKey: string | null = null;
  let spKey: string | null = null;
  let outputKey: string | null = null;

  for (const [key] of Object.entries(schema)) {
    const k = key.toLowerCase();
    if (!pvKey && PV_KEYS.some(p => k.includes(p))) pvKey = key;
    else if (!spKey && SP_KEYS.some(s => k.includes(s))) spKey = key;
    else if (!outputKey && OUTPUT_KEYS.some(o => k.includes(o))) outputKey = key;
  }

  const pvVal = pvKey && typeof latestValues[pvKey] === 'number' ? latestValues[pvKey] as number : null;
  const spVal = spKey && typeof latestValues[spKey] === 'number' ? latestValues[spKey] as number : null;
  const deviation = pvVal !== null && spVal !== null ? pvVal - spVal : null;
  const devColor = deviation !== null
    ? (Math.abs(deviation) > 5 ? '#dc2626' : Math.abs(deviation) > 2 ? '#d97706' : '#16a34a')
    : '#94a3b8';

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {/* PV */}
      {pvKey && (
        <SVGMetricLabel
          x={10}
          y={15}
          label="PV"
          value={pvVal}
          unit={getMetricUnit(pvKey, units, schema)}
          size="sm"
        />
      )}

      {/* SP */}
      {spKey && (
        <SVGMetricLabel
          x={110}
          y={15}
          label="SP"
          value={spVal}
          unit={getMetricUnit(spKey, units, schema)}
          size="sm"
        />
      )}

      {/* Deviation */}
      {deviation !== null && (
        <text
          x={VB_W / 2}
          y={62}
          textAnchor="middle"
          fill={devColor}
          fontSize={11}
          fontWeight={700}
          fontFamily="var(--hmi-font-mono)"
        >
          {deviation > 0 ? '+' : ''}{formatCompactValue(deviation)} dev
        </text>
      )}

      {/* Output metric */}
      {outputKey && (
        <SVGMetricLabel
          x={VB_W / 2}
          y={100}
          label="Output"
          value={typeof latestValues[outputKey] === 'number' ? latestValues[outputKey] as number : null}
          unit={getMetricUnit(outputKey, units, schema) || '%'}
          size="sm"
          align="center"
        />
      )}

      {!pvKey && !spKey && !loading && (
        <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" dominantBaseline="central" fill="var(--hmi-text-muted)" fontSize={10}>
          No metrics
        </text>
      )}
    </svg>
  );
}
