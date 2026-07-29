## Context

What already exists and must be reused rather than reimplemented:

| Concern | Existing mechanism |
|---|---|
| Token → tenant/user/role | `api/app/dependencies.py` — `get_current_tenant`, `get_current_user`, `get_current_user_info` |
| Tenant access check | `api/app/services/tenant_access.py` — `validate_tenant_access(session, current_tenant, tenant_id)` |
| Audit storage + read API | `AuditLog` in `api/app/models/base.py`; `api/app/routers/audit_logs.py` (`/tenants/{id}/audit-logs`, admin-only) |
| Session with tenant context | `RLSSession` / `get_session` in `api/app/database.py`, `set_tenant_context()` |
| Device commands | `api/app/routers/commands.py` |
| Query logic per domain | `api/app/routers/*.py` + `api/app/services/*` |

The critical constraint: **RLS does not enforce in this deployment.** The app
connects as a superuser/owner, so `tenant_isolation` policies are inert and
isolation is carried by explicit `WHERE tenant_id` and `validate_tenant_access()`.
`set_tenant_context()` is still called and is still correct to call — it is just
not, on its own, a security boundary here.

## Goals / Non-Goals

**Goals**
- MCP tools that cannot express a cross-tenant request.
- Every tool call auditable in the audit UI a tenant admin already uses.
- No second copy of any query or tenant-scoping rule.
- No new service to deploy, monitor, or health-check.
- Prove the approval gate on a real write before adding more writes.

**Non-Goals**
- Tool-count parity with ThingsBoard's 120+. Explicitly rejected by strategy §4.
- NLQ, RAG, or an agent runtime — those are F2/F3/F5, separate foundations.
- Any end-user UI. H1 is an internal demo (§6.2).
- Making the existing REST/UI command path approval-gated. Out of scope; only the
  MCP path gates.
- OAuth / dynamic client registration. Internal demo uses the existing JWT.

## Decisions

**1. Mount inside the FastAPI app, don't build a second service.**
Streamable HTTP transport at `/mcp` on the existing app. This inherits the
existing TLS, reverse proxy, JWT validation, `RLSSession`, connection pool,
`/api/health`, logging, and deploy pipeline for free. A separate MCP process would
need its own copy of all of it, plus its own database credentials — a second
place for the tenant-scoping rules to drift out of sync. Given the platform's
2h/day maintenance budget, a second deployable is the expensive choice, not the
clean one.

**2. Tenant identity is derived from the credential and injected. No tool takes
`tenant_id`.**
This is the load-bearing decision. The tool *schema* the model sees has no tenant
parameter, so there is no argument for a prompt injection to poison and no
plausible-looking cross-tenant call to audit after the fact. Concretely: each tool
is written as `async def tool(ctx, ...args)` and the tenant comes off `ctx`,
resolved once at session start from the bearer token. Tools still call
`validate_tenant_access()` and `set_tenant_context()` — defence in depth, matching
what every router does today — but the primary guarantee is that the unsafe call
is unrepresentable.

The same applies to any other identity-shaped argument: no `user_id`, no
`organization_id` supplied by the model where it determines *authorization*
rather than *filtering*. Role comes from the token; a `VIEWER` token gets the
read tools and not `send_device_command`.

**3. Tools are thin adapters, and each one names the function it wraps.**
An MCP tool's body resolves inputs, calls the existing service/router function,
and shapes the result for a model (compact, labelled, units included). It contains
no SQL and no tenant filtering of its own. If a tool needs logic the REST API
doesn't have, that logic goes in `app/services/` where both can use it — never in
`app/mcp/`. This is what keeps "every feature is also an API + MCP tool" from
meaning "every feature is implemented twice".

**4. Nine read tools, chosen by question rather than by table.**

| Tool | Answers |
|---|---|
| `list_devices` | "what's on site X", filterable by site/group/type/status |
| `get_device` | one device's detail + current status |
| `get_device_telemetry` | windowed raw readings for a device+metric |
| `get_telemetry_aggregate` | min/max/avg/count over a window (wraps `telemetry_aggregate.py`) |
| `list_active_alarms` | "what's wrong right now", by severity/site |
| `get_alarm_history` | "how often has this fired" |
| `list_alert_rules` | "what are we even watching for" |
| `get_hierarchy` | org → site → group structure (wraps `hierarchy.py`) |
| `get_fleet_health` | online/offline/alarming counts — the one-shot orientation call |

`list_device_types` is deliberately omitted from v1: device types are schema, and
a model that needs them almost always needs them *inside* another answer, where
`get_device` can inline the relevant metric names and units.

**5. Result shaping is a real requirement, not polish.**
Raw `to_response_dict()` output is UUID-heavy and unit-free. Tools return
human/model-legible fields — device *name* alongside id, metric values with the
unit from the device type's telemetry schema, timestamps in ISO-8601 UTC — and
cap result size with an explicit, *stated* truncation ("showing 50 of 213
devices") rather than silently returning a prefix. A silently truncated list is
how an agent confidently reports the wrong fleet count.

**6. Writes are gated by recording intent, not by executing it.**
`send_device_command` inserts a pending command-approval row and returns its
reference. Nothing is dispatched. A human approves through the existing command
path. The tool's description says this plainly, so the model reports "I've
requested approval to…" rather than "I've restarted the pump". A gate the model
misunderstands produces a false completion claim to the operator, which at a mine
is precisely the trust incident §13 warns about.

**7. Audit uses `AuditLog`, so it lands in the UI that already exists.**
Every tool invocation writes one entry: actor (user from token), action
(`mcp.tool.<name>`), resource type/id where the tool targets one, arguments, and
the result shape (row count, or error). The wrapper is applied at registration
time, so a tool cannot be added without audit — not a decorator each tool author
must remember. Arguments are recorded; result *payloads* are not, to keep
telemetry volumes out of the audit table.

**8. Pin the protocol version, assert it at startup.**
Config holds the supported MCP spec version; startup fails loudly on an SDK that
negotiates something else. The strategy explicitly calls for tracking
Linux-Foundation evolution — a silent version drift in a governance-positioned
product is worse than a failed boot.

**9. `MCP_ENABLED` defaults to off.**
H1 is an internal demo. Off by default means the new front door does not exist in
production until someone decides it should.

## Risks / Trade-offs

- **A new data front door driven by a model.** Mitigated by unrepresentable
  cross-tenant calls (decision 2), role-derived tool availability, read-only
  defaults, and per-call audit. Accepted residual: a compromised *valid* token
  reads that tenant's data through MCP as it already could through REST. MCP does
  not widen that; it makes it noisier in the audit log.
- **Prompt injection via telemetry content.** Device names and payload fields are
  tenant-controlled strings that end up in model context. Nothing in this design
  lets injected text escalate — no tool takes a tenant identifier and writes are
  gated — but tool output is data, not instructions, and the server descriptions
  should say so.
- **Mounting in the main app couples MCP load to API load.** An agent hammering
  `get_device_telemetry` competes with the dashboard for the same pool.
  Acceptable for an internal demo, and visible via the existing `/api/health`.
  Revisit only if measured, and the fix is a pool/rate limit, not a second service.
- **Tool-count optics.** "9 tools vs ThingsBoard's 120" will come up in a sales
  conversation. That is the strategy's chosen position (§4 rule 2) and the answer
  is the governance story, which needs to be *demonstrable* — hence audit and the
  approval gate shipping in v1 rather than later.
- **F0 ordering.** Alarm tool response shapes may need one revision after the
  unified alarm engine lands. Cheaper than blocking F1 on F0.

## Migration Plan

Additive. One migration for the command-approval state; no existing table
changes; audit reuses `AuditLog` unmodified. `MCP_ENABLED=false` by default means
deploying this change alters no running behaviour — enabling it is a separate,
deliberate config action.

## Open Questions

- **Credential type for agents.** v1 uses the existing user JWT, which means an
  agent acts as a person and inherits their role — good for audit attribution,
  awkward for a long-running service. A dedicated tenant-scoped API key with its
  own role is probably right, but there is no API-key model in the codebase today
  and adding one is its own change. v1 uses the JWT and this is flagged, not solved.
- **Should `get_fleet_health` be tenant-wide or site-scoped by default?**
  Tenant-wide is the better orientation call; at 67+ devices it is still small.
  Revisit at a scale that does not exist yet.
- **Rate limiting per session.** Not in v1. Add when there is a real agent loop
  (F5) to rate-limit against.
