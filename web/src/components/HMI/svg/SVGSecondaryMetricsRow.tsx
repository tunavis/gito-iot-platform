'use client';

import { formatValue } from './helpers';

interface Metric {
  label: string;
  value: string | number | null;
  unit?: string;
}

interface SVGSecondaryMetricsRowProps {
  metrics: Metric[];
  x: number;
  y: number;
  width: number;
  height: number;
  offline?: boolean;
}

export default function SVGSecondaryMetricsRow({
  metrics,
  x,
  y,
  width,
  height,
  offline = false,
}: SVGSecondaryMetricsRowProps) {
  // Max 6 metrics to prevent overcrowding
  const displayMetrics = metrics.slice(0, 6);

  if (displayMetrics.length === 0) {
    return (
      <g transform={`translate(${x}, ${y})`}>
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--hmi-text-muted)"
          fontSize={11}
        >
          No secondary metrics available
        </text>
      </g>
    );
  }

  const metricWidth = width / displayMetrics.length;
  const midY = height / 2;

  return (
    <g transform={`translate(${x}, ${y})`} opacity={offline ? 0.5 : 1}>
      {/* Background */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="var(--hmi-bg-panel)"
        stroke="var(--hmi-border-subtle)"
        strokeWidth={0.5}
      />

      {displayMetrics.map((metric, i) => {
        const metricX = i * metricWidth;
        const centerX = metricX + metricWidth / 2;

        // Format value
        const formattedValue = typeof metric.value === 'number'
          ? formatValue(metric.value)
          : metric.value === null
          ? '--'
          : String(metric.value);

        const displayText = metric.unit
          ? `${formattedValue} ${metric.unit}`
          : formattedValue;

        return (
          <g key={i}>
            {/* Divider (except for first metric) */}
            {i > 0 && (
              <line
                x1={metricX}
                y1={height * 0.2}
                x2={metricX}
                y2={height * 0.8}
                stroke="var(--hmi-border-subtle)"
                strokeWidth={0.5}
              />
            )}

            {/* Label */}
            <text
              x={centerX}
              y={midY - 8}
              textAnchor="middle"
              fill="var(--hmi-text-muted)"
              fontSize={9}
              fontWeight={500}
            >
              {metric.label}
            </text>

            {/* Value */}
            <text
              x={centerX}
              y={midY + 10}
              textAnchor="middle"
              fill="var(--hmi-text-value)"
              fontSize={12}
              fontWeight={600}
              fontFamily="var(--hmi-font-mono)"
            >
              {displayText}
            </text>
          </g>
        );
      })}
    </g>
  );
}
