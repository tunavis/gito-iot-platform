'use client';
import React, { useId } from 'react';

interface WaveLevelProps {
  containerX: number;
  containerY: number;
  containerWidth: number;
  containerHeight: number;
  intensity: number;
  paused: boolean;
  color: string;
  highlightColor?: string;
  rippleIntensity?: number;
}

export function WaveLevel({
  containerX, containerY, containerWidth, containerHeight,
  intensity,
  paused,
  color,
  highlightColor,
  rippleIntensity,
}: WaveLevelProps) {
  const id = useId();
  const clipId = `wl-clip-${id.replace(/:/g, '')}`;

  const clampedLevel = Math.max(0, Math.min(1, intensity));
  const fillH = containerHeight * clampedLevel;
  const fillY = containerY + containerHeight - fillH;
  const active = clampedLevel > 0.02 && !paused;

  const amp = active ? 3 + clampedLevel * 3 : 0;
  const w = containerWidth;
  const cx = containerX;

  const wavePath1 = `M${cx},${fillY} c${w * 0.15},-${amp} ${w * 0.35},-${amp} ${w * 0.5},0 c${w * 0.15},${amp} ${w * 0.35},${amp} ${w * 0.5},0 V${containerY + containerHeight} H${cx} Z`;
  const wavePath2 = `M${cx},${fillY} c${w * 0.15},${amp} ${w * 0.35},${amp} ${w * 0.5},0 c${w * 0.15},-${amp} ${w * 0.35},-${amp} ${w * 0.5},0 V${containerY + containerHeight} H${cx} Z`;

  const rIntensity = rippleIntensity ?? (clampedLevel > 0 ? 0.5 : 0);
  const rippleDur = active ? `${2 + (1 - rIntensity) * 3}s` : '4s';

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={containerX} y={containerY} width={containerWidth} height={containerHeight} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {clampedLevel > 0.01 && (
          <>
            <rect x={cx} y={fillY + amp + 1} width={w} height={fillH}
              fill={color} fillOpacity={0.25} />
            {active ? (
              <path fill={color} fillOpacity={0.35}>
                <animate attributeName="d"
                  dur={rippleDur} repeatCount="indefinite"
                  values={`${wavePath1};${wavePath2};${wavePath1}`} />
              </path>
            ) : (
              <path d={wavePath1} fill={color} fillOpacity={0.35} />
            )}
            {highlightColor && (
              <rect x={cx} y={fillY} width={4} height={fillH}
                fill={highlightColor} fillOpacity={0.3} rx={2} />
            )}
          </>
        )}
      </g>
    </g>
  );
}
