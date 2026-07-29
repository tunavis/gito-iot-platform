import type { Edge, Node } from '@xyflow/react';
import { formatMetricLabel } from '@/lib/formatMetricLabel';
import { COL_W } from './treeLayout';

// ponytail: this module stays free of runtime React/@xyflow imports so it can
// be unit-tested as a plain function. `SEVERITY_COLOR` lives here, not in
// RuleNodes.tsx, for that reason.
export const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

// ── API shapes ────────────────────────────────────────────────────────────────

export type RuleType = 'THRESHOLD' | 'COMPOSITE';
export type Severity = 'info' | 'warning' | 'critical';
export type ConditionLogic = 'AND' | 'OR';

export interface AlertCondition {
  field: string;
  operator: string;
  threshold: number;
  weight: number;
}

export interface AlertRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  rule_type: RuleType;
  severity: Severity;
  enabled: boolean;
  device_id: string | null;
  metric: string | null;
  operator: string | null;
  threshold: number | null;
  conditions: AlertCondition[] | null;
  logic: ConditionLogic | null;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationChannel {
  id: string;
  channel_type: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface NotificationRule {
  id: string;
  alert_rule_id: string;
  channel_id: string;
  enabled: boolean;
}

// ── Format normalisation ──────────────────────────────────────────────────────
//
// `rule_type` and `severity` live in the DB in both API and legacy formats, and
// `to_response_dict()` passes an unrecognised value through untouched
// (`.get(v, v)`). So even the API-format response can carry a legacy string —
// mirror the backend's normalize_rule_type()/normalize_severity() here rather
// than comparing against a single literal. See unified_alert_rule.py:61-75.

export function normalizeRuleType(value: string | null | undefined): RuleType {
  const v = (value ?? '').toUpperCase();
  return v === 'COMPOSITE' || v === 'COMPLEX' ? 'COMPOSITE' : 'THRESHOLD';
}

export function normalizeSeverity(value: string | null | undefined): Severity {
  const v = (value ?? '').toUpperCase();
  if (v === 'CRITICAL') return 'critical';
  if (v === 'MINOR' || v === 'INFO') return 'info';
  return 'warning'; // WARNING, MAJOR, and anything unrecognised
}

export const OPERATOR_SYMBOL: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  '=': '=',
  '!=': '≠',
};

export const operatorSymbol = (op: string | null | undefined) =>
  (op && OPERATOR_SYMBOL[op]) || op || '';

// The stored operator may be in either format (see the note above), but the API
// only *accepts* the API format — `Literal["gt","gte",…]` on both AlertCondition
// and AlertRuleUpdate. So anything read off a rule has to be resolved before it
// is sent back. Mirrors OPERATOR_DB_TO_API in unified_alert_rule.py:25.
const OPERATOR_DB_TO_API: Record<string, string> = {
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  '=': 'eq',
  '!=': 'neq',
};

export const operatorToApi = (op: string | null | undefined): string =>
  OPERATOR_DB_TO_API[op ?? ''] ?? op ?? 'gt';

/** A condition as the API will accept it back: operator resolved, weight sane. */
export const conditionForApi = (c: AlertCondition): AlertCondition => ({
  field: c.field,
  operator: operatorToApi(c.operator),
  threshold: c.threshold,
  weight: Math.min(100, Math.max(1, Math.round(c.weight || 1))),
});

export const channelDetail = (channel: NotificationChannel): string =>
  (channel.config?.email as string) ||
  (channel.config?.phone as string) ||
  (channel.config?.webhook_url as string) ||
  'Configured';

// ── Node ids ──────────────────────────────────────────────────────────────────

export const ALARM_NODE_ID = 'alarm';
export const LOGIC_NODE_ID = 'logic';
export const ADD_CONDITION_NODE_ID = 'add-condition';
export const ADD_RULE_NODE_ID = 'add-rule';
export const conditionNodeId = (index: number) => `condition:${index}`;
export const channelNodeId = (channelId: string) => `channel:${channelId}`;
/** Alarm→channel edges carry the notification-rule id so deleting one can undo it. */
export const wiredEdgeId = (notificationRuleId: string) => `nr:${notificationRuleId}`;
export const notificationRuleIdFromEdge = (edgeId: string) =>
  edgeId.startsWith('nr:') ? edgeId.slice(3) : null;

// ── Builder ───────────────────────────────────────────────────────────────────

const ROW_H = 100;
const CONDITION_COLOR = '#3b82f6';
const LOGIC_COLOR = '#14b8a6';
const WIRED_COLOR = '#22c55e';
const UNWIRED_COLOR = '#64748b';

export interface RuleGraph {
  nodes: Node[];
  edges: Edge[];
}

/**
 * The conditions a rule actually evaluates, wherever they are stored: the
 * `conditions[]` array for COMPOSITE, the flat metric/operator/threshold columns
 * for THRESHOLD. One derivation, so the graph and the editor can never disagree
 * about what "condition 0" is.
 */
export function ruleConditions(rule: AlertRule): AlertCondition[] {
  if (normalizeRuleType(rule.rule_type) === 'COMPOSITE') return rule.conditions ?? [];
  return rule.metric
    ? [{ field: rule.metric, operator: rule.operator ?? '', threshold: rule.threshold ?? 0, weight: 1 }]
    : [];
}

/**
 * A THRESHOLD rule with no `metric` has nothing to seed its first condition
 * from, and the router refuses that conversion with a 400
 * (`alert_rules_unified.py`). Don't offer an action the server will reject.
 */
export function canAddCondition(rule: AlertRule): boolean {
  return normalizeRuleType(rule.rule_type) === 'COMPOSITE' || Boolean(rule.metric);
}

/**
 * Derives an alert rule's full trigger→action graph from data that already
 * exists. Nothing here is persisted — positions are column/row arithmetic, not
 * stored layout.
 *
 * THRESHOLD → one condition node. COMPOSITE → one per `conditions[]` entry.
 * The logic node is emitted only when there is more than one condition: a
 * one-input AND gate carries no information.
 *
 * Every tenant channel is drawn, wired or not, so the drop target for a new
 * notification rule is discoverable.
 */
export function buildRuleGraph(
  rule: AlertRule,
  notificationRules: NotificationRule[],
  channels: NotificationChannel[],
  opts: { deviceName?: string; metricSchema?: Record<string, { description?: string }> } = {},
): RuleGraph {
  const ruleType = normalizeRuleType(rule.rule_type);
  const severity = normalizeSeverity(rule.severity);

  const conditions = ruleConditions(rule);

  // No node is deletable: the alarm→channel edge is the only thing on this
  // canvas the user can remove, and it is the only thing a delete maps to a
  // real endpoint. Leaving nodes deletable would let Delete drop one from local
  // state with no server call — a change that silently vanishes on refresh.
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Column 0 — conditions.
  conditions.forEach((c, i) => {
    nodes.push({
      id: conditionNodeId(i),
      type: 'condition',
      deletable: false,
      position: { x: 0, y: i * ROW_H },
      data: {
        label: formatMetricLabel(c.field, opts.metricSchema),
        expression: `${operatorSymbol(c.operator)} ${c.threshold}`,
        device: ruleType === 'THRESHOLD' ? (opts.deviceName ?? 'All devices') : undefined,
        weight: c.weight,
        color: CONDITION_COLOR,
        index: i,
        // A COMPOSITE rule needs at least one condition (the router 400s on an
        // empty array) and a THRESHOLD rule's single condition *is* the rule —
        // removing it means deleting the rule, which the list page does.
        removable: ruleType === 'COMPOSITE' && conditions.length > 1,
      },
    });
  });

  // The `+` affordance sits under the last condition. It is an action, not part
  // of the evaluated graph, so it has no edges.
  if (canAddCondition(rule)) {
    nodes.push({
      id: ADD_CONDITION_NODE_ID,
      type: 'addCondition',
      deletable: false,
      position: { x: 0, y: conditions.length * ROW_H },
      data: { converts: ruleType === 'THRESHOLD', color: CONDITION_COLOR },
    });
  }

  const conditionsCentreY = conditions.length > 0 ? ((conditions.length - 1) * ROW_H) / 2 : 0;

  // Column 1 — logic gate, only when it disambiguates something.
  const hasLogic = conditions.length > 1;
  if (hasLogic) {
    nodes.push({
      id: LOGIC_NODE_ID,
      type: 'logic',
      deletable: false,
      position: { x: COL_W, y: conditionsCentreY },
      data: { logic: rule.logic ?? 'AND', inputs: conditions.length, color: LOGIC_COLOR },
    });
  }

  const alarmTarget = hasLogic ? LOGIC_NODE_ID : ALARM_NODE_ID;
  conditions.forEach((_, i) => {
    edges.push({
      id: `${conditionNodeId(i)}->${alarmTarget}`,
      source: conditionNodeId(i),
      target: alarmTarget,
      type: 'smoothstep',
      deletable: false,
      selectable: false,
    });
  });
  if (hasLogic) {
    edges.push({
      id: `${LOGIC_NODE_ID}->${ALARM_NODE_ID}`,
      source: LOGIC_NODE_ID,
      target: ALARM_NODE_ID,
      type: 'smoothstep',
      deletable: false,
      selectable: false,
    });
  }

  // Next column — the alarm.
  const alarmCol = hasLogic ? 2 : 1;
  const alarmY = conditionsCentreY;
  nodes.push({
    id: ALARM_NODE_ID,
    type: 'alarm',
    deletable: false,
    position: { x: alarmCol * COL_W, y: alarmY },
    data: {
      name: rule.name,
      severity,
      cooldownMinutes: rule.cooldown_minutes,
      lastTriggeredAt: rule.last_triggered_at,
      enabled: rule.enabled,
      color: SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.warning,
    },
  });

  // Directly under the alarm, the same way `+ Add condition` sits under the last
  // condition: an action in its column, no edges, not part of what is evaluated.
  // Rules are siblings — each is its own alarm — so this is the one place on the
  // canvas where "another one of these" belongs.
  nodes.push({
    id: ADD_RULE_NODE_ID,
    type: 'addRule',
    deletable: false,
    position: { x: alarmCol * COL_W, y: alarmY + ROW_H },
    data: { color: SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.warning },
  });

  // Last column — every tenant channel, wired or not, centred on the alarm.
  const wiredByChannel = new Map(
    notificationRules.filter((nr) => nr.alert_rule_id === rule.id).map((nr) => [nr.channel_id, nr]),
  );
  const channelTop = alarmY - ((channels.length - 1) * ROW_H) / 2;

  channels.forEach((channel, i) => {
    const wired = wiredByChannel.get(channel.id);
    nodes.push({
      id: channelNodeId(channel.id),
      type: 'channel',
      deletable: false,
      position: { x: (alarmCol + 1) * COL_W, y: channelTop + i * ROW_H },
      data: {
        channelType: channel.channel_type,
        detail: channelDetail(channel),
        wired: Boolean(wired),
        color: wired ? WIRED_COLOR : UNWIRED_COLOR,
      },
    });
    if (wired) {
      edges.push({
        id: wiredEdgeId(wired.id),
        source: ALARM_NODE_ID,
        target: channelNodeId(channel.id),
        type: 'smoothstep',
        deletable: true,
        animated: wired.enabled,
        style: wired.enabled ? undefined : { strokeDasharray: '4 4' },
        label: wired.enabled ? undefined : 'disabled',
      });
    }
  });

  return { nodes, edges };
}
