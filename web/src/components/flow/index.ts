/**
 * Gito IoT Platform — Node Graph Layer
 *
 * `@xyflow/react` is the repo's one node-graph library, and this module is the
 * only place that touches it. Pages import a canvas from here; they never
 * render <ReactFlow> or compute node positions themselves.
 *
 * Public API:
 *   FlowCanvas       — themed <ReactFlow> wrapper (needs an explicit-height parent)
 *   HierarchyCanvas  — org → site → device-group graph
 *   RuleCanvas       — an alert rule's condition → logic → alarm → channel graph
 *   layoutTree       — deterministic tree positions (x by depth, y by leaf order)
 *   buildHierarchyGraph / buildRuleGraph — pure graph builders, no React
 *
 * Not in scope: `components/DeviceTemplates/` and `components/visualization/`
 * are telemetry-driven SVG artwork, not node graphs. They stay hand-rolled.
 */

export { default as FlowCanvas } from './FlowCanvas';
export { default as HierarchyCanvas } from './HierarchyCanvas';
export { default as RuleCanvas } from './RuleCanvas';
export { default as HierarchyNode } from './nodes/HierarchyNode';

export { layoutTree, COL_W, ROW_H } from './treeLayout';
export { buildHierarchyGraph } from './hierarchyGraph';
export {
  buildRuleGraph,
  normalizeRuleType,
  normalizeSeverity,
  operatorSymbol,
  channelDetail,
  notificationRuleIdFromEdge,
  OPERATOR_SYMBOL,
  ALARM_NODE_ID,
  LOGIC_NODE_ID,
  conditionNodeId,
  channelNodeId,
  wiredEdgeId,
  SEVERITY_COLOR,
} from './ruleGraph';

export { AlarmNode, ChannelNode, ConditionNode, LogicNode } from './nodes/RuleNodes';

export type { FlowCanvasProps } from './FlowCanvas';
export type { HierarchyCanvasProps } from './HierarchyCanvas';
export type { RuleCanvasProps } from './RuleCanvas';
export type { TreeItem, Positions } from './treeLayout';
export type { DeviceGroupNode, SiteNode, OrgNode, SelectedNode, HierarchyGraph } from './hierarchyGraph';
export type {
  AlertCondition,
  AlertRule,
  ConditionLogic,
  NotificationChannel,
  NotificationRule,
  RuleGraph,
  RuleType,
  Severity,
} from './ruleGraph';
export type { HierarchyKind, HierarchyNodeData } from './nodes/HierarchyNode';
