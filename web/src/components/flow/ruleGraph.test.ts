import {
  ADD_CONDITION_NODE_ID,
  ALARM_NODE_ID,
  LOGIC_NODE_ID,
  buildRuleGraph,
  channelNodeId,
  conditionForApi,
  normalizeRuleType,
  normalizeSeverity,
  wiredEdgeId,
  type AlertRule,
  type NotificationChannel,
  type NotificationRule,
} from './ruleGraph';

const BASE: AlertRule = {
  id: 'rule-1',
  tenant_id: 't-1',
  name: 'Tank 3 low',
  description: null,
  rule_type: 'THRESHOLD',
  severity: 'critical',
  enabled: true,
  device_id: 'dev-1',
  metric: 'level',
  operator: 'lt',
  threshold: 20,
  conditions: null,
  logic: null,
  cooldown_minutes: 5,
  last_triggered_at: null,
  created_at: '',
  updated_at: '',
};

const CHANNELS: NotificationChannel[] = [
  { id: 'ch-1', channel_type: 'email', config: { email: 'ops@example.com' }, enabled: true },
  { id: 'ch-2', channel_type: 'sms', config: { phone: '+27000000000' }, enabled: true },
];

describe('buildRuleGraph', () => {
  it('draws a single-condition THRESHOLD rule with no logic node', () => {
    const { nodes, edges } = buildRuleGraph(BASE, [], []);

    expect(nodes.filter((n) => n.type === 'condition')).toHaveLength(1);
    expect(nodes.find((n) => n.type === 'logic')).toBeUndefined();
    expect(edges.filter((e) => e.target === ALARM_NODE_ID)).toHaveLength(1);
    expect(nodes.find((n) => n.id === 'condition:0')?.data.expression).toBe('< 20');
  });

  it('draws one logic node with three inbound edges for a 3-condition COMPOSITE rule', () => {
    const composite: AlertRule = {
      ...BASE,
      rule_type: 'COMPOSITE',
      logic: 'AND',
      device_id: null,
      metric: null,
      operator: null,
      threshold: null,
      conditions: [
        { field: 'temperature', operator: 'gt', threshold: 80, weight: 1 },
        { field: 'humidity', operator: 'gt', threshold: 90, weight: 2 },
        { field: 'pressure', operator: 'lt', threshold: 1, weight: 1 },
      ],
    };

    const { nodes, edges } = buildRuleGraph(composite, [], []);

    expect(nodes.filter((n) => n.type === 'condition')).toHaveLength(3);
    expect(nodes.filter((n) => n.type === 'logic')).toHaveLength(1);
    expect(edges.filter((e) => e.target === LOGIC_NODE_ID)).toHaveLength(3);
    expect(edges.filter((e) => e.source === LOGIC_NODE_ID && e.target === ALARM_NODE_ID)).toHaveLength(1);
    expect(nodes.find((n) => n.id === LOGIC_NODE_ID)?.data.logic).toBe('AND');
  });

  it('renders every channel as unwired when the rule has no notification rules', () => {
    const { nodes, edges } = buildRuleGraph(BASE, [], CHANNELS);

    const channelNodes = nodes.filter((n) => n.type === 'channel');
    expect(channelNodes).toHaveLength(2);
    expect(channelNodes.every((n) => n.data.wired === false)).toBe(true);
    expect(edges.filter((e) => e.source === ALARM_NODE_ID)).toHaveLength(0);
  });

  it('wires only the channels this rule routes to, and tags the edge with the notification-rule id', () => {
    const notificationRules: NotificationRule[] = [
      { id: 'nr-1', alert_rule_id: 'rule-1', channel_id: 'ch-2', enabled: true },
      { id: 'nr-2', alert_rule_id: 'some-other-rule', channel_id: 'ch-1', enabled: true },
    ];

    const { nodes, edges } = buildRuleGraph(BASE, notificationRules, CHANNELS);

    expect(nodes.find((n) => n.id === channelNodeId('ch-2'))?.data.wired).toBe(true);
    expect(nodes.find((n) => n.id === channelNodeId('ch-1'))?.data.wired).toBe(false);
    expect(edges.filter((e) => e.source === ALARM_NODE_ID)).toHaveLength(1);
    expect(edges.find((e) => e.source === ALARM_NODE_ID)?.id).toBe(wiredEdgeId('nr-1'));
  });

  it('normalises legacy DB formats rather than comparing a single literal', () => {
    expect(normalizeRuleType('COMPLEX')).toBe('COMPOSITE');
    expect(normalizeRuleType('SIMPLE')).toBe('THRESHOLD');
    expect(normalizeSeverity('MAJOR')).toBe('warning');
    expect(normalizeSeverity('MINOR')).toBe('info');

    // A rule whose rule_type survived as the legacy "COMPLEX" must still build
    // its conditions from `conditions[]`, not from the null THRESHOLD columns.
    const legacy = {
      ...BASE,
      rule_type: 'COMPLEX' as unknown as AlertRule['rule_type'],
      metric: null,
      conditions: [
        { field: 'temperature', operator: 'gt', threshold: 80, weight: 1 },
        { field: 'humidity', operator: 'gt', threshold: 90, weight: 1 },
      ],
      logic: 'OR' as const,
    };
    const { nodes } = buildRuleGraph(legacy, [], []);
    expect(nodes.filter((n) => n.type === 'condition')).toHaveLength(2);
    expect(nodes.find((n) => n.id === LOGIC_NODE_ID)?.data.logic).toBe('OR');
  });

  // ── Edit affordances ───────────────────────────────────────────────────────

  it('offers "add condition" on a THRESHOLD rule, but not on one with no metric', () => {
    expect(buildRuleGraph(BASE, [], []).nodes.find((n) => n.id === ADD_CONDITION_NODE_ID))
      .toBeDefined();

    // Nothing to seed the first condition from, and the router 400s on it — so
    // the canvas must not offer the conversion.
    const noMetric = { ...BASE, metric: null };
    expect(buildRuleGraph(noMetric, [], []).nodes.find((n) => n.id === ADD_CONDITION_NODE_ID))
      .toBeUndefined();
  });

  it('marks the "add condition" node as converting only for a THRESHOLD rule', () => {
    const composite: AlertRule = {
      ...BASE,
      rule_type: 'COMPOSITE',
      logic: 'AND',
      conditions: [{ field: 'temperature', operator: 'gt', threshold: 80, weight: 1 }],
    };

    expect(buildRuleGraph(BASE, [], []).nodes.find((n) => n.id === ADD_CONDITION_NODE_ID)?.data.converts)
      .toBe(true);
    expect(buildRuleGraph(composite, [], []).nodes.find((n) => n.id === ADD_CONDITION_NODE_ID)?.data.converts)
      .toBe(false);
  });

  it('refuses removal of the only condition, and allows it once there are two', () => {
    const one: AlertRule = {
      ...BASE,
      rule_type: 'COMPOSITE',
      conditions: [{ field: 'temperature', operator: 'gt', threshold: 80, weight: 1 }],
    };
    const two: AlertRule = {
      ...one,
      conditions: [...one.conditions!, { field: 'humidity', operator: 'lt', threshold: 30, weight: 1 }],
    };

    expect(buildRuleGraph(one, [], []).nodes.find((n) => n.id === 'condition:0')?.data.removable)
      .toBe(false);
    expect(buildRuleGraph(two, [], []).nodes.find((n) => n.id === 'condition:0')?.data.removable)
      .toBe(true);
    // A THRESHOLD rule's one condition is the rule — deleting it is the list
    // page's job, not the canvas's.
    expect(buildRuleGraph(BASE, [], []).nodes.find((n) => n.id === 'condition:0')?.data.removable)
      .toBe(false);
  });

  it('resolves a DB-format operator before sending a condition back', () => {
    // The column may hold '>' rather than 'gt', but AlertCondition.operator is a
    // Literal["gt","gte",…] — sending the stored value straight back would 422.
    expect(conditionForApi({ field: 'level', operator: '>=', threshold: 5, weight: 0 })).toEqual({
      field: 'level',
      operator: 'gte',
      threshold: 5,
      weight: 1, // clamped to the schema's ge=1
    });
    expect(conditionForApi({ field: 'level', operator: 'lt', threshold: 5, weight: 200 }).weight)
      .toBe(100);
  });
});
