'use client';

interface SVGValveSymbolProps {
  cx: number;
  cy: number;
  size: number;
  position: number | null;     // 0-100 (0 = closed, 100 = open)
  state?: string | null;       // 'open', 'closed', 'fault', etc.
  offline?: boolean;
}

function getValveColor(state: string | null, position: number | null): string {
  if (!state && position === null) return '#94a3b8';
  const s = (state || '').toLowerCase();
  if (s === 'fault' || s === 'error') return '#dc2626';
  if (s === 'open' || (position !== null && position > 50)) return '#22c55e';
  if (s === 'closed' || (position !== null && position <= 10)) return '#64748b';
  return '#f59e0b'; // partial/transitioning
}

export default function SVGValveSymbol({
  cx,
  cy,
  size,
  position,
  state,
  offline = false,
}: SVGValveSymbolProps) {
  const half = size / 2;
  const color = offline ? '#94a3b8' : getValveColor(state ?? null, position);

  // Valve rotation: 0 at 45deg (closed), 100 at 0deg (open)
  const rotation = position !== null ? 45 - (position / 100) * 45 : 45;

  return (
    <g transform={`translate(${cx}, ${cy})`} opacity={offline ? 0.4 : 1}>
      {/* Pipe lines (horizontal) */}
      <line x1={-size} y1={0} x2={-half * 0.6} y2={0} stroke="var(--hmi-border)" strokeWidth={size * 0.12} strokeLinecap="round" />
      <line x1={half * 0.6} y1={0} x2={size} y2={0} stroke="var(--hmi-border)" strokeWidth={size * 0.12} strokeLinecap="round" />

      {/* Valve body: bowtie shape */}
      <g className="hmi-svg-transition" style={{ transformOrigin: '0px 0px', transform: `rotate(${rotation}deg)` }}>
        {/* Left triangle */}
        <polygon
          points={`${-half * 0.6},${-half * 0.5} ${-half * 0.6},${half * 0.5} 0,0`}
          fill={color}
          opacity={0.2}
          stroke={color}
          strokeWidth={1.5}
        />
        {/* Right triangle */}
        <polygon
          points={`${half * 0.6},${-half * 0.5} ${half * 0.6},${half * 0.5} 0,0`}
          fill={color}
          opacity={0.2}
          stroke={color}
          strokeWidth={1.5}
        />
      </g>

      {/* Center pivot circle */}
      <circle r={size * 0.08} fill={color} />

      {/* Stem (vertical line above valve) */}
      <line x1={0} y1={-half * 0.5} x2={0} y2={-half * 0.85} stroke={color} strokeWidth={2} />

      {/* Handwheel (circle at top of stem) */}
      <circle cx={0} cy={-half * 0.85} r={size * 0.12} fill="none" stroke={color} strokeWidth={2} />
      <line x1={-size * 0.08} y1={-half * 0.85} x2={size * 0.08} y2={-half * 0.85} stroke={color} strokeWidth={1.5} />
    </g>
  );
}
