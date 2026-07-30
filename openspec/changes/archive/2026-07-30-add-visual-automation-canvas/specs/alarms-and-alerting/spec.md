## ADDED Requirements

### Requirement: An alert rule's trigger-to-action path is presented as one graph
The system SHALL present each alert rule as a single navigable node graph showing
the complete path from telemetry condition to delivered notification: condition
node(s) → logic node → alarm node → notification channel node(s). A user SHALL be
able to answer "what happens when this rule fires, and who is told" without
leaving the alert-rules page.

The graph SHALL be derived from data that already exists — the rule's
`rule_type`, `conditions`, and `logic`, the tenant's `notification_rules` rows,
and its `notification_channels`. No node position or graph structure is persisted.

Rule values SHALL be read from the rule's API-format response representation.
Because `rule_type`, `severity`, and `operator` exist in the database in both
API and legacy formats, and the model's conversion hooks run only on Python-side
assignment and not on load, the graph builder SHALL NOT compare raw column values.

#### Scenario: A composite rule with three conditions
- **WHEN** a user opens the canvas view for a COMPOSITE rule whose `conditions`
  array has three entries and whose `logic` is `AND`
- **THEN** three condition nodes are drawn, each labelled with its field,
  operator, and threshold, all feeding one `AND` logic node, which feeds one
  alarm node

#### Scenario: A single-condition threshold rule
- **WHEN** a user opens the canvas view for a THRESHOLD rule
- **THEN** exactly one condition node is drawn and it connects directly to the
  alarm node — no logic node is rendered, because a single-input AND gate carries
  no information

#### Scenario: A rule with no channels wired
- **WHEN** a rule has no `notification_rules` rows
- **THEN** every notification channel in the tenant is still rendered as a node,
  visually distinguished as unwired, so the user can see what the rule could
  notify and where to drop a connection

### Requirement: Notification channels are wired to a rule by connecting nodes
The system SHALL let a user link a notification channel to an alert rule by
drawing an edge from that rule's alarm node to the channel node, and unlink it by
deleting that edge. Both actions SHALL go through the existing notification-rule
create and delete endpoints, so the canvas and the notification-rules list page
cannot produce divergent state.

Alarm-to-channel SHALL be the only connectable handle pair on the canvas. Nodes
SHALL NOT be draggable, and no other edge SHALL be creatable by the user — the
canvas must not offer affordances that the underlying flat rule model cannot
represent.

#### Scenario: Wiring a channel by dragging
- **WHEN** a user drags from the alarm node to an unwired channel node
- **THEN** a notification rule linking that alert rule and channel is created via
  the existing endpoint, and the edge is still present after a page reload

#### Scenario: Attempting an unsupported connection
- **WHEN** a user attempts to drag an edge between any other pair of nodes — for
  example condition to condition, or channel back to alarm
- **THEN** the connection is rejected and no request is made

### Requirement: The alert-rule canvas is additive to the existing forms
The system SHALL keep the existing list and form-based editing of alert rules
reachable, with the list as the default view. Clicking a node other than a channel
SHALL open the existing edit form for that entity rather than reimplementing
threshold or condition editing inside the canvas.

#### Scenario: Editing a condition from the canvas
- **WHEN** a user clicks a condition node
- **THEN** the existing rule edit form opens focused on that condition; the canvas
  itself provides no separate threshold editor
