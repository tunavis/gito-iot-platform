'use client';

import { clamp, percentage, formatCompactValue } from './helpers';

interface SVGThermometerProps {
  cx: number;
  cy: number;
  height: number;
  value: number | null;
  min: number;
  max: number;
  unit?: string;
  offline?: boolean;
}

export default function SVGThermometer({
  cx,
  cy,
  height,
  value,
  min,
  max,
  unit,
  offline = false,
}: SVGThermometerProps) {
  const tubeWidth = 14;
  const bulbRadius = 12;
  const tubeHeight = height - bulbRadius * 2;
  const tubeX = cx - tubeWidth / 2;
  const tubeTop = cy - height / 2;
  const bulbCY = tubeTop + tubeHeight + bulbRadius;
  const innerWidth = tubeWidth - 4;

  const pct = value !== null ? percentage(value, min, max) : 0;
  const mercuryHeight = pct * tubeHeight;
  const mercuryTop = tubeTop + tubeHeight - mercuryHeight;

  // Color gradient: blue (cold) -> green (mild) -> red (hot)
  const getMercuryColor = (): string => {
    if (value === null || offline) return '#94a3b8';
    if (pct < 0.3) return '#3b82f6';
    if (pct < 0.6) return '#22c55e';
    if (pct < 0.8) return '#f59e0b';
    return '#ef4444';
  };

  const color = getMercuryColor();

  return (
    <g opacity={offline ? 0.4 : 1}>
      {/* Tube background */}
      <rect
        x={tubeX}
        y={tubeTop}
        width={tubeWidth}
        height={tubeHeight}
        rx={tubeWidth / 2}
        fill="var(--hmi-gauge-track)"
        stroke="var(--hmi-border-subtle)"
        strokeWidth={1}
      />

      {/* Mercury fill */}
      {value !== null && (
        <rect
          x={cx - innerWidth / 2}
          y={mercuryTop}
          width={innerWidth}
          height={mercuryHeight + bulbRadius}
          rx={innerWidth / 2}
          fill={color}
          className="hmi-svg-transition"
        />
      )}

      {/* Bulb */}
      <circle
        cx={cx}
        cy={bulbCY}
        r={bulbRadius}
        fill={value !== null ? color : 'var(--hmi-gauge-track)'}
        stroke="var(--hmi-border-subtle)"
        strokeWidth={1}
        className="hmi-svg-transition"
      />

      {/* Bulb inner highlight */}
      <circle
        cx={cx - 2}
        cy={bulbCY - 2}
        r={3}
        fill="white"
        opacity={0.3}
      />

      {/* Value text to the right */}
      <text
        x={cx + tubeWidth / 2 + 8}
        y={bulbCY}
        dominantBaseline="central"
        fill="var(--hmi-text-value)"
        fontSize={16}
        fontWeight={700}
        fontFamily="var(--hmi-font-mono)"
      >
        {formatCompactValue(value)}
      </text>
      {unit && (
        <text
          x={cx + tubeWidth / 2 + 8}
          y={bulbCY + 16}
          dominantBaseline="central"
          fill="var(--hmi-text-muted)"
          fontSize={10}
          fontWeight={500}
        >
          {unit}
        </text>
      )}

      {/* Min/Max tick labels */}
      <text
        x={tubeX - 4}
        y={tubeTop + 4}
        textAnchor="end"
        fill="var(--hmi-text-muted)"
        fontSize={8}
      >
        {max}
      </text>
      <text
        x={tubeX - 4}
        y={tubeTop + tubeHeight}
        textAnchor="end"
        fill="var(--hmi-text-muted)"
        fontSize={8}
      >
        {min}
      </text>
    </g>
  );
}
