'use client';

import { useMemo } from 'react';
import { polarToCartesian, describeArc, clamp, percentage, formatCompactValue, getThresholdColor } from './helpers';

interface SVGArcGaugeProps {
  cx: number;
  cy: number;
  radius: number;
  value: number | null;
  min: number;
  max: number;
  unit?: string;
  label?: string;
  strokeWidth?: number;
  arcDegrees?: number;
  showTicks?: boolean;
  tickCount?: number;
  showMinMax?: boolean;
  fontSize?: number;
  unitFontSize?: number;
  labelFontSize?: number;
  thresholdWarning?: number;
  thresholdCritical?: number;
  accentColor?: string;
  offline?: boolean;
}

export default function SVGArcGauge({
  cx,
  cy,
  radius,
  value,
  min,
  max,
  unit,
  label,
  strokeWidth = 8,
  arcDegrees = 270,
  showTicks = true,
  tickCount = 7,
  showMinMax = true,
  fontSize = 28,
  unitFontSize = 12,
  labelFontSize = 10,
  thresholdWarning,
  thresholdCritical,
  accentColor = 'var(--hmi-gauge-fill)',
  offline = false,
}: SVGArcGaugeProps) {
  const startAngle = 135;
  const endAngle = startAngle + arcDegrees;
  const range = max - min || 1;
  const id = `g${cx.toFixed(0)}${cy.toFixed(0)}${radius}`;

  const pct = value !== null ? percentage(value, min, max) : 0;
  const valueAngle = startAngle + pct * arcDegrees;

  const fillColor = offline
    ? '#94a3b8'
    : getThresholdColor(value, thresholdWarning, thresholdCritical, accentColor);

  // Needle tip position
  const tipPos = polarToCartesian(0, 0, radius, valueAngle);
  const startPos = polarToCartesian(0, 0, radius, startAngle);
  const endPos = polarToCartesian(0, 0, radius, endAngle);

  // Threshold band geometry
  const thresholdBandR = radius + strokeWidth * 0.6 + 6;
  const thresholdBand = useMemo(() => {
    if (thresholdWarning === undefined && thresholdCritical === undefined) return null;
    const warnPct = thresholdWarning !== undefined ? Math.max(0, Math.min(1, (thresholdWarning - min) / range)) : null;
    const critPct = thresholdCritical !== undefined ? Math.max(0, Math.min(1, (thresholdCritical - min) / range)) : null;
    return { warnPct, critPct };
  }, [thresholdWarning, thresholdCritical, min, range]);

  // Major ticks: evenly spaced across the arc
  const majorTicks = useMemo(() => {
    if (!showTicks) return [];
    return Array.from({ length: tickCount }, (_, i) => {
      const p = i / (tickCount - 1);
      const angle = startAngle + p * arcDegrees;
      const outerR = radius + strokeWidth * 0.6 + 4;
      const innerR = radius + strokeWidth * 0.6 + 12;
      const outer = polarToCartesian(0, 0, outerR, angle);
      const inner = polarToCartesian(0, 0, innerR, angle);
      const labelR = radius + strokeWidth * 0.6 + 22;
      const labelPos = polarToCartesian(0, 0, labelR, angle);
      const tickValue = min + p * range;
      return { outer, inner, labelPos, tickValue: Math.round(tickValue * 10) / 10, angle };
    });
  }, [radius, showTicks, tickCount, startAngle, arcDegrees, min, range, strokeWidth]);

  // Minor ticks
  const minorTicks = useMemo(() => {
    if (!showTicks || tickCount < 2) return [];
    const minorPerSegment = 4;
    const result = [];
    for (let seg = 0; seg < tickCount - 1; seg++) {
      for (let m = 1; m < minorPerSegment; m++) {
        const p = (seg + m / minorPerSegment) / (tickCount - 1);
        const angle = startAngle + p * arcDegrees;
        const outerR = radius + strokeWidth * 0.6 + 4;
        const innerR = radius + strokeWidth * 0.6 + 9;
        const outer = polarToCartesian(0, 0, outerR, angle);
        const inner = polarToCartesian(0, 0, innerR, angle);
        result.push({ outer, inner });
      }
    }
    return result;
  }, [radius, showTicks, tickCount, startAngle, arcDegrees, strokeWidth]);

  const trackR = radius;
  const outerRingR = radius + strokeWidth * 0.6 + 2;

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <defs>
        {/* Glow filter for value arc */}
        <filter id={`glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Soft shadow for inner circle */}
        <filter id={`shadow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000000" floodOpacity="0.12" />
        </filter>

        {/* Gradient for value arc — horizontal sweep */}
        <linearGradient id={`arcGrad-${id}`} x1="-1" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={fillColor} stopOpacity="0.7" />
          <stop offset="100%" stopColor={fillColor} stopOpacity="1" />
        </linearGradient>

        {/* Radial gradient for face */}
        <radialGradient id={`face-${id}`} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.04" />
        </radialGradient>
      </defs>

      {/* ── Outer tick ring (bezel) ── */}
      <circle
        r={outerRingR}
        fill="none"
        stroke="var(--hmi-border-subtle)"
        strokeWidth={0.75}
        strokeDasharray="2 6"
        strokeLinecap="round"
      />

      {/* ── Threshold color band (outside track) ── */}
      {thresholdBand && (
        <g opacity={0.65}>
          {/* Normal zone: startAngle → warning (or end if no warning) */}
          <path
            d={describeArc(0, 0, thresholdBandR, startAngle, thresholdBand.warnPct !== null ? startAngle + thresholdBand.warnPct * arcDegrees : endAngle)}
            fill="none"
            stroke="var(--hmi-status-ok)"
            strokeWidth={3}
            strokeLinecap="butt"
          />
          {/* Warning zone */}
          {thresholdBand.warnPct !== null && thresholdBand.critPct !== null && (
            <path
              d={describeArc(0, 0, thresholdBandR, startAngle + thresholdBand.warnPct * arcDegrees, startAngle + thresholdBand.critPct * arcDegrees)}
              fill="none"
              stroke="var(--hmi-status-warn)"
              strokeWidth={3}
              strokeLinecap="butt"
            />
          )}
          {/* Critical zone */}
          {thresholdBand.critPct !== null && (
            <path
              d={describeArc(0, 0, thresholdBandR, startAngle + thresholdBand.critPct * arcDegrees, endAngle)}
              fill="none"
              stroke="var(--hmi-status-alarm)"
              strokeWidth={3}
              strokeLinecap="butt"
            />
          )}
        </g>
      )}

      {/* ── Track arc (background) ── */}
      {/* Shadow layer */}
      <path
        d={describeArc(0, 0, trackR, startAngle, endAngle)}
        fill="none"
        stroke="#000000"
        strokeWidth={strokeWidth + 4}
        strokeLinecap="round"
        opacity={0.06}
      />
      {/* Main track */}
      <path
        d={describeArc(0, 0, trackR, startAngle, endAngle)}
        fill="none"
        stroke="var(--hmi-gauge-track)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      {/* ── Glow: blurred copy of value arc ── */}
      {value !== null && pct > 0.005 && (
        <path
          d={describeArc(0, 0, trackR, startAngle, valueAngle)}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth * 1.8}
          strokeLinecap="round"
          opacity={0.2}
          filter={`url(#glow-${id})`}
        />
      )}

      {/* ── Value arc ── */}
      {value !== null && pct > 0.005 && (
        <path
          d={describeArc(0, 0, trackR, startAngle, valueAngle)}
          fill="none"
          stroke={`url(#arcGrad-${id})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="hmi-svg-transition"
        />
      )}

      {/* ── Needle tip circle ── */}
      {value !== null && pct > 0.005 && (
        <>
          {/* Outer ring of tip */}
          <circle
            cx={tipPos.x}
            cy={tipPos.y}
            r={strokeWidth * 0.65}
            fill={fillColor}
            opacity={0.3}
            filter={`url(#glow-${id})`}
          />
          {/* Tip dot */}
          <circle
            cx={tipPos.x}
            cy={tipPos.y}
            r={strokeWidth * 0.45}
            fill={fillColor}
          />
        </>
      )}

      {/* ── Tick marks ── */}
      {minorTicks.map((tick, i) => (
        <line
          key={`m${i}`}
          x1={tick.outer.x} y1={tick.outer.y}
          x2={tick.inner.x} y2={tick.inner.y}
          stroke="var(--hmi-gauge-tick)"
          strokeWidth={0.75}
          opacity={0.5}
        />
      ))}
      {majorTicks.map((tick, i) => (
        <g key={`t${i}`}>
          <line
            x1={tick.outer.x} y1={tick.outer.y}
            x2={tick.inner.x} y2={tick.inner.y}
            stroke="var(--hmi-text-muted)"
            strokeWidth={1.25}
          />
        </g>
      ))}

      {/* ── Min/Max labels at arc ends ── */}
      {showMinMax && (
        <>
          <text
            x={startPos.x * 0.82}
            y={startPos.y * 0.82 + 4}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--hmi-text-muted)"
            fontSize={labelFontSize}
            fontWeight={500}
          >
            {min}
          </text>
          <text
            x={endPos.x * 0.82}
            y={endPos.y * 0.82 + 4}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--hmi-text-muted)"
            fontSize={labelFontSize}
            fontWeight={500}
          >
            {max}
          </text>
        </>
      )}

      {/* ── Center face ── */}
      <circle r={radius * 0.58} fill="var(--hmi-bg-panel)" opacity={0.7} filter={`url(#shadow-${id})`} />
      <circle r={radius * 0.56} fill="var(--hmi-bg-surface)" />
      <circle r={radius * 0.56} fill={`url(#face-${id})`} />

      {/* ── Percentage arc ring on face ── */}
      <path
        d={describeArc(0, 0, radius * 0.48, startAngle, endAngle)}
        fill="none"
        stroke="var(--hmi-bg-inset)"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.8}
      />
      {value !== null && pct > 0.005 && (
        <path
          d={describeArc(0, 0, radius * 0.48, startAngle, startAngle + pct * arcDegrees)}
          fill="none"
          stroke={fillColor}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.4}
          className="hmi-svg-transition"
        />
      )}

      {/* ── Center readout ── */}
      {/* Label: UPPERCASE at top */}
      {label && (
        <text
          x={0}
          y={-fontSize * 0.52 - unitFontSize * 0.8}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--hmi-text-muted)"
          fontSize={labelFontSize * 0.95}
          fontWeight={600}
          letterSpacing={2}
          style={{ textTransform: 'uppercase' }}
        >
          {label}
        </text>
      )}

      {/* Value: large mono number */}
      <text
        x={0}
        y={2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={value !== null ? fillColor : 'var(--hmi-text-muted)'}
        fontSize={fontSize}
        fontWeight={700}
        fontFamily="var(--hmi-font-mono)"
      >
        {formatCompactValue(value)}
      </text>

      {/* Unit: below value */}
      {unit && (
        <text
          x={0}
          y={fontSize * 0.58 + 4}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--hmi-text-secondary)"
          fontSize={unitFontSize}
          fontWeight={500}
          letterSpacing={0.5}
        >
          {unit}
        </text>
      )}

      {/* Percentage label below unit */}
      {value !== null && (
        <text
          x={0}
          y={fontSize * 0.58 + unitFontSize + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--hmi-text-muted)"
          fontSize={labelFontSize * 0.85}
          fontWeight={400}
          fontFamily="var(--hmi-font-mono)"
        >
          {Math.round(pct * 100)}%
        </text>
      )}

      {/* ── Center pivot dot ── */}
      <circle r={4} fill="var(--hmi-bg-inset)" />
      <circle r={2} fill="var(--hmi-text-muted)" />
    </g>
  );
}
