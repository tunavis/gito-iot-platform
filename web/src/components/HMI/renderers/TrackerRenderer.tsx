'use client';

import SVGCompassRose from '../svg/SVGCompassRose';
import { getMetricUnit, type HMIRendererProps } from '../index';
import { classifyMetrics, TRACKER_RULES } from '../classifyMetrics';

// Simplified: Only renders Zone 2 (Primary Visualization)
const VB_W = 800;
const VB_H = 440;

const COMPASS_CX = VB_W / 2;
const COMPASS_CY = VB_H / 2;
const COMPASS_R = 120;

export default function TrackerRenderer({
  device,
  deviceType,
  latestValues,
  units,
}: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};
  const isOffline = device.status?.toLowerCase() === 'offline';

  const { groups } = classifyMetrics(schema, latestValues, TRACKER_RULES);

  const positionMetrics = groups['POSITION'] || [];
  const motionMetrics = groups['MOTION'] || [];

  // Extract lat/lng
  let lat: number | null = null;
  let lng: number | null = null;
  if (device.location?.latitude && device.location?.longitude) {
    lat = device.location.latitude;
    lng = device.location.longitude;
  }
  for (const m of positionMetrics) {
    const k = m.key.toLowerCase();
    const val = latestValues[m.key];
    if (typeof val === 'number') {
      if (k.includes('lat')) lat = val;
      if (k.includes('lng') || k.includes('lon')) lng = val;
    }
  }

  // Heading and speed from motion metrics
  let heading: number | null = null;
  let speed: number | null = null;
  let speedUnit: string | undefined;
  for (const m of motionMetrics) {
    const k = m.key.toLowerCase();
    const val = latestValues[m.key];
    if (typeof val === 'number') {
      if (k.includes('heading') || k.includes('bearing') || k.includes('course')) heading = val;
      if (k.includes('speed') || k.includes('velocity')) {
        speed = val;
        speedUnit = getMetricUnit(m.key, units, schema);
      }
    }
  }

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="tracker-offline">
          <feColorMatrix type="saturate" values="0.15" />
        </filter>
      </defs>

      <g filter={isOffline ? 'url(#tracker-offline)' : undefined} opacity={isOffline ? 0.6 : 1}>
        <rect x={0} y={0} width={VB_W} height={VB_H} fill="var(--hmi-bg-surface)" />

        {/* Primary Visualization - Compass Rose */}
        <SVGCompassRose
          cx={COMPASS_CX}
          cy={COMPASS_CY}
          radius={COMPASS_R}
          heading={heading}
          speed={speed}
          speedUnit={speedUnit}
          offline={isOffline}
        />

        {/* Coordinates below compass */}
        {lat !== null && (
          <text x={COMPASS_CX} y={COMPASS_CY + COMPASS_R + 50} textAnchor="middle" fill="var(--hmi-text-muted)" fontSize={12}>
            LAT: <tspan fill="var(--hmi-text-value)" fontSize={14} fontWeight={600} fontFamily="var(--hmi-font-mono)">{lat.toFixed(4)}</tspan>
          </text>
        )}
        {lng !== null && (
          <text x={COMPASS_CX} y={COMPASS_CY + COMPASS_R + 75} textAnchor="middle" fill="var(--hmi-text-muted)" fontSize={12}>
            LNG: <tspan fill="var(--hmi-text-value)" fontSize={14} fontWeight={600} fontFamily="var(--hmi-font-mono)">{lng.toFixed(4)}</tspan>
          </text>
        )}
      </g>
    </svg>
  );
}