'use client';

import { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { Pause, Play, Trash2 } from 'lucide-react';

/**
 * The alarm → channel edge, with an on-edge toolbar.
 *
 * Why this exists: unwiring used to be "select the edge, press Delete". That was
 * undiscoverable (the only hint was a sentence of page copy), impossible on a
 * touch device with no Delete key — which is most field tablets — and it deleted
 * a notification rule with no confirmation, meaning a channel silently stopped
 * being paged.
 *
 * It also exposes the **reversible** action that was missing. A notification rule
 * has an `enabled` flag, and this canvas already drew a disabled edge dashed, but
 * there was no way to toggle it: the only action offered was the destructive one.
 * Muting a channel for a maintenance window meant destroying the wiring and
 * rebuilding it from memory later.
 *
 * The toolbar shows on hover and on selection. Selection is what makes it work by
 * touch — a tap selects the edge, which reveals the buttons — so this needs no
 * separate mobile path. Keyboard Delete still works for anyone who prefers it.
 */
export interface WiredEdgeData {
  /** Current stored state of the notification rule this edge represents. */
  enabled: boolean;
  /** Channel name, so the delete confirmation can say what stops being notified. */
  channelLabel: string;
  onToggleEnabled: () => void;
  onUnwire: () => void;
  /** True while a write is in flight — buttons must not queue a second one. */
  busy: boolean;
}

function WiredEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const d = data as unknown as WiredEdgeData | undefined;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const show = Boolean(d) && (hovered || selected);

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

      {/* A transparent fat stroke over the thin visible one: a 1px edge is a very
          small hover target, and an unhittable control is no better than none. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {d && (
        <EdgeLabelRenderer>
          <div
            // nodrag/nopan: without these, pressing a button pans the canvas.
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              opacity: show ? 1 : 0,
              // Hidden buttons must not stay clickable, or an invisible control
              // sits over the edge swallowing clicks.
              visibility: show ? 'visible' : 'hidden',
              transition: 'opacity 120ms ease',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div className="flex items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-md">
              <button
                type="button"
                disabled={d.busy}
                onClick={d.onToggleEnabled}
                title={d.enabled ? 'Disable — stop notifying, keep the wiring' : 'Enable notifications'}
                aria-label={d.enabled ? 'Disable notifications for this channel' : 'Enable notifications for this channel'}
                className="rounded p-1 text-th-secondary transition-colors hover:bg-panel hover:text-th-primary disabled:opacity-40"
              >
                {d.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                disabled={d.busy}
                onClick={d.onUnwire}
                title="Unwire this channel"
                aria-label="Unwire this channel"
                className="rounded p-1 text-th-secondary transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// memo: React Flow re-renders edges on every viewport change, and this one holds
// hover state that must survive a pan.
export default memo(WiredEdge);
