'use client';

import { formatTimeAgo } from './helpers';
import SVGStatusDot from './SVGStatusDot';

interface SVGStatusBarProps {
  x: number;
  y: number;
  width: number;
  height?: number;
  status: string;
  lastSeen: string | null;
  activeAlarmCount: number;
  protocol?: string;
  deviceType?: string;
}

export default function SVGStatusBar({
  x,
  y,
  width,
  height = 32,
  status,
  lastSeen,
  activeAlarmCount,
  protocol,
  deviceType,
}: SVGStatusBarProps) {
  const padding = 12;
  const midY = height / 2;
  const textSize = 10;

  // Layout items left-to-right
  let cursorX = padding;

  const items: Array<{ label: string; value: string; highlight?: boolean }> = [];

  items.push({ label: '', value: status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown' });

  if (activeAlarmCount > 0) {
    items.push({ label: 'Alarms', value: String(activeAlarmCount), highlight: true });
  } else {
    items.push({ label: 'Alarms', value: '0' });
  }

  items.push({ label: 'Last Seen', value: formatTimeAgo(lastSeen) });

  if (protocol) {
    items.push({ label: 'Protocol', value: protocol.toUpperCase() });
  }

  if (deviceType) {
    items.push({ label: 'Type', value: deviceType });
  }

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Background */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="var(--hmi-bg-panel)"
        stroke="var(--hmi-border-subtle)"
        strokeWidth={1}
      />

      {/* Status dot */}
      <SVGStatusDot cx={padding + 4} cy={midY} status={status} radius={3.5} />

      {/* Status text */}
      <text
        x={padding + 14}
        y={midY}
        dominantBaseline="central"
        fill="var(--hmi-text-primary)"
        fontSize={textSize}
        fontWeight={600}
      >
        {items[0].value}
      </text>

      {/* Remaining items with dividers */}
      {(() => {
        let cx = padding + 14 + items[0].value.length * 6.5 + 12;
        return items.slice(1).map((item, i) => {
          const dividerX = cx;
          const labelX = cx + 8;
          const labelWidth = item.label.length * 5.5 + 4;
          const valueX = labelX + labelWidth;
          const valueWidth = item.value.length * 6 + 16;

          const el = (
            <g key={i}>
              {/* Divider */}
              <line
                x1={dividerX}
                y1={midY - 8}
                x2={dividerX}
                y2={midY + 8}
                stroke="var(--hmi-border-subtle)"
                strokeWidth={1}
              />
              {/* Label */}
              <text
                x={labelX}
                y={midY}
                dominantBaseline="central"
                fill="var(--hmi-text-muted)"
                fontSize={textSize - 1}
              >
                {item.label}:
              </text>
              {/* Value */}
              <text
                x={valueX}
                y={midY}
                dominantBaseline="central"
                fill={item.highlight ? 'var(--hmi-status-alarm)' : 'var(--hmi-text-primary)'}
                fontSize={textSize}
                fontWeight={item.highlight ? 700 : 500}
              >
                {item.value}
              </text>
            </g>
          );

          cx = valueX + valueWidth;
          return el;
        });
      })()}
    </g>
  );
}
