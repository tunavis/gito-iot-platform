import type { Edge } from '@xyflow/react';
import { layoutTree, type TreeItem } from './treeLayout';
import type { HierarchyFlowNode, HierarchyKind } from './nodes/HierarchyNode';

// ── Hierarchy API shapes (GET /tenants/{id}/hierarchy) ────────────────────────

export interface DeviceGroupNode {
  id: string;
  name: string;
  group_type: string | null;
  device_count: number;
  online_count: number;
  active_alarms: number;
}

export interface SiteNode {
  id: string;
  name: string;
  site_type: string | null;
  address: string | null;
  coordinates: { lat: number; lng: number } | null;
  device_count: number;
  online_count: number;
  active_alarms: number;
  device_groups: DeviceGroupNode[];
  children: SiteNode[];
}

export interface OrgNode {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'suspended';
  billing_contact: string | null;
  device_count: number;
  online_count: number;
  active_alarms: number;
  sites: SiteNode[];
}

export type SelectedNode =
  | { type: 'org'; data: OrgNode }
  | { type: 'site'; data: SiteNode }
  | { type: 'group'; data: DeviceGroupNode };

export interface HierarchyGraph {
  nodes: HierarchyFlowNode[];
  edges: Edge[];
  /** node id → the sidebar selection it stands for. */
  index: Map<string, SelectedNode>;
}

// ── Builder ───────────────────────────────────────────────────────────────────

const nodeId = (kind: HierarchyKind, id: string) => `${kind}:${id}`;

/**
 * Flattens `OrgNode → SiteNode[] → (device_groups, children)` — including the
 * recursive site nesting — into a React Flow graph. Positions come from
 * `layoutTree`, so they are derived from tree depth and leaf order and never
 * persisted. Feed this the *filtered* orgs: dropping a node from the input
 * drops its edges structurally, so no edge can point at something undrawn.
 */
export function buildHierarchyGraph(orgs: OrgNode[], selected: SelectedNode | null): HierarchyGraph {
  const items: TreeItem[] = [];
  const edges: Edge[] = [];
  const index = new Map<string, SelectedNode>();
  const meta: Array<{
    id: string;
    kind: HierarchyKind;
    label: string;
    deviceCount: number;
    onlineCount: number;
    activeAlarms: number;
  }> = [];

  const push = (
    id: string,
    parentId: string | null,
    kind: HierarchyKind,
    label: string,
    counts: { device_count: number; online_count: number; active_alarms: number },
    selection: SelectedNode,
  ) => {
    items.push({ id, parentId });
    index.set(id, selection);
    meta.push({
      id,
      kind,
      label,
      deviceCount: counts.device_count,
      onlineCount: counts.online_count,
      activeAlarms: counts.active_alarms,
    });
    if (parentId) edges.push({ id: `${parentId}->${id}`, source: parentId, target: id, type: 'smoothstep' });
  };

  const walkSite = (site: SiteNode, parentId: string) => {
    const id = nodeId('site', site.id);
    push(id, parentId, 'site', site.name, site, { type: 'site', data: site });
    // Groups before nested sites — same order the tree rendered them in.
    site.device_groups.forEach((g) =>
      push(nodeId('group', g.id), id, 'group', g.name, g, { type: 'group', data: g }),
    );
    site.children.forEach((child) => walkSite(child, id));
  };

  orgs.forEach((org) => {
    const id = nodeId('org', org.id);
    push(id, null, 'org', org.name, org, { type: 'org', data: org });
    org.sites.forEach((site) => walkSite(site, id));
  });

  const pos = layoutTree(items);
  const selectedId = selected ? nodeId(selected.type, selected.data.id) : null;

  const nodes: HierarchyFlowNode[] = meta.map((m) => ({
    id: m.id,
    type: 'hierarchy',
    deletable: false, // this canvas is a view; nothing here deletes an org/site/group
    position: pos[m.id] ?? { x: 0, y: 0 },
    data: {
      kind: m.kind,
      label: m.label,
      deviceCount: m.deviceCount,
      onlineCount: m.onlineCount,
      activeAlarms: m.activeAlarms,
      isSelected: m.id === selectedId,
    },
  }));

  return { nodes, edges, index };
}
