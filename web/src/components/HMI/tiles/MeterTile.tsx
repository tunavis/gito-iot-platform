'use client';

import SVGArcGauge from '../svg/SVGArcGauge';
import SVGMetricLabel from '../svg/SVGMetricLabel';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';

const VB_W = 200;
const VB_H = 140;
const RATE_UNITS = ['/hr', '/min', '/s', '/h', '/m', 'Hz'];

export default function MeterTile({ deviceType, latestValues, units, loading }: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const entries = Object.entries(schema);

  let heroKey: string | null = null;
  let secondaryKey: string | null = null;

  for (const [key, meta] of entries) {
    const unit = getMetricUnit(key, units, schema);
    if (!heroKey && meta.type !== 'string' && meta.type !== 'boolean') {
      heroKey = key;
    } else if (!secondaryKey && unit && RATE_UNITS.some(r => (unit || '').includes(r))) {
      secondaryKey = key;
    } else if (!secondaryKey && meta.type !== 'string' && meta.type !== 'boolean') {
      secondaryKey = key;
    }
  }

  const heroVal = heroKey ? latestValues[heroKey] : null;
  const heroMeta = heroKey ? schema[heroKey] || {} : {};

  if (!heroKey && !loading) {
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
      {/* Mini arc gauge */}
      {heroKey && (
        <SVGArcGauge
          cx={70}
          cy={65}
          radius={38}
          value={typeof heroVal === 'number' ? heroVal : null}
          min={heroMeta.min ?? 0}
          max={heroMeta.max ?? 1000}
          unit={getMetricUnit(heroKey, units, schema)}
          strokeWidth={6}
          fontSize={16}
          unitFontSize={8}
          showTicks={false}
          showMinMax={false}
          accentColor="var(--hmi-accent-meter)"
        />
      )}

      {/* Hero label */}
      {heroKey && (
        <text
          x={70}
          y={115}
          textAnchor="middle"
          fill="var(--hmi-text-muted)"
          fontSize={8}
          fontWeight={500}
          letterSpacing={0.5}
        >
          {formatMetricLabel(heroKey).toUpperCase()}
        </text>
      )}

      {/* Secondary metric on the right */}
      {secondaryKey && (
        <SVGMetricLabel
          x={125}
          y={45}
          label={formatMetricLabel(secondaryKey)}
          value={typeof latestValues[secondaryKey] === 'number' ? latestValues[secondaryKey] as number : null}
          unit={getMetricUnit(secondaryKey, units, schema)}
          size="sm"
        />
      )}
    </svg>
  );
}
