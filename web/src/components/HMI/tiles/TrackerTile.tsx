'use client';

import SVGCompassRose from '../svg/SVGCompassRose';
import SVGMetricLabel from '../svg/SVGMetricLabel';
import { formatMetricLabel, getMetricUnit, type HMIRendererProps } from '../index';

const VB_W = 200;
const VB_H = 140;
const LOCATION_KEYS = ['latitude', 'longitude', 'lat', 'lng', 'lon'];

export default function TrackerTile({ device, deviceType, latestValues, units, loading }: HMIRendererProps) {
  const schema: Record<string, any> = deviceType?.telemetry_schema || {};

  let lat: number | null = null;
  let lng: number | null = null;
  let heading: number | null = null;
  let speed: number | null = null;
  let speedUnit: string | undefined;

  if (device.location?.latitude && device.location?.longitude) {
    lat = device.location.latitude;
    lng = device.location.longitude;
  }
  for (const [key, val] of Object.entries(latestValues)) {
    const k = key.toLowerCase();
    if (typeof val === 'number') {
      if (k.includes('lat')) lat = val;
      if (k.includes('lng') || k.includes('lon')) lng = val;
      if (k.includes('heading') || k.includes('bearing')) heading = val;
      if (k.includes('speed') || k.includes('velocity')) {
        speed = val;
        speedUnit = getMetricUnit(key, units, schema);
      }
    }
  }

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {/* Mini compass */}
      <SVGCompassRose
        cx={60}
        cy={55}
        radius={35}
        heading={heading}
        speed={speed}
        speedUnit={speedUnit}
      />

      {/* Coordinates */}
      {lat !== null && lng !== null ? (
        <g>
          <text x={120} y={40} fill="var(--hmi-text-muted)" fontSize={7} fontWeight={500}>LAT</text>
          <text x={120} y={52} fill="var(--hmi-text-value)" fontSize={10} fontWeight={600} fontFamily="var(--hmi-font-mono)">
            {lat.toFixed(4)}
          </text>
          <text x={120} y={70} fill="var(--hmi-text-muted)" fontSize={7} fontWeight={500}>LNG</text>
          <text x={120} y={82} fill="var(--hmi-text-value)" fontSize={10} fontWeight={600} fontFamily="var(--hmi-font-mono)">
            {lng.toFixed(4)}
          </text>
        </g>
      ) : (
        <text x={120} y={55} fill="var(--hmi-text-muted)" fontSize={9}>No location</text>
      )}
    </svg>
  );
}
