## MODIFIED Requirements

### Requirement: Write tools record intent for approval and do not execute
The system SHALL NOT allow any MCP tool to directly perform a state-changing
action on a device. A write tool SHALL record a pending approval and return its
reference; the action SHALL only take effect after a human approves it through
the existing application path.

The tool's own description SHALL state that the action is requested and not
performed, so a consuming model reports the request accurately rather than
claiming the action completed.

A write tool SHALL additionally require a caller-supplied `reason` stating why
the action is being requested, recorded on the pending command and shown to the
approver. Without it the approver is given an instruction rather than an
argument, and the human step degrades into a rubber stamp — which is
indistinguishable from having no gate while appearing to be one.

#### Scenario: Requesting a device command through MCP
- **WHEN** an authorized caller invokes the device command tool with a reason
- **THEN** a pending approval is recorded with that reason, an approval reference
  is returned, and nothing is dispatched to the device

#### Scenario: A command is requested without a reason
- **WHEN** the device command tool is invoked with no `reason` argument
- **THEN** the call is rejected before any pending command is recorded

#### Scenario: Approval and dispatch
- **WHEN** a human approves a pending MCP-originated command
- **THEN** the command dispatches exactly once through the existing command path

#### Scenario: A command that is never approved
- **WHEN** a pending MCP-originated command is not approved
- **THEN** it never reaches the device

#### Scenario: A command is refused
- **WHEN** a human rejects a pending MCP-originated command
- **THEN** it never reaches the device, and the refusal is recorded with its
  actor — distinct from a request that merely lapsed

## ADDED Requirements

### Requirement: Every tool declares whether it is read-only or destructive
Each registered tool SHALL carry MCP `ToolAnnotations` describing its effect:
`read_only_hint` for tools that only read, `destructive_hint` for tools that
request a state change. The annotation SHALL be supplied through the registrar,
so a tool cannot be added without a decision about what it does.

This is the protocol's own mechanism for telling a client that a tool is
consequential. Without it, a client must infer intent from the description, which
is prose written for a model rather than a machine-readable contract.

#### Scenario: A client inspects the advertised tools
- **WHEN** a client lists tools
- **THEN** each read tool is annotated `read_only_hint`, and
  `send_device_command` is annotated `destructive_hint`

#### Scenario: A tool is added without declaring its effect
- **WHEN** a tool is registered with no annotation
- **THEN** registration fails, in the same way and for the same reason that a
  tool exposing a tenant identifier fails — the rule is enforced by the
  registrar, not by review
