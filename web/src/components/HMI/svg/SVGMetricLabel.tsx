'use client';

import { formatValue } from './helpers';

interface SVGMetricLabelProps {
  x: number;
  y: number;
  label: string;
  value: number | string | null;
  unit?: string;
  align?: 'left' | 'center' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  offline?: boolean;
}

const SIZES = {
  sm: { valueFontSize: 14, labelFontSize: 8, unitFontSize: 9, gap: 12 },
  md: { valueFontSize: 20, labelFontSize: 9, unitFontSize: 11, gap: 16 },
  lg: { valueFontSize: 28, labelFontSize: 10, unitFontSize: 13, gap: 20 },
  xl: { valueFontSize: 40, labelFontSize: 11, unitFontSize: 16, gap: 26 },
};

export default function SVGMetricLabel({
  x,
  y,
  label,
  value,
  unit,
  align = 'left',
  size = 'md',
  offline = false,
}: SVGMetricLabelProps) {
  const s = SIZES[size];
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';

  return (
    <g transform={`translate(${x}, ${y})`} opacity={offline ? 0.4 : 1}>
      {/* Label */}
      <text
        x={0}
        y={0}
        textAnchor={anchor}
        fill="var(--hmi-text-muted)"
        fontSize={s.labelFontSize}
        fontWeight={500}
        letterSpacing={0.5}
      >
        {label.toUpperCase()}
      </text>

      {/* Value + Unit */}
      <text
        x={0}
        y={s.gap}
        textAnchor={anchor}
        fill="var(--hmi-text-value)"
        fontSize={s.valueFontSize}
        fontWeight={700}
        fontFamily="var(--hmi-font-mono)"
      >
        {formatValue(value)}
        {unit && (
          <tspan
            fill="var(--hmi-text-muted)"
            fontSize={s.unitFontSize}
            fontWeight={500}
            fontFamily="inherit"
          >
            {' '}{unit}
          </tspan>
        )}
      </text>
    </g>
  );
}
