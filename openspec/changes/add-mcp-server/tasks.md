## 1. Server, transport, and mounting

- [x] 1.1 Add the MCP Python SDK to `api/pyproject.toml`, pinned to an exact
      version (not a range) — this is a protocol boundary. (The framework upgrade
      it depends on landed separately; see the proposal's Impact section.)
- [x] 1.2 `api/app/mcp/server.py` — construct the MCP server, Streamable HTTP
      transport, mounted at `/mcp` on the existing FastAPI app in `main.py`.
- [x] 1.3 Pin the supported MCP protocol version in settings; assert it at
      startup and fail loudly on mismatch rather than negotiating silently.
- [x] 1.4 `MCP_ENABLED` setting, default `false`; when false the route is not
      mounted at all. Add to `.env.example`.
- [x] 1.5 `/api/health` gains an `mcp` field reporting enabled/disabled and the
      pinned protocol version — consistent with the existing `ingestion` field.

## 2. Identity, scoping, and authorization

- [x] 2.1 `api/app/mcp/auth.py` — resolve bearer JWT to `(tenant_id, user_id,
      role)` once per MCP session, reusing `app/dependencies.py` rather than
      re-parsing the token. Reject unauthenticated sessions before any tool
      listing is returned.
- [x] 2.2 Establish the tool context object carrying tenant/user/role. **No tool
      signature may include `tenant_id`, `user_id`, or `organization_id` as an
      authorization-determining parameter.**
- [x] 2.3 Add a registration-time guard that raises at import if any registered
      tool's input schema contains `tenant_id` — the rule must be enforced by the
      code, not by review discipline. This is the single most important task here.
- [x] 2.4 Every tool body calls `validate_tenant_access()` and
      `set_tenant_context()` as the routers do — defence in depth, given RLS is
      inert under the app's superuser connection.
- [x] 2.5 Filter the advertised tool list by role: `VIEWER`/`CLIENT` see read
      tools only; `send_device_command` is advertised only to roles allowed to
      issue commands today.

## 3. Audit

- [x] 3.1 `api/app/mcp/audit.py` — wrapper applied at **registration time** so
      every tool is audited by construction and a new tool cannot skip it.
- [x] 3.2 Write one `AuditLog` entry per call: actor from the token, action
      `mcp.tool.<name>`, resource type/id when the tool targets one, the call
      arguments, and the result *shape* (row count or error) — not the result
      payload.
- [x] 3.3 Confirm MCP entries render in the existing `/tenants/{id}/audit-logs`
      endpoint and the audit-logs UI with no changes to either.
- [x] 3.4 Test: assert that a tool registered without going through the wrapper
      fails the registration guard.

## 4. Read tools

Each wraps an existing service/router function and contains no SQL of its own.

- [x] 4.1 `list_devices` — filters: site, group, device type, status. Wraps the
      existing device list path.
- [x] 4.2 `get_device` — detail plus current status; inlines the metric names and
      units from the device type's telemetry schema, so no separate
      device-type lookup tool is needed.
- [x] 4.3 `get_device_telemetry` — device + metric + time window, raw readings.
- [x] 4.4 `get_telemetry_aggregate` — min/max/avg/count over a window; wraps
      `telemetry_aggregate.py`.
- [x] 4.5 `list_active_alarms` — by severity/site.
- [x] 4.6 `get_alarm_history` — occurrences over a window for a device or rule.
- [x] 4.7 `list_alert_rules` — reads values through the rule's API-format
      response representation, never raw columns (`unified_alert_rule.py:61-75`
      documents why comparing raw `rule_type`/`severity` silently matches nothing).
- [x] 4.8 `get_hierarchy` — wraps `hierarchy.py`.
- [x] 4.9 `get_fleet_health` — online/offline/alarming counts, tenant-wide.
- [x] 4.10 Shared result shaping: names alongside UUIDs, units from the telemetry
      schema, ISO-8601 UTC timestamps.
- [x] 4.11 Shared result capping that **states the truncation** in the response
      ("showing 50 of 213"). A silent prefix is how an agent confidently reports
      a wrong fleet count.
- [x] 4.12 `get_asset_tree` — assets with their subtree-inclusive device and alarm
      rollups; wraps `services/asset_tree.py`. **Added after this change was
      written.** The asset registry did not exist then, and the strategy sequenced
      it *before* MCP precisely so agents could answer asset-shaped questions
      ("is this pump station healthy") rather than only device-shaped ones.
      Shipping MCP with no asset tool would leave the registry read by nothing,
      which is the exact risk its own proposal recorded.

## 5. Approval-gated write

- [x] 5.1 Migration: pending-approval state for device commands.
- [x] 5.2 `send_device_command` records a pending approval and returns its
      reference. It dispatches nothing.
- [x] 5.3 Tool description states plainly that the command is *requested*, not
      executed, so the model reports "requested approval to…" rather than
      claiming the action happened.
- [x] 5.4 `api/app/routers/commands.py` honours the pending state; approval
      through the existing path dispatches normally. Commands issued via the
      existing UI/REST path are unchanged and stay ungated.
- [x] 5.5 Test: an approved command dispatches exactly once; an unapproved one
      never reaches the device path.

## 6. Verification

- [x] 6.1 **Tenant isolation test per exposed tool** — with tenant A's token,
      request tenant B's device/site/rule ids by UUID; assert every tool returns
      empty or 403 and never B's data. This is the suite that matters.
- [x] 6.2 Assert no registered tool's JSON schema contains a tenant identifier
      (the guard from 2.3, tested).
- [x] 6.3 Audit coverage test: N tool calls produce N audit rows with correct
      actor and action.
- [x] 6.4 Approval-gate tests from 5.5.
- [x] 6.5 Startup test: mismatched protocol version fails the boot.
- [x] 6.6 `MCP_ENABLED=false` → `/mcp` is not mounted (404), and the rest of the
      API is unaffected.
- [x] 6.7 Run the full suite in-container per the project convention:
      `docker exec gito-api python -m pytest tests/ -q`.
- [x] 6.8 End-to-end: connect a real MCP client with a demo-tenant token, list
      tools, run `get_fleet_health` and `list_active_alarms` against live data,
      and confirm both calls appear in the audit-logs UI.

## 7. Documentation

- [x] 7.1 `docs/` — how to connect a client, the tool catalogue, the governance
      model (credential-derived tenancy, role filtering, audit, approval gate),
      and the pinned protocol version.
- [x] 7.2 `CLAUDE.md` — record that MCP tools live in `api/app/mcp/`, wrap
      existing services rather than adding query logic, and must never accept a
      tenant identifier as a parameter.
- [x] 7.3 Note in the strategy doc that F1 now has an openspec change, and record
      the open question on agent credentials (JWT today, tenant-scoped API key
      later).
