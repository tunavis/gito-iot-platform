'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Building2, MapPin, Layers } from 'lucide-react';
import { HealthDot, AlarmBadge } from '@/components/ui/HealthIndicators';

export type HierarchyKind = 'org' | 'site' | 'group';

export type HierarchyNodeData = {
  kind: HierarchyKind;
  label: string;
  deviceCount: number;
  onlineCount: number;
  activeAlarms: number;
  isSelected: boolean;
};

export type HierarchyFlowNode = Node<HierarchyNodeData, 'hierarchy'>;

export const HIERARCHY_NODE_WIDTH = 200;

const ICONS: Record<HierarchyKind, typeof Building2> = {
  org: Building2,
  site: MapPin,
  group: Layers,
};

/** Handles exist only so edges have an anchor — nothing here is connectable. */
const HANDLE_STYLE = { opacity: 0, width: 1, height: 1, border: 'none' } as const;

function HierarchyNode({ data }: NodeProps<HierarchyFlowNode>) {
  const Icon = ICONS[data.kind];
  const isOrg = data.kind === 'org';

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer"
      style={{
        width: HIERARCHY_NODE_WIDTH,
        background: data.isSelected ? 'var(--color-sidebar-active)' : 'var(--color-surface)',
        border: `1px solid ${data.isSelected ? 'var(--color-sidebar-active-text)' : 'var(--color-border)'}`,
        color: data.isSelected ? 'var(--color-sidebar-active-text)' : 'var(--color-text-primary)',
        fontSize: isOrg ? 13 : 12,
        fontWeight: isOrg ? 600 : 400,
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />

      <HealthDot alarms={data.activeAlarms} online={data.onlineCount} total={data.deviceCount} />
      <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
      <span className="flex-1 truncate">{data.label}</span>
      <span className="text-[10px] opacity-50 flex-shrink-0" style={{ fontFamily: 'var(--font-mono)' }}>
        {data.onlineCount}/{data.deviceCount}
      </span>
      <AlarmBadge count={data.activeAlarms} />

      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
    </div>
  );
}

export default memo(HierarchyNode);
