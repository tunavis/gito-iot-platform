'use client';

import { ReactNode } from 'react';

interface HMIWorkspaceProps {
  children: ReactNode;
}

/**
 * HMIWorkspace - Container for the primary HMI visualization (Zone 2)
 *
 * Responsibilities:
 * - Provides full-width, centered container for the renderer
 * - Maintains proper aspect ratio and sizing
 * - No chrome/UI - just the visualization space
 */
export default function HMIWorkspace({ children }: HMIWorkspaceProps) {
  return (
    <div
      className="w-full flex-1 flex items-center justify-center"
      style={{ background: 'var(--hmi-bg-surface)' }}
    >
      <div className="w-full max-w-full">
        {children}
      </div>
    </div>
  );
}
