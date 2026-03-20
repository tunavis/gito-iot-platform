'use client';

/**
 * FlowLine — Core SVG Flow Animation Component
 *
 * A reusable, telemetry-driven animated SVG line that visualizes directional flow.
 *
 * Behavior:
 *   value = 0       → no animation (static line)
 *   value > 0       → forward animation (left→right / top→bottom)
 *   value < 0       → reverse animation (right→left / bottom→top)
 *   |value| / max   → animation speed (higher magnitude = faster flow)
 *
 * Animation duration range: 0.4s (maximum speed) – 3.0s (near-zero speed)
 * Opacity scales with magnitude: dim at low flow, vivid at high flow.
 *
 * Uses CSS keyframes `viz-flow-fwd` / `viz-flow-rev` defined in globals.css.
 * No canvas. No per-device logic. No hardcoded values.
 */

import React, { useMemo } from 'react';
import type { FlowEffect, FlowDirection } from './types';
import { getEffectStyle } from './effects';

export interface FlowLineProps {
  /** Current metric value — drives animation speed and direction */
  value: number;
  /** Maximum expected value — used to normalize (default: 100) */
  maxValue?: number;
  /** Visual medium style */
  effect?: FlowEffect;
  /** Orientation of the flow line */
  direction?: FlowDirection;
  /** Stroke thickness in px (default: 6) */
  thickness?: number;
  /** Total line length in px (default: 200) */
  length?: number;
  /** Optional CSS class on the SVG root */
  className?: string;
}

const MIN_DURATION = 0.4;  // seconds — maximum animation speed
const MAX_DURATION = 3.0;  // seconds — near-zero animation speed

/** Clamp a value between [min, max] */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Map normalized magnitude [0,1] → animation duration [MAX_DURATION, MIN_DURATION] */
function normToDuration(normalized: number): number {
  return MAX_DURATION - (MAX_DURATION - MIN_DURATION) * normalized;
}

// Darker shade for pipe shadow (pre-calculated per effect)
const SHADOW_COLORS: Record<FlowEffect, string> = {
  water:  '#1d4ed8',
  gas:    '#65a30d',
  energy: '#d97706',
  air:    '#94a3b8',
};

// Lighter shade for pipe highlight
const HIGHLIGHT_COLORS: Record<FlowEffect, string> = {
  water:  '#93c5fd',
  gas:    '#d9f99d',
  energy: '#fcd34d',
  air:    '#e2e8f0',
};

export default function FlowLine({
  value,
  maxValue = 100,
  effect = 'water',
  direction = 'horizontal',
  thickness = 6,
  length = 200,
  className,
}: FlowLineProps) {
  const style = getEffectStyle(effect);

  const { normalized, duration, animating, forward } = useMemo(() => {
    const abs = Math.abs(value);
    const norm = clamp(abs / Math.max(Math.abs(maxValue), 0.001), 0, 1);
    return {
      normalized: norm,
      duration: normToDuration(norm),
      animating: norm > 0.001,
      forward: value >= 0,
    };
  }, [value, maxValue]);

  const opacity = clamp(style.baseOpacity + 0.35 * normalized, 0, 1);
  const trackOpacity = 0.15;

  // SVG dimensions — always render as horizontal, rotate for vertical
  const svgWidth  = length;
  const svgHeight = thickness + 12;      // extra space for shadow + highlight
  const cy        = svgHeight / 2;       // center Y of the pipe
  const x1        = thickness / 2;
  const x2        = svgWidth - thickness / 2;
  const highlightY = cy - (thickness / 3);  // highlight runs above center

  const animationName = animating
    ? forward ? 'viz-flow-fwd' : 'viz-flow-rev'
    : 'none';

  const filterDef = style.glowColor ? `glow-${effect}` : undefined;

  const svgStyle: React.CSSProperties =
    direction === 'vertical'
      ? { transform: 'rotate(90deg)', transformOrigin: 'center' }
      : {};

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      style={svgStyle}
      className={className}
      aria-hidden="true"
    >
      {style.glowColor && (
        <defs>
          <filter id={filterDef} x="-20%" y="-100%" width="140%" height="300%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      )}

      {/* Shadow — slightly wider, darker, gives pipe depth */}
      <line
        x1={x1} y1={cy}
        x2={x2} y2={cy}
        stroke={SHADOW_COLORS[effect]}
        strokeWidth={thickness + 2}
        strokeOpacity={0.3}
        strokeLinecap="round"
      />

      {/* Track — main pipe body */}
      <line
        x1={x1} y1={cy}
        x2={x2} y2={cy}
        stroke={style.stroke}
        strokeWidth={thickness}
        strokeOpacity={trackOpacity}
        strokeLinecap="round"
      />

      {/* Animated flow dashes */}
      <line
        x1={x1} y1={cy}
        x2={x2} y2={cy}
        stroke={style.stroke}
        strokeWidth={thickness - 2}
        strokeLinecap="round"
        strokeDasharray={`${style.dashWidth} ${style.gapWidth}`}
        filter={filterDef ? `url(#${filterDef})` : undefined}
        style={{
          strokeOpacity: opacity,
          animationName,
          animationDuration: `${duration.toFixed(2)}s`,
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationFillMode: 'none',
        }}
      />

      {/* Highlight — narrow bright line above center for 3D pipe effect */}
      <line
        x1={x1 + 2} y1={highlightY}
        x2={x2 - 2} y2={highlightY}
        stroke={HIGHLIGHT_COLORS[effect]}
        strokeWidth={Math.max(thickness * 0.25, 1.5)}
        strokeOpacity={0.4}
        strokeLinecap="round"
      />
    </svg>
  );
}