'use client';

import { clamp, formatCompactValue } from './helpers';

interface SVGDeviationBarProps {
  x: number;
  y: number;
  width: number;
  pv: number | null;
  sp: number | null;
  min: number;
  max: number;
  unit?: string;
  offline?: boolean;
}

export default function SVGDeviationBar({
  x,
  y,
  width,
  pv,
  sp,
  min,
  max,
  unit,
  offline = false,
}: SVGDeviationBarProps) {
  const barHeight = 12;
  const range = max - min || 1;

  const pvPct = pv !== null ? (clamp(pv, min, max) - min) / range : null;
  const spPct = sp !== null ? (clamp(sp, min, max) - min) / range : null;

  const pvX = pvPct !== null ? pvPct * width : null;
  const spX = spPct !== null ? spPct * width : null;

  const deviation = pv !== null && sp !== null ? pv - sp : null;
  const deviationPct = deviation !== null && sp !== null && sp !== 0
    ? ((deviation / sp) * 100) : null;

  // Deviation color
  const getDeviationColor = (): string => {
    if (deviation === null) return '#94a3b8';
    const absDev = Math.abs(deviation);
    const pctRange = (absDev / range) * 100;
    if (pctRange < 5) return '#22c55e';
    if (pctRange < 10) return '#f59e0b';
    return '#ef4444';
  };

  const devColor = getDeviationColor();

  return (
    <g transform={`translate(${x}, ${y})`} opacity={offline ? 0.4 : 1}>
      {/* PV and SP labels */}
      <text x={0} y={0} fill="var(--hmi-text-muted)" fontSize={9} fontWeight={500}>PV</text>
      <text x={0} y={0} fill="var(--hmi-text-value)" fontSize={13} fontWeight={700} fontFamily="var(--hmi-font-mono)" dx={18}>
        {formatCompactValue(pv)}
      </text>
      <text x={width} y={0} textAnchor="end" fill="var(--hmi-text-muted)" fontSize={9} fontWeight={500}>SP</text>
      <text x={width} y={0} textAnchor="end" fill="var(--hmi-text-value)" fontSize={13} fontWeight={700} fontFamily="var(--hmi-font-mono)" dx={-18}>
        {formatCompactValue(sp)}
      </text>
      {unit && (
        <text x={width / 2} y={0} textAnchor="middle" fill="var(--hmi-text-muted)" fontSize={9}>{unit}</text>
      )}

      {/* Track */}
      <rect
        x={0}
        y={10}
        width={width}
        height={barHeight}
        rx={2}
        fill="var(--hmi-gauge-track)"
      />

      {/* Deviation zone between PV and SP */}
      {pvX !== null && spX !== null && (
        <rect
          x={Math.min(pvX, spX)}
          y={10}
          width={Math.abs(pvX - spX)}
          height={barHeight}
          fill={devColor}
          opacity={0.3}
          className="hmi-svg-transition"
        />
      )}

      {/* SP marker */}
      {spX !== null && (
        <g className="hmi-svg-transition" transform={`translate(${spX}, 0)`}>
          <line x1={0} y1={8} x2={0} y2={10 + barHeight + 2} stroke="var(--hmi-text-muted)" strokeWidth={2} strokeDasharray="3,2" />
          <text x={0} y={10 + barHeight + 12} textAnchor="middle" fill="var(--hmi-text-muted)" fontSize={7}>SP</text>
        </g>
      )}

      {/* PV marker (triangle pointer) */}
      {pvX !== null && (
        <g className="hmi-svg-transition" transform={`translate(${pvX}, 0)`}>
          <polygon
            points={`0,${8} -4,${4} 4,${4}`}
            fill={devColor}
          />
          <line x1={0} y1={8} x2={0} y2={10 + barHeight + 2} stroke={devColor} strokeWidth={2} />
        </g>
      )}

      {/* Min/Max ticks */}
      <text x={0} y={10 + barHeight + 12} fill="var(--hmi-text-muted)" fontSize={7}>{min}</text>
      <text x={width} y={10 + barHeight + 12} textAnchor="end" fill="var(--hmi-text-muted)" fontSize={7}>{max}</text>

      {/* Deviation readout */}
      {deviation !== null && (
        <text x={width / 2} y={10 + barHeight + 22} textAnchor="middle" fill={devColor} fontSize={10} fontWeight={600}>
          Deviation: {deviation > 0 ? '+' : ''}{formatCompactValue(deviation)} {unit || ''}
          {deviationPct !== null && ` (${deviationPct > 0 ? '+' : ''}${deviationPct.toFixed(1)}%)`}
        </text>
      )}
    </g>
  );
}
