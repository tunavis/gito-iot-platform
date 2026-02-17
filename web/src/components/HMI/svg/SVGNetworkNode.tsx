'use client';

interface SVGNetworkNodeProps {
  cx: number;
  cy: number;
  size: number;
  connectedCount?: number | null;
  offline?: boolean;
}

export default function SVGNetworkNode({
  cx,
  cy,
  size,
  connectedCount,
  offline = false,
}: SVGNetworkNodeProps) {
  const half = size / 2;
  const nodeRadius = size * 0.06;
  const hubRadius = size * 0.15;
  const color = offline ? '#94a3b8' : 'var(--hmi-accent-gateway)';

  // Generate child node positions in a circle
  const nodeCount = Math.min(connectedCount ?? 6, 8);
  const nodes = Array.from({ length: nodeCount }, (_, i) => {
    const angle = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
    const r = half * 0.75;
    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    };
  });

  return (
    <g transform={`translate(${cx}, ${cy})`} opacity={offline ? 0.4 : 1}>
      {/* Connection lines from hub to nodes */}
      {nodes.map((node, i) => (
        <line
          key={`line-${i}`}
          x1={0}
          y1={0}
          x2={node.x}
          y2={node.y}
          stroke={color}
          strokeWidth={1.5}
          opacity={0.3}
          strokeDasharray="4,3"
        />
      ))}

      {/* Child nodes */}
      {nodes.map((node, i) => (
        <g key={`node-${i}`}>
          <circle
            cx={node.x}
            cy={node.y}
            r={nodeRadius}
            fill={color}
            opacity={0.6}
          />
          {/* Tiny pulse for online nodes */}
          {!offline && (
            <circle cx={node.x} cy={node.y} r={nodeRadius * 2} fill={color} opacity={0}>
              <animate
                attributeName="opacity"
                values="0.3;0;0.3"
                dur={`${2 + i * 0.3}s`}
                repeatCount="indefinite"
              />
            </circle>
          )}
        </g>
      ))}

      {/* Central hub — router icon */}
      <circle cx={0} cy={0} r={hubRadius} fill={color} opacity={0.15} stroke={color} strokeWidth={2} />

      {/* Router icon (simplified) */}
      <rect x={-hubRadius * 0.5} y={-hubRadius * 0.35} width={hubRadius} height={hubRadius * 0.7} rx={2} fill="none" stroke={color} strokeWidth={1.5} />
      {/* Signal arcs */}
      <path
        d={`M ${-hubRadius * 0.3} ${-hubRadius * 0.55} Q 0 ${-hubRadius * 0.85} ${hubRadius * 0.3} ${-hubRadius * 0.55}`}
        fill="none" stroke={color} strokeWidth={1} opacity={0.6}
      />
      <path
        d={`M ${-hubRadius * 0.15} ${-hubRadius * 0.45} Q 0 ${-hubRadius * 0.65} ${hubRadius * 0.15} ${-hubRadius * 0.45}`}
        fill="none" stroke={color} strokeWidth={1} opacity={0.4}
      />

      {/* Connected count in center */}
      {connectedCount !== null && connectedCount !== undefined && (
        <text
          x={0}
          y={hubRadius + 14}
          textAnchor="middle"
          fill="var(--hmi-text-value)"
          fontSize={12}
          fontWeight={700}
          fontFamily="var(--hmi-font-mono)"
        >
          {connectedCount}
          <tspan fill="var(--hmi-text-muted)" fontSize={8} fontWeight={500}> devices</tspan>
        </text>
      )}
    </g>
  );
}
