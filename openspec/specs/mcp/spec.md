## Purpose
Exposes an agent-facing MCP tool surface over Streamable HTTP at `/mcp` on the
existing API application, so a language model can read platform state and request
device actions under the same tenancy, role, and audit rules a human is bound by.
Backed by `api/app/mcp/` (`server.py`, `tools/`, `shape.py`, `context.py`) and
documented in `docs/MCP_SERVER.md`.

## Requirements

### Requirement: The MCP server is mounted inside the existing API application
The system SHALL expose its MCP server over Streamable HTTP at `/mcp` on the
existing FastAPI application, rather than as a separate service, process, or
deployable. It SHALL therefore reuse the application's existing TLS termination,
reverse proxy, JWT validation, database session handling, connection pool, and
logging without duplicating any of them.

The server SHALL be controlled by an `MCP_ENABLED` setting that defaults to
disabled. When disabled, the route SHALL NOT be mounted at all.

The health endpoint SHALL report MCP status and the pinned protocol version
alongside the existing health fields.

#### Scenario: MCP disabled by default
- **WHEN** the application starts without `MCP_ENABLED` set
- **THEN** `/mcp` returns 404, no MCP transport is listening, and the rest of the
  API behaves exactly as before

#### Scenario: Health reporting
- **WHEN** an operator queries the health endpoint
- **THEN** the response states whether MCP is enabled and which MCP protocol
  version is pinned

### Requirement: The MCP protocol version is pinned and asserted at startup
The system SHALL pin the supported MCP protocol version in configuration and
SHALL fail startup loudly if the installed SDK negotiates a different version.
The MCP SDK dependency SHALL be pinned to an exact version, not a range, because
it is a protocol boundary.

#### Scenario: SDK upgraded to a different protocol version
- **WHEN** the MCP SDK is upgraded such that it negotiates a protocol version
  other than the pinned one
- **THEN** the application fails to start with an explicit message naming both
  versions, rather than starting and silently serving a different protocol

### Requirement: Tenant identity is derived from the credential and is not a tool parameter
The system SHALL resolve the acting tenant, user, and role from the bearer
credential once per MCP session and inject them into every tool invocation. **No
tool exposed over MCP SHALL accept a tenant identifier as an input parameter**,
nor any other identity parameter that determines authorization rather than
filtering.

This SHALL be enforced mechanically: tool registration SHALL fail if a registered
tool's input schema contains a tenant identifier. It SHALL NOT rely on author
discipline or code review.

Every tool body SHALL additionally perform the same tenant access validation and
tenant context establishment the REST routers perform. This is defence in depth
and is required because PostgreSQL RLS does not enforce in this deployment — the
application connects as a database superuser/owner, so tenant isolation is
carried by explicit predicates, not by policy.

#### Scenario: A model attempts a cross-tenant read
- **WHEN** a caller authenticated for tenant A invokes any tool, supplying
  identifiers belonging to tenant B
- **THEN** the tool operates only within tenant A and returns no tenant B data —
  the request is not merely rejected, it is unrepresentable in the tool schema

#### Scenario: A new tool is added with a tenant parameter
- **WHEN** a developer registers a tool whose input schema includes `tenant_id`
- **THEN** registration fails at import time

#### Scenario: Unauthenticated session
- **WHEN** a client connects without a valid credential
- **THEN** the session is rejected before any tool list is returned

### Requirement: Tool availability is filtered by the caller's role
The system SHALL advertise only the tools the authenticated role is permitted to
use. Read-only roles SHALL NOT see write tools listed, and SHALL be refused if
they invoke one regardless.

#### Scenario: A viewer lists tools
- **WHEN** a caller holding a read-only role lists available tools
- **THEN** the write tool is absent from the list, and invoking it by name is
  refused

### Requirement: MCP tools are adapters over existing services, not new query logic
The system SHALL implement each MCP tool as a thin adapter that resolves inputs,
calls an existing service or router function, and shapes the result for a model
consumer. Tool implementations SHALL NOT contain SQL, and SHALL NOT contain their
own tenant-filtering logic beyond the validation required above.

Where a tool needs behaviour the REST API does not already have, that behaviour
SHALL be added to the shared service layer so both surfaces use one
implementation. This is what prevents "every feature is also an MCP tool" from
becoming "every feature is implemented twice", and prevents the tenant-scoping
rules from drifting between the two surfaces.

#### Scenario: A tool needs a query that does not exist yet
- **WHEN** a new tool requires an aggregation the REST API does not expose
- **THEN** the aggregation is implemented in the shared service layer and both
  the tool and any future endpoint call it — it is not written inline in the tool

### Requirement: Tool results are shaped for a model consumer and never silently truncated
The system SHALL return tool results in a form a language model can use without
further lookups: entity names accompanying identifiers, measurement values
carrying the unit from the device type's telemetry schema, and timestamps in
ISO-8601 UTC.

Where a result set is capped, the response SHALL state the truncation and the
true total. A silently truncated result SHALL NOT be returned, because a model
receiving a prefix reports it to an operator as the complete set.

#### Scenario: A large device list is capped
- **WHEN** a tenant has more devices than the result cap and a caller lists them
- **THEN** the response includes both the returned count and the true total, so
  the consuming model can state that the list is partial

#### Scenario: Telemetry values carry units
- **WHEN** a telemetry tool returns readings for a metric defined in a device
  type's telemetry schema
- **THEN** each value is accompanied by that metric's unit

### Requirement: Write tools record intent for approval and do not execute
The system SHALL NOT allow any MCP tool to directly perform a state-changing
action on a device. A write tool SHALL record a pending approval and return its
reference; the action SHALL only take effect after a human approves it through
the existing application path.

The tool's own description SHALL state that the action is requested and not
performed, so a consuming model reports the request accurately rather than
claiming the action completed.

#### Scenario: Requesting a device command through MCP
- **WHEN** an authorized caller invokes the device command tool
- **THEN** a pending approval is recorded, an approval reference is returned, and
  nothing is dispatched to the device

#### Scenario: Approval and dispatch
- **WHEN** a human approves a pending MCP-originated command
- **THEN** the command dispatches exactly once through the existing command path

#### Scenario: A command that is never approved
- **WHEN** a pending MCP-originated command is not approved
- **THEN** it never reaches the device

### Requirement: Every MCP tool call is audited by construction
The system SHALL write one audit entry per tool invocation, recording the acting
user, the tool name as the action, the targeted resource type and identifier
where the tool addresses one, the call arguments, and the result shape — row
count or error. Result payloads SHALL NOT be recorded, to keep telemetry volumes
out of the audit store.

Auditing SHALL be applied at tool registration so that a tool cannot be exposed
without it. It SHALL NOT depend on each tool author remembering to add it.

Audit entries SHALL use the existing audit store and SHALL be readable through
the existing tenant audit-log endpoint and UI without modification to either, and
SHALL be distinguishable from human-originated actions.

#### Scenario: A tool call is audited
- **WHEN** any MCP tool is invoked successfully
- **THEN** exactly one audit entry exists naming the acting user and that tool,
  and it is visible in the tenant's existing audit-log view

#### Scenario: A failing tool call is audited
- **WHEN** an MCP tool invocation fails
- **THEN** an audit entry is still written, recording the error rather than a
  result count

#### Scenario: An admin distinguishes agent activity from human activity
- **WHEN** a tenant admin reviews the audit log
- **THEN** MCP-originated tool calls are identifiable as such and separable from
  actions taken through the UI
