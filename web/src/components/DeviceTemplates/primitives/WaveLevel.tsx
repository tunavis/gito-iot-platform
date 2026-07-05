'use client';
import React, { useId } from 'react';
import { useSmoothed } from './useSmoothed';

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

/**
 * WaveLevel — liquid in a vessel.
 *
 * Depth-graded fill (lighter surface → deeper bottom), animated dual-wave
 * surface, a glint at the waterline, and slow rising bubbles when active.
 */
export function WaveLevel({
  containerX, containerY, containerWidth, containerHeight,
  intensity,
  paused,
  color,
  highlightColor,
  rippleIntensity,
}: WaveLevelProps) {
  const raw = useId().replace(/:/g, '');
  const clipId = `wl-clip-${raw}`;
  const gradId = `wl-grad-${raw}`;

  // New telemetry glides the level instead of snapping it
  const smoothIntensity = useSmoothed(intensity, 700);
  const clampedLevel = Math.max(0, Math.min(1, smoothIntensity));
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

  // Bubbles rise from the lower third to just below the surface
  const bubbles = active && fillH > 30 ? [
    { x: cx + w * 0.28, r: 1.6, dur: 4.2, begin: 0 },
    { x: cx + w * 0.55, r: 1.1, dur: 3.4, begin: -1.6 },
    { x: cx + w * 0.74, r: 1.4, dur: 5.0, begin: -2.8 },
  ] : [];

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={containerX} y={containerY} width={containerWidth} height={containerHeight} />
        </clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.55" />
          <stop offset="45%"  stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {clampedLevel > 0.01 && (
          <>
            {/* liquid body — depth-graded */}
            <rect x={cx} y={fillY + amp + 1} width={w} height={fillH}
              fill={`url(#${gradId})`} />
            {/* animated surface */}
            {active ? (
              <path fill={color} fillOpacity={0.5}>
                <animate attributeName="d"
                  dur={rippleDur} repeatCount="indefinite"
                  values={`${wavePath1};${wavePath2};${wavePath1}`} />
              </path>
            ) : (
              <path d={wavePath1} fill={color} fillOpacity={0.5} />
            )}
            {/* waterline glint */}
            <ellipse cx={cx + w * 0.32} cy={fillY + amp * 0.5 + 2} rx={w * 0.18} ry={1.6}
              fill="#ffffff" fillOpacity={active ? 0.35 : 0.2} />
            {/* rising bubbles */}
            {bubbles.map((b, i) => (
              <circle key={i} cx={b.x} r={b.r} fill="#ffffff" fillOpacity={0.4}>
                <animate attributeName="cy"
                  from={String(containerY + containerHeight - 6)}
                  to={String(fillY + 8)}
                  dur={`${b.dur}s`} begin={`${b.begin}s`} repeatCount="indefinite" />
                <animate attributeName="opacity"
                  values="0;0.5;0.5;0" keyTimes="0;0.15;0.8;1"
                  dur={`${b.dur}s`} begin={`${b.begin}s`} repeatCount="indefinite" />
              </circle>
            ))}
            {/* side light streak */}
            {highlightColor && (
              <rect x={cx + 3} y={fillY + 4} width={4} height={Math.max(0, fillH - 8)}
                fill={highlightColor} fillOpacity={0.28} rx={2} />
            )}
          </>
        )}
      </g>
    </g>
  );
}
