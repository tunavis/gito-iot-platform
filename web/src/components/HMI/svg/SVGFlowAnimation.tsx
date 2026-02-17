'use client';

interface SVGFlowAnimationProps {
  path: string;
  active: boolean;
  speed?: number;
  color?: string;
  particleCount?: number;
  particleRadius?: number;
}

export default function SVGFlowAnimation({
  path,
  active,
  speed = 3,
  color = 'var(--hmi-accent-meter)',
  particleCount = 4,
  particleRadius = 2.5,
}: SVGFlowAnimationProps) {
  if (!active) return null;

  const duration = Math.max(1, Math.min(8, speed));

  return (
    <g opacity={0.6}>
      {Array.from({ length: particleCount }, (_, i) => {
        const delay = (i / particleCount) * duration;
        return (
          <circle key={i} r={particleRadius} fill={color} opacity={0}>
            <animateMotion
              dur={`${duration}s`}
              repeatCount="indefinite"
              path={path}
              begin={`${delay}s`}
            />
            <animate
              attributeName="opacity"
              values="0;0.8;0.8;0"
              keyTimes="0;0.1;0.9;1"
              dur={`${duration}s`}
              repeatCount="indefinite"
              begin={`${delay}s`}
            />
          </circle>
        );
      })}
    </g>
  );
}
