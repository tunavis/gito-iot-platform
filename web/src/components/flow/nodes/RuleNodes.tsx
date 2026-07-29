'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Activity, Bell, Globe, Mail, MessageSquare, Plus, Sigma, X } from 'lucide-react';
import ConditionEditor, { type ConditionEditorProps } from './ConditionEditor';

/**
 * The four node kinds of an alert rule's automation graph:
 *   condition(s) → logic → alarm → channel(s)
 *
 * Only the alarm's source handle and a channel's target handle are connectable
 * — that pair is the one relationship (`notification_rules`) the flat rule model
 * can actually store. Everything else is anchor-only.
 */

export const RULE_NODE_WIDTH = 210;

const ANCHOR = { opacity: 0, width: 1, height: 1, border: 'none' } as const;
const LIVE_HANDLE = {
  width: 10,
  height: 10,
  background: 'var(--color-primary)',
  border: '2px solid var(--color-surface)',
} as const;

function Shell({
  accent,
  dimmed,
  icon,
  title,
  subtitle,
  footer,
}: {
  accent: string;
  dimmed?: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 cursor-pointer"
      style={{
        width: RULE_NODE_WIDTH,
        background: 'var(--color-surface)',
        border: `1px solid ${dimmed ? 'var(--color-border)' : accent}`,
        opacity: dimmed ? 0.5 : 1,
        borderStyle: dimmed ? 'dashed' : 'solid',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1" style={{ color: accent }}>
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider truncate">{title}</span>
      </div>
      {subtitle && (
        <p
          className="text-xs truncate"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          title={subtitle}
        >
          {subtitle}
        </p>
      )}
      {footer && (
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {footer}
        </p>
      )}
    </div>
  );
}

// ── Condition ─────────────────────────────────────────────────────────────────

export type ConditionNodeData = {
  /** Metric / field label, already humanised. */
  label: string;
  /** e.g. `> 80` */
  expression: string;
  device?: string;
  weight?: number;
  color: string;
  /** Position in the rule's condition list — what a save/remove addresses. */
  index: number;
  /** False for a THRESHOLD rule and for the last condition of a COMPOSITE one. */
  removable: boolean;
  // Injected by RuleCanvas, which owns every mutation. The graph builder stays a
  // pure function of the rule, so callbacks are added after it returns.
  edit?: ConditionEditorProps;
  onRemove?: () => void;
};
export type ConditionFlowNode = Node<ConditionNodeData, 'condition'>;

export const ConditionNode = memo(function ConditionNode({ data }: NodeProps<ConditionFlowNode>) {
  return (
    <div className="relative">
      <Shell
        accent={data.color}
        icon={<Activity className="w-3 h-3 flex-shrink-0" />}
        title={data.label}
        subtitle={data.expression}
        footer={
          [data.device, data.weight && data.weight > 1 ? `weight ${data.weight}` : null]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />
      {data.onRemove && (
        <button
          type="button"
          title="Remove this condition"
          aria-label="Remove condition"
          className="nodrag absolute -top-2 -right-2 rounded-full p-1 hover:text-red-500"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          onClick={(e) => {
            e.stopPropagation(); // else the node click opens the editor as well
            data.onRemove!();
          }}
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {data.edit && <ConditionEditor {...data.edit} />}
      <Handle type="source" position={Position.Right} style={ANCHOR} isConnectable={false} />
    </div>
  );
});

// ── Add condition ─────────────────────────────────────────────────────────────
//
// An action, not part of the evaluated graph: no handles, no edges. On a
// THRESHOLD rule it says so, because clicking it converts the rule.

export type AddConditionNodeData = {
  converts: boolean;
  color: string;
  edit?: ConditionEditorProps;
};
export type AddConditionFlowNode = Node<AddConditionNodeData, 'addCondition'>;

export const AddConditionNode = memo(function AddConditionNode({
  data,
}: NodeProps<AddConditionFlowNode>) {
  return (
    <div className="relative">
      <div
        className="rounded-lg px-3 py-2 flex items-center gap-1.5 cursor-pointer"
        // The full sentence does not fit the node width and truncated to
        // "converts to compo…", which reads as a broken label rather than a
        // warning. The confirmation dialog states the consequences in full.
        title={
          data.converts
            ? 'Adding a condition converts this threshold rule to a composite rule. You will be asked to confirm.'
            : 'Add a condition to this rule'
        }
        style={{
          width: RULE_NODE_WIDTH,
          background: 'transparent',
          border: `1px dashed var(--color-border)`,
          color: 'var(--color-text-muted)',
        }}
      >
        <Plus className="w-3 h-3 flex-shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wider truncate">
          {data.converts ? 'Add condition (converts)' : 'Add condition'}
        </span>
      </div>
      {data.edit && <ConditionEditor {...data.edit} />}
    </div>
  );
});

// ── Add rule ──────────────────────────────────────────────────────────────────
//
// A canvas-level action, not part of *this* rule's graph: no handles, no edges.
// It opens the page's create form rather than authoring a rule on the canvas —
// a rule being drawn is an unsaved draft, and this canvas deliberately keeps no
// local copy of a rule (see CLEANUP_TODO.md). Once the form saves, the canvas
// switches to the new rule, so creating still ends where you were working.

export type AddRuleNodeData = { color: string };
export type AddRuleFlowNode = Node<AddRuleNodeData, 'addRule'>;

export const AddRuleNode = memo(function AddRuleNode({ data }: NodeProps<AddRuleFlowNode>) {
  return (
    <div
      className="rounded-lg px-3 py-2 flex items-center gap-1.5 cursor-pointer"
      title="Create another alert rule"
      style={{
        width: RULE_NODE_WIDTH,
        background: 'transparent',
        border: '1px dashed var(--color-border)',
        color: data.color,
      }}
    >
      <Plus className="w-3 h-3 flex-shrink-0" />
      <span className="text-[10px] font-bold uppercase tracking-wider truncate">
        New alert rule
      </span>
    </div>
  );
});

// ── Logic ─────────────────────────────────────────────────────────────────────

export type LogicNodeData = { logic: 'AND' | 'OR'; inputs: number; color: string };
export type LogicFlowNode = Node<LogicNodeData, 'logic'>;

export const LogicNode = memo(function LogicNode({ data }: NodeProps<LogicFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} style={ANCHOR} isConnectable={false} />
      <div
        className="rounded-full px-4 py-2 flex items-center gap-1.5 cursor-pointer"
        title={`Click to switch to ${data.logic === 'AND' ? 'OR' : 'AND'}`}
        style={{ background: 'var(--color-surface)', border: `1px solid ${data.color}`, color: data.color }}
      >
        <Sigma className="w-3 h-3" />
        <span className="text-xs font-bold tracking-wider">{data.logic}</span>
        <span className="text-[10px] opacity-70">({data.inputs})</span>
      </div>
      <Handle type="source" position={Position.Right} style={ANCHOR} isConnectable={false} />
    </>
  );
});

// ── Alarm ─────────────────────────────────────────────────────────────────────

export type AlarmNodeData = {
  name: string;
  severity: string;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  enabled: boolean;
  color: string;
};
export type AlarmFlowNode = Node<AlarmNodeData, 'alarm'>;

export const AlarmNode = memo(function AlarmNode({ data }: NodeProps<AlarmFlowNode>) {
  const last = data.lastTriggeredAt
    ? `last fired ${new Date(data.lastTriggeredAt).toLocaleString()}`
    : 'never fired';
  return (
    <>
      <Handle type="target" position={Position.Left} style={ANCHOR} isConnectable={false} />
      <Shell
        accent={data.color}
        dimmed={!data.enabled}
        icon={<Bell className="w-3 h-3 flex-shrink-0" />}
        title={`${data.severity} alarm`}
        subtitle={data.name}
        footer={`cooldown ${data.cooldownMinutes}m · ${last}`}
      />
      {/* The one draggable handle on the canvas: alarm → channel. */}
      <Handle type="source" position={Position.Right} style={LIVE_HANDLE} />
    </>
  );
});

// ── Channel ───────────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="w-3 h-3 flex-shrink-0" />,
  sms: <MessageSquare className="w-3 h-3 flex-shrink-0" />,
  webhook: <Globe className="w-3 h-3 flex-shrink-0" />,
  slack: <MessageSquare className="w-3 h-3 flex-shrink-0" />,
};

export type ChannelNodeData = {
  channelType: string;
  detail: string;
  wired: boolean;
  color: string;
};
export type ChannelFlowNode = Node<ChannelNodeData, 'channel'>;

export const ChannelNode = memo(function ChannelNode({ data }: NodeProps<ChannelFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} style={data.wired ? ANCHOR : LIVE_HANDLE} />
      <Shell
        accent={data.color}
        dimmed={!data.wired}
        icon={CHANNEL_ICONS[data.channelType] ?? <Bell className="w-3 h-3 flex-shrink-0" />}
        title={data.channelType}
        subtitle={data.detail}
        footer={data.wired ? 'notified' : 'drag the alarm here to notify'}
      />
    </>
  );
});
