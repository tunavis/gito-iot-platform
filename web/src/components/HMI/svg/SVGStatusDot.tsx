'use client';

import { getStatusColor } from './helpers';

interface SVGStatusDotProps {
  cx: number;
  cy: number;
  status: string;
  radius?: number;
}

export default function SVGStatusDot({
  cx,
  cy,
  status,
  radius = 4,
}: SVGStatusDotProps) {
  const color = getStatusColor(status);
  const isOnline = status?.toLowerCase() === 'online' || status?.toLowerCase() === 'active';

  return (
    <g>
      {/* Pulse ring for online */}
      {isOnline && (
        <circle cx={cx} cy={cy} r={radius * 2} fill={color} opacity={0}>
          <animate
            attributeName="opacity"
            values="0.4;0;0.4"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="r"
            values={`${radius};${radius * 2.5};${radius}`}
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      {/* Solid dot */}
      <circle cx={cx} cy={cy} r={radius} fill={color} />
    </g>
  );
}
