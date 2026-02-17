'use client';

import SVGThermometer from '../svg/SVGThermometer';
import SVGArcGauge from '../svg/SVGArcGauge';
import SVGMetricLabel from '../svg/SVGMetricLabel';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';

const VB_W = 200;
const VB_H = 140;

function isTemperatureMetric(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes('temp') || k.includes('temperature');
}

export default function SensorTile({ deviceType, latestValues, units, loading }: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const allKeys = Object.keys(schema).length > 0 ? Object.keys(schema) : Object.keys(latestValues);

  const numericMetrics: { key: string; meta: Record<string, any> }[] = [];
  for (const key of allKeys) {
    const meta = schema[key] || {};
    const val = latestValues[key];
    if (typeof val === 'number' || meta.type === 'float' || meta.type === 'int' || meta.type === 'number') {
      numericMetrics.push({ key, meta });
    }
  }

  const hero = numericMetrics[0] || null;
  const secondary = numericMetrics.slice(1, 3);
  const heroIsTemp = hero && isTemperatureMetric(hero.key);
  const heroVal = hero ? latestValues[hero.key] : null;

  if (!hero && !loading) {
    return (
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" dominantBaseline="central" fill="var(--hmi-text-muted)" fontSize={10}>
          No metrics
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {hero && heroIsTemp ? (
        <SVGThermometer
          cx={45}
          cy={65}
          height={90}
          value={typeof heroVal === 'number' ? heroVal : null}
          min={hero.meta.min ?? -40}
          max={hero.meta.max ?? 85}
          unit={getMetricUnit(hero.key, units, schema)}
        />
      ) : hero ? (
        <SVGArcGauge
          cx={65}
          cy={60}
          radius={35}
          value={typeof heroVal === 'number' ? heroVal : null}
          min={hero.meta.min ?? 0}
          max={hero.meta.max ?? 100}
          unit={getMetricUnit(hero.key, units, schema)}
          strokeWidth={5}
          fontSize={14}
          unitFontSize={8}
          showTicks={false}
          showMinMax={false}
          accentColor="var(--hmi-accent-sensor)"
        />
      ) : null}

      {/* Secondary metrics */}
      {secondary.map((m, i) => (
        <SVGMetricLabel
          key={m.key}
          x={heroIsTemp ? 120 : 125}
          y={35 + i * 40}
          label={formatMetricLabel(m.key)}
          value={typeof latestValues[m.key] === 'number' ? latestValues[m.key] as number : null}
          unit={getMetricUnit(m.key, units, schema)}
          size="sm"
        />
      ))}
    </svg>
  );
}
