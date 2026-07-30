'use client';

import { useCallback, useMemo } from 'react';
import type { NodeTypes } from '@xyflow/react';
import FlowCanvas from './FlowCanvas';
import useGraphNodes from './useGraphNodes';
import HierarchyNode from './nodes/HierarchyNode';
import { buildHierarchyGraph, type OrgNode, type SelectedNode } from './hierarchyGraph';

// Module-level: a fresh object here would remount every node on each render.
const NODE_TYPES: NodeTypes = { hierarchy: HierarchyNode };

export interface HierarchyCanvasProps {
  /** Already filtered — dropping an org/site/group here drops its edges too. */
  orgs: OrgNode[];
  selected: SelectedNode | null;
  onSelect: (node: SelectedNode) => void;
}

export default function HierarchyCanvas({ orgs, selected, onSelect }: HierarchyCanvasProps) {
  const graph = useMemo(() => buildHierarchyGraph(orgs, selected), [orgs, selected]);
  const { index } = graph;

  // `selected` is part of the graph, so selecting a node rebuilds it — without
  // pinning, clicking a node you just moved would snap it back.
  const { nodes, edges, onNodesChange, onEdgesChange } = useGraphNodes(graph.nodes, graph.edges);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      const selection = index.get(node.id);
      if (selection) onSelect(selection);
    },
    [index, onSelect],
  );

  return (
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={handleNodeClick}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodesDraggable
    />
  );
}
