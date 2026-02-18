'use client';

import SVGArcGauge from '../svg/SVGArcGauge';
import SVGThermometer from '../svg/SVGThermometer';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';
import { classifyMetrics, SENSOR_RULES } from '../classifyMetrics';

// Simplified: Only renders Zone 2 (Primary Visualization)
const VB_W = 800;
const VB_H = 440;

const GAUGE_R = 210;
const GAUGE_CX = VB_W / 2;
const GAUGE_CY = VB_H / 2;

const THERM_CX = VB_W / 2;
const THERM_CY = VB_H / 2;
const THERM_H = 340;

function isTemperatureMetric(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes('temp') || k.includes('temperature');
}

export default function SensorRenderer({
  device,
  deviceType,
  latestValues,
  units,
  loading,
}: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const isOffline = device.status?.toLowerCase() === 'offline';

  const { hero } = classifyMetrics(schema, latestValues, SENSOR_RULES);

  const heroIsTemp = hero && isTemperatureMetric(hero.key);
  const heroVal = hero ? latestValues[hero.key] : null;

  if (!hero && !loading) {
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
        <filter id="sensor-offline">
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
      </defs>

      <g filter={isOffline ? 'url(#sensor-offline)' : undefined} opacity={isOffline ? 0.6 : 1}>
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />

        {/* Primary Visualization - Thermometer or Gauge */}
        {hero && heroIsTemp ? (
          <SVGThermometer
            cx={THERM_CX}
            cy={THERM_CY}
            height={THERM_H}
            value={typeof heroVal === 'number' ? heroVal : null}
            min={hero.meta.min ?? -40}
            max={hero.meta.max ?? 85}
            unit={getMetricUnit(hero.key, units, schema)}
            offline={isOffline}
          />
        ) : hero ? (
          <SVGArcGauge
            cx={GAUGE_CX}
            cy={GAUGE_CY}
            radius={GAUGE_R}
            value={typeof heroVal === 'number' ? heroVal : null}
            min={hero.meta.min ?? 0}
            max={hero.meta.max ?? 100}
            unit={getMetricUnit(hero.key, units, schema)}
            label={formatMetricLabel(hero.key)}
            strokeWidth={18}
            fontSize={56}
            unitFontSize={16}
            labelFontSize={13}
            showTicks={true}
            tickCount={7}
            showMinMax={true}
            thresholdWarning={hero.meta.thresholdWarning}
            thresholdCritical={hero.meta.thresholdCritical}
            accentColor="var(--hmi-accent-sensor)"
            offline={isOffline}
          />
        ) : null}
      </g>
    </svg>
  );
}
