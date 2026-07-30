'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react';

/**
 * Drives a canvas's node/edge state so that **user-dragged nodes stay where the
 * user put them** while everything else keeps following the computed layout.
 *
 * Why this exists: the canvases rebuild their graph from props on every data
 * change — and `editing`/`busy`/`selected` are part of that data, so merely
 * *clicking* a node rebuilds it. A plain `setNodes(graph.nodes)` therefore
 * snapped every node back to its layout position mid-interaction, which made
 * dragging useless even with `nodesDraggable` on.
 *
 * Pinning only the nodes actually dragged (rather than freezing all positions)
 * matters: if a condition is added, the untouched nodes must still reflow to
 * make room, exactly as they did before. Freezing everything would leave the
 * new node overlapping whatever used to sit at its slot.
 *
 * ponytail: positions live in a ref, not state — a drag emits a change per
 * frame, and re-rendering the whole graph on each one fights React Flow's own
 * drag handling. The ref is read only when the graph is rebuilt.
 *
 * Positions are session-only; they are not persisted, so a reload returns to
 * the computed layout. Persisting them needs a column to store them in.
 */
export function applyPinned(nodes: Node[], pinned: Map<string, XYPosition>): Node[] {
  if (pinned.size === 0) return nodes;
  return nodes.map((n) => {
    const position = pinned.get(n.id);
    return position ? { ...n, position } : n;
  });
}

export interface GraphNodesState {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: ReturnType<typeof useEdgesState>[2];
}

export default function useGraphNodes(graphNodes: Node[], graphEdges: Edge[]): GraphNodesState {
  const [nodes, setNodes, onNodesChange] = useNodesState(graphNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphEdges);
  const pinned = useRef(new Map<string, XYPosition>());

  const handleNodesChange = useCallback<OnNodesChange>(
    (changes) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position) pinned.current.set(c.id, c.position);
        // A removed node must not keep a pin, or re-adding one with the same id
        // would silently reappear at its old spot instead of in the layout.
        if (c.type === 'remove') pinned.current.delete(c.id);
      }
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  useEffect(() => {
    setNodes(applyPinned(graphNodes, pinned.current));
    setEdges(graphEdges);
  }, [graphNodes, graphEdges, setNodes, setEdges]);

  return { nodes, edges, onNodesChange: handleNodesChange, onEdgesChange };
}
