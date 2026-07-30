'use client';

import { useCallback, useMemo, useState } from 'react';
import { type Connection, type Edge, type Node, type NodeTypes } from '@xyflow/react';
import FlowCanvas from './FlowCanvas';
import useGraphNodes from './useGraphNodes';
import {
  AddConditionNode,
  AddRuleNode,
  AlarmNode,
  ChannelNode,
  ConditionNode,
  LogicNode,
} from './nodes/RuleNodes';
import type { ConditionEditorProps } from './nodes/ConditionEditor';
import { useToast } from '@/components/ToastProvider';
import {
  getMetricsForDevice,
  getSchemaForDevice,
  type Device,
  type DeviceType,
} from '@/lib/deviceSchema';
import {
  ADD_CONDITION_NODE_ID,
  ALARM_NODE_ID,
  buildRuleGraph,
  conditionForApi,
  normalizeRuleType,
  notificationRuleIdFromEdge,
  operatorSymbol,
  ruleConditions,
  type AlertCondition,
  type AlertRule,
  type NotificationChannel,
  type NotificationRule,
} from './ruleGraph';

const NODE_TYPES: NodeTypes = {
  condition: ConditionNode,
  addCondition: AddConditionNode,
  addRule: AddRuleNode,
  logic: LogicNode,
  alarm: AlarmNode,
  channel: ChannelNode,
};

const CHANNEL_PREFIX = 'channel:';

export interface RuleCanvasProps {
  tenant: string;
  rule: AlertRule;
  channels: NotificationChannel[];
  notificationRules: NotificationRule[];
  /** For the condition editor's metric dropdown — the same list the forms offer. */
  devices: Device[];
  deviceTypes: DeviceType[];
  deviceName?: string;
  /** Clicking the alarm node — opens the page's form for name/severity/cooldown. */
  onEditRule: () => void;
  /** Clicking the `New alert rule` node — opens the page's create form. */
  onCreateRule: () => void;
  /** Wiring changed on the server; the page should refetch notification rules. */
  onWiringChanged: () => void;
  /** The rule itself changed; the page should refetch rules so the list agrees. */
  onRuleChanged: () => void;
}

export default function RuleCanvas({
  tenant,
  rule,
  channels,
  notificationRules,
  devices,
  deviceTypes,
  deviceName,
  onEditRule,
  onCreateRule,
  onWiringChanged,
  onRuleChanged,
}: RuleCanvasProps) {
  const toast = useToast();

  const ruleType = normalizeRuleType(rule.rule_type);
  const conditions = useMemo(() => ruleConditions(rule), [rule]);

  // Which condition node has its editor popover open. `index === conditions.length`
  // is a draft: an appended condition that is not persisted until Save, so Cancel
  // leaves nothing behind.
  const [editing, setEditing] = useState<{ index: number; condition: AlertCondition } | null>(null);
  const [busy, setBusy] = useState(false);

  const schema = useMemo(
    () => getSchemaForDevice(rule.device_id ?? '', devices, deviceTypes),
    [rule.device_id, devices, deviceTypes],
  );
  // THRESHOLD rules compare a number; composite conditions may test any field.
  const metrics = useMemo(
    () => getMetricsForDevice(rule.device_id ?? '', devices, deviceTypes, ruleType === 'THRESHOLD'),
    [rule.device_id, devices, deviceTypes, ruleType],
  );

  /** Every rule mutation on this canvas goes through here — one endpoint, one
   *  refetch, so the canvas and the list can never show different rules. */
  const put = useCallback(
    async (body: Record<string, unknown>, failure: string) => {
      const token = localStorage.getItem('auth_token');
      if (!token) return false;

      setBusy(true);
      try {
        const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${rule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(failure, typeof err.detail === 'string' ? err.detail : 'Unknown error');
          return false;
        }
        onRuleChanged();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [tenant, rule.id, onRuleChanged, toast],
  );

  const saveCondition = useCallback(
    async (index: number, next: AlertCondition) => {
      const c = conditionForApi(next);
      const isDraft = index >= conditions.length;

      let body: Record<string, unknown>;
      if (ruleType === 'THRESHOLD') {
        body = isDraft
          // The router seeds the first condition from the stored columns itself,
          // resolving the operator format server-side — sending our own copy of
          // it would duplicate the condition (alert_rules_unified.py).
          ? { rule_type: 'COMPOSITE', conditions: [c], logic: 'AND' }
          : { metric: c.field, operator: c.operator, threshold: c.threshold };
      } else {
        // The whole array goes back every time, so every entry needs its operator
        // resolved — a sibling still holding a DB-format '>' would 422.
        const rebuilt = conditions.map(conditionForApi);
        rebuilt[index] = c; // index === length appends
        body = { conditions: rebuilt };
      }

      if (await put(body, 'Could not save the condition')) setEditing(null);
    },
    [conditions, ruleType, put],
  );

  const removeCondition = useCallback(
    async (index: number) => {
      if (conditions.length <= 1) {
        toast.error(
          'Cannot remove the last condition',
          'A rule with no conditions could never fire. Delete the rule instead.',
        );
        return;
      }
      const rebuilt = conditions.filter((_, i) => i !== index).map(conditionForApi);
      if (await put({ conditions: rebuilt }, 'Could not remove the condition')) setEditing(null);
    },
    [conditions, put, toast],
  );

  const toggleLogic = useCallback(
    () => put({ logic: rule.logic === 'OR' ? 'AND' : 'OR' }, 'Could not change the logic'),
    [put, rule.logic],
  );

  /** `+ Add condition`. On a THRESHOLD rule this converts the rule, so it says so
   *  and asks first — the rule type is user-visible on the list page. */
  const startAdd = useCallback(async () => {
    if (ruleType === 'THRESHOLD') {
      const current = `${rule.metric} ${operatorSymbol(rule.operator)} ${rule.threshold}`;
      const ok = await toast.confirm(
        `"${rule.name}" becomes a composite rule. Its current condition (${current}) becomes ` +
          `the first in the list, and the device it watches does not change. ` +
          `A composite rule cannot be converted back to a threshold rule.`,
        { title: 'Convert to a composite rule?', confirmLabel: 'Convert' },
      );
      if (!ok) return;
    }
    setEditing({
      index: conditions.length,
      condition: { field: metrics[0] ?? '', operator: 'gt', threshold: 0, weight: 1 },
    });
  }, [ruleType, rule, conditions.length, metrics, toast]);

  const graph = useMemo(() => {
    const g = buildRuleGraph(rule, notificationRules, channels, { deviceName, metricSchema: schema });

    const editorFor = (index: number, condition: AlertCondition): ConditionEditorProps => ({
      condition,
      metrics,
      schema,
      showWeight: ruleType === 'COMPOSITE',
      busy,
      onSave: (c) => saveCondition(index, c),
      onCancel: () => setEditing(null),
    });

    return {
      edges: g.edges,
      nodes: g.nodes.map((n) => {
        if (n.type === 'condition') {
          const index = Number(n.data.index);
          return {
            ...n,
            data: {
              ...n.data,
              // Only a composite rule's conditions are removable; a threshold
              // rule's single condition *is* the rule.
              onRemove: ruleType === 'COMPOSITE' ? () => removeCondition(index) : undefined,
              edit: editing?.index === index ? editorFor(index, editing.condition) : undefined,
            },
          };
        }
        if (n.id === ADD_CONDITION_NODE_ID) {
          return {
            ...n,
            data: {
              ...n.data,
              edit:
                editing && editing.index >= conditions.length
                  ? editorFor(editing.index, editing.condition)
                  : undefined,
            },
          };
        }
        return n;
      }),
    };
  }, [
    rule,
    notificationRules,
    channels,
    deviceName,
    schema,
    metrics,
    ruleType,
    busy,
    editing,
    conditions.length,
    saveCondition,
    removeCondition,
  ]);

  // Keeps hand-dragged nodes put. The graph rebuilds whenever `editing`/`busy`
  // changes — i.e. on every node click — so a plain reset here would undo a
  // drag the moment the user touched anything.
  const { nodes, edges, onNodesChange, onEdgesChange } = useGraphNodes(graph.nodes, graph.edges);

  const wiredChannelIds = useMemo(
    () =>
      new Set(
        notificationRules.filter((nr) => nr.alert_rule_id === rule.id).map((nr) => nr.channel_id),
      ),
    [notificationRules, rule.id],
  );

  /** Alarm → an unwired channel is the only connection this rule model can store. */
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const target = 'target' in c ? c.target : null;
      if (c.source !== ALARM_NODE_ID || !target?.startsWith(CHANNEL_PREFIX)) return false;
      return !wiredChannelIds.has(target.slice(CHANNEL_PREFIX.length));
    },
    [wiredChannelIds],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      const channelId = connection.target!.slice(CHANNEL_PREFIX.length);

      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const res = await fetch(`/api/v1/tenants/${tenant}/notification-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ alert_rule_id: rule.id, channel_id: channelId, enabled: true }),
      });

      if (res.ok) {
        onWiringChanged();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error('Could not wire channel', err.detail || 'Unknown error');
      }
    },
    [isValidConnection, tenant, rule.id, onWiringChanged, toast],
  );

  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const ids = deleted.map((e) => notificationRuleIdFromEdge(e.id)).filter(Boolean) as string[];
      if (ids.length === 0) return;

      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/v1/tenants/${tenant}/notification-rules/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }),
        ),
      );
      if (results.some((r) => !r.ok)) {
        toast.error('Could not unwire channel', 'The notification rule was not deleted');
      }
      onWiringChanged();
    },
    [tenant, onWiringChanged, toast],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (busy) return;
      switch (node.type) {
        case 'condition': {
          const index = Number(node.data.index);
          const condition = conditions[index];
          if (condition) setEditing({ index, condition });
          break;
        }
        case 'logic':
          void toggleLogic();
          break;
        case 'addCondition':
          void startAdd();
          break;
        case 'addRule':
          onCreateRule();
          break;
        case 'alarm':
          onEditRule();
          break;
        default:
          break; // a channel node has nothing of its own to edit here
      }
    },
    [busy, conditions, toggleLogic, startAdd, onEditRule, onCreateRule],
  );

  return (
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      isValidConnection={isValidConnection}
      nodesConnectable
      nodesDraggable
    />
  );
}
