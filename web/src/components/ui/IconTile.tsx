import React from 'react';

/**
 * Icon badge with real depth (gradient + border + inset sheen) instead of a
 * flat opacity-tinted square. `color` drives the whole look via alpha
 * blending, so it works for any device-type/category accent color without a
 * per-color CSS variant.
 */

const SIZES = {
  sm: { box: 'w-8 h-8',   radius: 'rounded-lg' },
  md: { box: 'w-10 h-10', radius: 'rounded-xl' },
  lg: { box: 'w-12 h-12', radius: 'rounded-xl' },
} as const;

interface IconTileProps {
  color: string;
  icon: React.ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
}

export default function IconTile({ color, icon, size = 'md', className = '' }: IconTileProps) {
  const s = SIZES[size];
  return (
    <div
      className={`${s.box} ${s.radius} flex items-center justify-center flex-shrink-0 ${className}`}
      style={{
        background: `linear-gradient(155deg, ${color}29 0%, ${color}12 100%)`,
        border: `1px solid ${color}35`,
        boxShadow: `inset 0 1px 0 ${color}18, 0 1px 2px ${color}1f`,
        color,
      }}
    >
      {icon}
    </div>
  );
}
