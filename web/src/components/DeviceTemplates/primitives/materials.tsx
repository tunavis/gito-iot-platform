'use client';

/**
 * materials — shared SVG material system for device templates.
 *
 * One light source (top-left), machined-metal surfaces, dark instrument glass,
 * and glow filters. All gradients are OVERLAYS (white/black at low opacity)
 * painted on top of theme-var base fills, so both light and dark themes work.
 *
 * useMaterials() returns per-instance def ids (useId) so multiple templates
 * can render on one page without url(#id) collisions.
 */

import React, { useId } from 'react';

export interface Materials {
  /** Mount once inside the template root <g> */
  defs: React.ReactElement;
  /** Vertical metal overlay — paint over a var(--color-panel) base rect */
  metalV: string;
  /** Horizontal metal overlay — for cylinders/pipes lying on their side */
  metalH: string;
  /** Dark instrument-glass radial fill (theme-independent) */
  glass: string;
  /** Diagonal white sheen for glass reflections */
  sheen: string;
  /** Small glow — LEDs, particles */
  glowSm: string;
  /** Medium glow — flow cores, active arcs */
  glowMd: string;
  /** Heavy blur — ambient-occlusion ground shadows */
  soft: string;
}

export function useMaterials(): Materials {
  const raw = useId().replace(/:/g, '');
  const id = (k: string) => `m-${k}-${raw}`;
  const url = (k: string) => `url(#${id(k)})`;

  const defs = (
    <defs>
      {/* Machined metal: light hits top, falls off to a hard lower edge */}
      <linearGradient id={id('metalV')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.22" />
        <stop offset="18%"  stopColor="#ffffff" stopOpacity="0.07" />
        <stop offset="55%"  stopColor="#000000" stopOpacity="0.05" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
      </linearGradient>
      <linearGradient id={id('metalH')} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stopColor="#000000" stopOpacity="0.22" />
        <stop offset="30%"  stopColor="#ffffff" stopOpacity="0.10" />
        <stop offset="50%"  stopColor="#ffffff" stopOpacity="0.16" />
        <stop offset="70%"  stopColor="#ffffff" stopOpacity="0.06" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.26" />
      </linearGradient>
      {/* Instrument glass: always dark, like a real gauge face */}
      <radialGradient id={id('glass')} cx="0.35" cy="0.3" r="1.1">
        <stop offset="0%"   stopColor="#1b2432" />
        <stop offset="60%"  stopColor="#111826" />
        <stop offset="100%" stopColor="#0a0f18" />
      </radialGradient>
      <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.14" />
        <stop offset="35%"  stopColor="#ffffff" stopOpacity="0.03" />
        <stop offset="60%"  stopColor="#ffffff" stopOpacity="0" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <filter id={id('glowSm')} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="1.6" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id={id('glowMd')} x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="3.2" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id={id('soft')} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
  );

  return {
    defs,
    metalV: url('metalV'),
    metalH: url('metalH'),
    glass:  url('glass'),
    sheen:  url('sheen'),
    glowSm: url('glowSm'),
    glowMd: url('glowMd'),
    soft:   url('soft'),
  };
}

/** Soft elliptical ground shadow — anchors the device to the panel */
export function AOShadow({ cx, cy, rx, ry = 6, soft, opacity = 0.25 }: {
  cx: number; cy: number; rx: number; ry?: number;
  /** Materials.soft filter url */
  soft: string;
  opacity?: number;
}) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" fillOpacity={opacity} filter={soft} />;
}

/** Dark instrument-glass panel with rim, inner shadow, and diagonal sheen */
export function GlassFace({ x, y, width, height, rx = 8, m }: {
  x: number; y: number; width: number; height: number; rx?: number;
  m: Materials;
}) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={rx} fill={m.glass} />
      {/* inner rim — recessed look */}
      <rect x={x + 1} y={y + 1} width={width - 2} height={height - 2} rx={rx - 1}
        fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="1.5" />
      <rect x={x} y={y} width={width} height={height} rx={rx}
        fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />
      {/* diagonal reflection */}
      <rect x={x} y={y} width={width} height={height} rx={rx} fill={m.sheen} pointerEvents="none" />
    </g>
  );
}

/** Metal body: theme-panel base + machined overlay + edge strokes, one call */
export function MetalBody({ x, y, width, height, rx = 8, m, horizontal = false }: {
  x: number; y: number; width: number; height: number; rx?: number;
  m: Materials;
  /** true for cylinders lying on their side (pipes, motors) */
  horizontal?: boolean;
}) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={rx}
        style={{ fill: 'var(--color-panel)' }} />
      <rect x={x} y={y} width={width} height={height} rx={rx}
        fill={horizontal ? m.metalH : m.metalV} />
      <rect x={x} y={y} width={width} height={height} rx={rx}
        fill="none" style={{ stroke: 'var(--color-border)' }} strokeWidth="1.5" />
      {/* top edge catch-light */}
      <line x1={x + rx} y1={y + 1} x2={x + width - rx} y2={y + 1}
        stroke="#ffffff" strokeOpacity="0.25" strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}
