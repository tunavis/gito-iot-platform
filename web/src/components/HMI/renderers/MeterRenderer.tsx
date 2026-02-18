'use client';

import SVGArcGauge from '../svg/SVGArcGauge';
import SVGFlowAnimation from '../svg/SVGFlowAnimation';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';
import { classifyMetrics, METER_RULES } from '../classifyMetrics';

// Simplified: Only renders Zone 2 (Primary Visualization)
const VB_W = 800;
const VB_H = 440;

const GAUGE_R = 210; // 420px diameter
const GAUGE_CX = VB_W / 2;
const GAUGE_CY = VB_H / 2;

export default function MeterRenderer({
  device,
  deviceType,
  latestValues,
  units,
  loading,
}: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const isOffline = device.status?.toLowerCase() === 'offline';

  const { hero } = classifyMetrics(schema, latestValues, METER_RULES);

  // Flow animation — active when hero has a positive flow/rate value
  const heroVal = hero ? latestValues[hero.key] : null;
  const flowActive = typeof heroVal === 'number' && heroVal > 0;
  const flowSpeed = typeof heroVal === 'number' && heroVal > 0
    ? Math.max(1, Math.min(6, 6 - (heroVal / (hero?.meta.max || 100)) * 5))
    : 4;

  // Circular flow path around the gauge
  const flowPath = `M ${GAUGE_CX - GAUGE_R - 30} ${GAUGE_CY} A ${GAUGE_R + 30} ${GAUGE_R + 30} 0 1 1 ${GAUGE_CX + GAUGE_R + 30} ${GAUGE_CY}`;

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
        <filter id="meter-offline">
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
      </defs>

      <g filter={isOffline ? 'url(#meter-offline)' : undefined} opacity={isOffline ? 0.6 : 1}>
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />

        {/* Flow animation particles around gauge */}
        <SVGFlowAnimation
          path={flowPath}
          active={flowActive}
          speed={flowSpeed}
          color="var(--hmi-accent-meter)"
          particleCount={8}
          particleRadius={4}
        />

        {/* Central Arc Gauge — Hero Metric */}
        {hero && (
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
            accentColor="var(--hmi-accent-meter)"
            offline={isOffline}
          />
        )}
      </g>
    </svg>
  );
}
