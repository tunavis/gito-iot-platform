## ADDED Requirements

### Requirement: Agent-originated actions are distinguishable in the audit log
The system SHALL record actions originating from the MCP tool surface as a
distinct action class in the existing audit store, so a tenant administrator
reviewing the audit log can tell whether a given action was taken by a person
using the application or by an agent calling a tool on that person's behalf.

The acting user SHALL still be attributed — an agent acts as the identity whose
credential it holds — but the origin SHALL be recorded alongside it.

#### Scenario: Filtering audit history for agent activity
- **WHEN** a tenant administrator reviews the audit log for a period during which
  both UI actions and MCP tool calls occurred
- **THEN** the MCP tool calls are identifiable by their action class and can be
  separated from actions taken directly through the application

#### Scenario: Attribution of an agent action
- **WHEN** an MCP tool call is audited
- **THEN** the entry names the user whose credential authorized the session, not
  an anonymous or system actor
