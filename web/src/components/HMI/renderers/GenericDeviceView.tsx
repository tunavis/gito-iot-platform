'use client';

import SVGArcGauge from '../svg/SVGArcGauge';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';

// Simplified: Only renders Zone 2 (Primary Visualization)
const VB_W = 1400;
const VB_H = 440;

const GAUGE_R = 210;
const GAUGE_CX = VB_W / 2;
const GAUGE_CY = VB_H / 2;

export default function GenericDeviceView({
  device,
  deviceType,
  latestValues,
  units,
  loading,
}: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const isOffline = device.status?.toLowerCase() === 'offline';

  const allKeys = Object.keys(schema).length > 0 ? Object.keys(schema) : Object.keys(latestValues);

  const numericMetrics: { key: string; meta: Record<string, any> }[] = [];
  const stringMetrics: { key: string; meta: Record<string, any> }[] = [];

  for (const key of allKeys) {
    const meta = schema[key] || {};
    const val = latestValues[key];
    if (typeof val === 'number' || meta.type === 'float' || meta.type === 'int' || meta.type === 'number') {
      numericMetrics.push({ key, meta });
    } else {
      stringMetrics.push({ key, meta });
    }
  }

  const heroMetric = numericMetrics[0] || null;
  const restNumeric = numericMetrics.slice(1);

  const heroVal = heroMetric ? latestValues[heroMetric.key] : null;
  const hasContent = numericMetrics.length > 0 || stringMetrics.length > 0;

  // Collect all secondary metrics - unused in renderer, but kept for classification
  const secondaryMetricsList = [
    ...restNumeric,
    ...stringMetrics,
  ];

  if (!hasContent && !loading) {
    return (
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />
        <text x={VB_W / 2} y={VB_H / 2} textAnchor="middle" fill="var(--hmi-text-muted)" fontSize={14}>
          No telemetry data available
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="generic-offline">
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
      </defs>

      <g filter={isOffline ? 'url(#generic-offline)' : undefined} opacity={isOffline ? 0.6 : 1}>
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />

        {/* Primary Visualization - Gauge */}
        {heroMetric && (
          <SVGArcGauge
            cx={GAUGE_CX}
            cy={GAUGE_CY}
            radius={GAUGE_R}
            value={typeof heroVal === 'number' ? heroVal : null}
            min={heroMetric.meta.min ?? 0}
            max={heroMetric.meta.max ?? 100}
            unit={getMetricUnit(heroMetric.key, units, schema)}
            label={formatMetricLabel(heroMetric.key)}
            strokeWidth={18}
            fontSize={56}
            unitFontSize={16}
            labelFontSize={13}
            showTicks={true}
            tickCount={7}
            showMinMax={true}
            thresholdWarning={heroMetric.meta.thresholdWarning}
            thresholdCritical={heroMetric.meta.thresholdCritical}
            accentColor="var(--hmi-gauge-fill)"
            offline={isOffline}
          />
        )}
      </g>
    </svg>
  );
}
