'use client';

interface SVGStateBadgeProps {
  x: number;
  y: number;
  value: string | null;
  label?: string;
  size?: 'sm' | 'lg';
}

function getStateBadgeColor(value: string | null): { bg: string; text: string; border: string } {
  if (!value) return { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' };
  const v = value.toLowerCase();
  if (['open', 'on', 'running', 'active', 'enabled', 'auto'].includes(v)) {
    return { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' };
  }
  if (['closed', 'off', 'stopped', 'idle', 'disabled', 'manual'].includes(v)) {
    return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
  }
  if (['fault', 'error', 'alarm', 'critical', 'fail'].includes(v)) {
    return { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' };
  }
  if (['warning', 'warn', 'caution'].includes(v)) {
    return { bg: '#fefce8', text: '#a16207', border: '#fef08a' };
  }
  return { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' };
}

export default function SVGStateBadge({
  x,
  y,
  value,
  label,
  size = 'sm',
}: SVGStateBadgeProps) {
  const colors = getStateBadgeColor(value);
  const text = value?.toUpperCase() || '--';
  const isLg = size === 'lg';
  const fontSize = isLg ? 16 : 11;
  const padX = isLg ? 20 : 12;
  const padY = isLg ? 10 : 6;
  const textWidth = text.length * (fontSize * 0.6);
  const width = textWidth + padX * 2;
  const height = fontSize + padY * 2;

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Label above badge */}
      {label && (
        <text
          x={width / 2}
          y={-6}
          textAnchor="middle"
          fill="var(--hmi-text-muted)"
          fontSize={8}
          fontWeight={500}
          letterSpacing={0.5}
        >
          {label.toUpperCase()}
        </text>
      )}

      {/* Badge rect */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={height / 2}
        fill={colors.bg}
        stroke={colors.border}
        strokeWidth={1}
      />

      {/* Badge text */}
      <text
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={colors.text}
        fontSize={fontSize}
        fontWeight={700}
        letterSpacing={isLg ? 1.5 : 0.5}
      >
        {text}
      </text>
    </g>
  );
}
