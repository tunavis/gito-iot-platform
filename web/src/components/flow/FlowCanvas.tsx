'use client';

import { useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type IsValidConnection,
} from '@xyflow/react';

/**
 * The only place in the app that renders <ReactFlow> directly. Pages import
 * this so they share one set of theme tokens, one fitView behaviour, and one
 * minimap/controls config.
 *
 * IMPORTANT: the parent element must have an explicit height. React Flow
 * measures the DOM, so a zero-height parent renders a blank canvas with no
 * error and no warning — that is the standard way this library "breaks".
 *
 * `nodeTypes` must be a module-level constant. Building it inline creates a new
 * object each render and React Flow logs a warning and remounts every node.
 */
export interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  className?: string;
  onNodeClick?: NodeMouseHandler;
  onNodesChange?: OnNodesChange;
  onEdgesChange?: OnEdgesChange;
  onConnect?: OnConnect;
  onEdgesDelete?: (edges: Edge[]) => void;
  isValidConnection?: IsValidConnection;
  /** Off by default — an affordance that does nothing is worse than none. */
  nodesConnectable?: boolean;
}

export default function FlowCanvas({
  nodes,
  edges,
  nodeTypes,
  className,
  onNodeClick,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onEdgesDelete,
  isValidConnection,
  nodesConnectable = false,
}: FlowCanvasProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        isValidConnection={isValidConnection}
        nodesDraggable={false}
        nodesConnectable={nodesConnectable}
        // Library default is Backspace only; Delete is what users reach for.
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        {/* No <MiniMap>: at these graph sizes it renders as a grey slab that
            covers real nodes and navigates nothing you can't reach by panning. */}
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
