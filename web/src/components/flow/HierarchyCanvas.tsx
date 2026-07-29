'use client';

import { useCallback, useMemo } from 'react';
import type { NodeTypes } from '@xyflow/react';
import FlowCanvas from './FlowCanvas';
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
  const { nodes, edges, index } = useMemo(
    () => buildHierarchyGraph(orgs, selected),
    [orgs, selected],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      const selection = index.get(node.id);
      if (selection) onSelect(selection);
    },
    [index, onSelect],
  );

  return <FlowCanvas nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodeClick={handleNodeClick} />;
}
