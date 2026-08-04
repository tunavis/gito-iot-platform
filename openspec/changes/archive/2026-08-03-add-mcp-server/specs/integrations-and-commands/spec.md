## ADDED Requirements

### Requirement: Device commands support a pending-approval state
The system SHALL support a pending-approval state for device commands, in which a
command is recorded with its target device and payload but is not dispatched. A
pending command SHALL only dispatch after a human approves it, and SHALL dispatch
exactly once.

This state SHALL be reachable from the MCP tool surface. Commands issued through
the existing application UI or REST path SHALL remain unchanged and SHALL NOT
become approval-gated by this capability.

#### Scenario: A pending command awaits approval
- **WHEN** a command is created in the pending-approval state
- **THEN** nothing is sent to the device, and the command is retrievable with its
  target, payload, and requesting actor

#### Scenario: Approving a pending command
- **WHEN** a human with permission to issue commands approves a pending command
- **THEN** it dispatches through the existing command path exactly once, and
  re-approving it does not dispatch it again

#### Scenario: Existing command paths are unaffected
- **WHEN** a user issues a command through the application UI or the existing
  REST endpoint
- **THEN** it dispatches immediately as it does today, with no approval step
