'use client';

import { formatCompactValue } from './helpers';

interface SVGCompassRoseProps {
  cx: number;
  cy: number;
  radius: number;
  heading: number | null;
  speed?: number | null;
  speedUnit?: string;
  offline?: boolean;
}

export default function SVGCompassRose({
  cx,
  cy,
  radius,
  heading,
  speed,
  speedUnit,
  offline = false,
}: SVGCompassRoseProps) {
  const color = offline ? '#94a3b8' : 'var(--hmi-accent-tracker)';
  const cardinals = [
    { label: 'N', angle: 0 },
    { label: 'E', angle: 90 },
    { label: 'S', angle: 180 },
    { label: 'W', angle: 270 },
  ];

  const tickCount = 12;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const angle = (i / tickCount) * 360;
    const rad = ((angle - 90) * Math.PI) / 180;
    const outer = { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
    const inner = { x: Math.cos(rad) * (radius - 4), y: Math.sin(rad) * (radius - 4) };
    return { outer, inner, isCardinal: i % 3 === 0 };
  });

  const needleLength = radius * 0.65;
  const needleRotation = heading ?? 0;

  return (
    <g transform={`translate(${cx}, ${cy})`} opacity={offline ? 0.4 : 1}>
      {/* Outer circle */}
      <circle cx={0} cy={0} r={radius} fill="none" stroke="var(--hmi-gauge-track)" strokeWidth={1.5} />

      {/* Tick marks */}
      {ticks.map((tick, i) => (
        <line
          key={i}
          x1={tick.outer.x}
          y1={tick.outer.y}
          x2={tick.inner.x}
          y2={tick.inner.y}
          stroke={tick.isCardinal ? 'var(--hmi-text-secondary)' : 'var(--hmi-gauge-tick)'}
          strokeWidth={tick.isCardinal ? 1.5 : 0.75}
        />
      ))}

      {/* Cardinal labels */}
      {cardinals.map(c => {
        const rad = ((c.angle - 90) * Math.PI) / 180;
        const labelR = radius + 10;
        return (
          <text
            key={c.label}
            x={Math.cos(rad) * labelR}
            y={Math.sin(rad) * labelR}
            textAnchor="middle"
            dominantBaseline="central"
            fill={c.label === 'N' ? color : 'var(--hmi-text-muted)'}
            fontSize={c.label === 'N' ? 11 : 9}
            fontWeight={c.label === 'N' ? 700 : 500}
          >
            {c.label}
          </text>
        );
      })}

      {/* Needle */}
      {heading !== null && (
        <g className="hmi-svg-transition" style={{ transformOrigin: '0px 0px', transform: `rotate(${needleRotation}deg)` }}>
          {/* North pointer (colored) */}
          <polygon
            points={`0,${-needleLength} -4,${-needleLength * 0.15} 4,${-needleLength * 0.15}`}
            fill={color}
          />
          {/* South tail (gray) */}
          <polygon
            points={`0,${needleLength * 0.5} -3,${needleLength * 0.1} 3,${needleLength * 0.1}`}
            fill="var(--hmi-gauge-tick)"
          />
        </g>
      )}

      {/* Center pivot */}
      <circle cx={0} cy={0} r={3} fill={color} />

      {/* Heading value */}
      <text
        x={0}
        y={radius * 0.35}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--hmi-text-value)"
        fontSize={14}
        fontWeight={700}
        fontFamily="var(--hmi-font-mono)"
      >
        {heading !== null ? `${Math.round(heading)}°` : '--'}
      </text>

      {/* Speed below */}
      {speed !== null && speed !== undefined && (
        <text
          x={0}
          y={radius * 0.35 + 16}
          textAnchor="middle"
          fill="var(--hmi-text-muted)"
          fontSize={10}
        >
          {formatCompactValue(speed)} {speedUnit || 'km/h'}
        </text>
      )}
    </g>
  );
}
