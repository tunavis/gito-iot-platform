## Why

`docs/strategy/2026-07-05-platform-5yr-strategy.md` lists **F1 — Gito MCP Server**
as a Y1-H1 foundation (§6.1), item 3 on the serial critical path (§8), and states
the governing rule that *"every feature is also an API + MCP tool"* (§4, rule 2).
That same rule is explicit about why: **MCP is catch-up, not moat.** Litmus ships
an MCP server today, Ignition's module is in Early Access, ThingsBoard has 120+
MCP tools and gives them away. The strategy's stated position is that Gito
competes on **governance** — typed tools, tenant scoping, approval gates, full
audit — not on tool count.

None of this exists in the codebase. There is no MCP server, no
`@modelcontextprotocol` or `mcp` dependency, and — until this change — nothing in
`openspec/` either. F1 was strategy prose only.

The governance angle is not decoration here, because of a property of this
specific deployment: **PostgreSQL RLS is inert.** The application connects as a
database superuser/owner, so RLS policies do not enforce, and tenant isolation is
carried entirely by explicit `WHERE tenant_id` predicates and
`validate_tenant_access()` in the router layer. An MCP server is a new front door
into that data driven by a language model choosing arguments. A tool that accepts
`tenant_id` as a model-supplied parameter would be a cross-tenant read with a
plausible-looking audit trail. That single fact shapes most of this design.

## What Changes

- New `mcp` capability: an MCP server **mounted inside the existing FastAPI app**
  at `/mcp` (Streamable HTTP transport), not a separate service, container, or
  deploy target. It authenticates with the same JWT the REST API already uses, via
  the existing `app/dependencies.py` helpers.
- **Tenant identity comes from the credential, never from a tool argument.** No
  exposed tool takes `tenant_id`. The server resolves it from the bearer token
  once per session and injects it. A model cannot express a cross-tenant request
  because the vocabulary to do so is not in the tool schema.
- **~9 read tools** covering the questions the assistant is actually meant to
  answer in H1: list/get devices, device telemetry (windowed + aggregated), list
  active alarms, alarm history, list alert rules, site/org hierarchy, device
  types, fleet health summary. Each is a thin adapter over an existing service or
  router function — the MCP layer contains no new query logic and no second copy
  of the tenant-scoping rules.
- **One approval-gated write tool** — `send_device_command`, over the existing
  `commands.py` path. It does not execute on call: it records a pending approval
  and returns an approval reference. A human approves out-of-band before anything
  reaches a device. One write tool is enough to prove the governance mechanism is
  real rather than specified; the rest stay read-only until it is.
- **Every tool call is audited**, call and result-shape both, through the existing
  `AuditLog` model (`app/models/base.py`) that
  `/tenants/{id}/audit-logs` already serves — so MCP activity shows up in the
  audit UI a tenant admin already has, with no new surface to build.
- **The MCP protocol version is pinned** in config and asserted at startup, per
  the strategy's "pin MCP spec version, track Linux-Foundation evolution" note.

## Capabilities

### New Capabilities
- `mcp`: the MCP server itself — transport and mounting, credential-derived
  tenant scoping, the tool contract, approval gating for writes, audit coverage,
  and protocol version pinning.

### Modified Capabilities
- `audit-and-events`: audit entries gain MCP-originated tool calls as a recorded
  action class, so an admin can distinguish "a human clicked this" from "an agent
  called this tool".
- `integrations-and-commands`: device commands gain a pending-approval state
  reachable from the MCP path. Commands issued through the existing UI/REST path
  are unchanged and are not approval-gated by this change.

## Impact

- `api/requirements.txt` — add the MCP Python SDK, pinned.
- `api/app/mcp/` — new: `server.py` (mount + transport + version pin),
  `auth.py` (JWT → tenant/user/role context), `tools/` (one module per tool
  group), `audit.py` (tool-call audit wrapper), `approvals.py`.
- `api/app/main.py` — mount the MCP app.
- `api/app/routers/commands.py` — honour the pending-approval state.
- `api/alembic/versions/` — one migration for the command-approval state. No other
  schema change; audit reuses `AuditLog` as-is.
- `api/tests/` — tenant-isolation tests for every exposed tool (the important
  ones), approval-gate tests, audit-coverage test.
- `.env.example` / settings — `MCP_ENABLED` (default off), pinned protocol version.

## Sequencing note

The strategy sequences F1 *after* **F0 (unified alarm engine)** and the additive
asset registry. Neither has an openspec change yet. F0 is not a hard blocker —
the alarm read tools work against today's engine — but the alarm tool's response
shape will follow F0's model, so building those two tools last (or accepting one
revision after F0 lands) is the cheaper order. This is called out rather than
silently ignored.

Per §6.2, H1 ships an **internal-facing MCP demo, not a public assistant beta**.
`MCP_ENABLED` therefore defaults to off, and this change ships no end-user UI.
