## ADDED Requirements

### Requirement: A rule's conditions and logic are editable on the canvas
The system SHALL let a user edit an alert rule's stored trigger values from the
canvas, at the node that draws them: a condition node's metric, operator,
threshold, and weight, and the logic node's `AND`/`OR`. Each edit SHALL be
written through the existing alert-rule update endpoint, so the canvas and the
form pages cannot produce divergent rules.

Edits SHALL be saved on an explicit action, not on every keystroke, and the
canvas SHALL NOT hold its own copy of the rule — after a successful write it
refetches, so what is drawn is always what is stored.

Rule attributes that do not belong to a node — name, description, severity,
cooldown — SHALL remain in the existing rule form and SHALL NOT be duplicated
on the canvas.

#### Scenario: Changing a threshold from the canvas
- **WHEN** a user clicks a condition node, changes the threshold, and saves
- **THEN** the rule is updated through the existing endpoint and the node redraws
  with the new value, which survives a page reload

#### Scenario: Flipping a composite rule's logic
- **WHEN** a user clicks the `AND` logic node of a COMPOSITE rule
- **THEN** the rule's `logic` becomes `OR`, and the node redraws showing `OR`

#### Scenario: Cancelling an edit
- **WHEN** a user opens a condition node's editor, changes a value, and cancels
- **THEN** no request is made and the node still shows the stored value

### Requirement: Conditions can be added to and removed from a composite rule
The system SHALL let a user append a condition to a COMPOSITE rule and remove an
existing one from the canvas, writing the whole `conditions` array through the
existing update endpoint.

Removing the last remaining condition SHALL be refused — a COMPOSITE rule with
no conditions can never fire, and the evaluation engine treats it as unevaluable.

#### Scenario: Adding a third condition
- **WHEN** a user adds a condition to a rule that has two
- **THEN** the rule has three conditions, all three feed the logic node, and the
  logic node reports three inputs

#### Scenario: Removing the only condition
- **WHEN** a user attempts to remove the last condition of a COMPOSITE rule
- **THEN** the removal is refused and the rule is left unchanged

### Requirement: A threshold rule converts to composite explicitly
The system SHALL allow a THRESHOLD rule to be converted to a COMPOSITE rule when
the user adds a second condition to it, and SHALL require explicit confirmation
that names the consequence before doing so. The conversion SHALL NOT happen
silently, because a rule's type is user-visible on the rules list.

On conversion the system SHALL seed the first condition from the rule's stored
metric, operator, and threshold, resolving the operator from whichever format it
is stored in rather than trusting a client-supplied value. The rule's `device_id`
SHALL be preserved, so the converted rule keeps exactly the device scope it had.

The conversion and the resulting field updates SHALL be applied in a single
update request, so no half-converted rule is ever persisted.

The reverse conversion, COMPOSITE to THRESHOLD, SHALL NOT be offered — collapsing
several conditions into one metric and threshold has no correct answer.

#### Scenario: Adding a second condition to a threshold rule
- **WHEN** a user adds a condition to a THRESHOLD rule and confirms the
  conversion
- **THEN** the rule becomes COMPOSITE with two conditions — the first seeded from
  its previous metric, operator, and threshold — a logic node appears, and the
  rule is still scoped to the same device

#### Scenario: Declining the conversion
- **WHEN** a user is asked to confirm converting a THRESHOLD rule and declines
- **THEN** no request is made and the rule remains a THRESHOLD rule

#### Scenario: A converted rule still fires
- **WHEN** telemetry arrives for the device a converted rule is scoped to
- **THEN** the rule is evaluated by the existing composite evaluation path, not
  the threshold path, using its conditions and logic
