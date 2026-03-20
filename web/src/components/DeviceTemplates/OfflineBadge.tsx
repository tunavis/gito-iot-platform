import React from 'react';

interface OfflineBadgeCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function OfflineBadge({ crop }: { crop: OfflineBadgeCrop }) {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  return (
    <g>
      <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h}
        fill="black" fillOpacity="0.3" rx="8" />
      <rect x={cx - 75} y={cy - 25} width="150" height="50" rx="8"
        fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <circle cx={cx - 45} cy={cy} r="6" fill="#ef4444" />
      <text x={cx + 10} y={cy + 6} textAnchor="middle"
        style={{ fill: '#94a3b8', fontSize: 14, fontWeight: 600, fontFamily: 'system-ui,sans-serif' }}>
        OFFLINE
      </text>
    </g>
  );
}
