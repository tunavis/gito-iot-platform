# Gito MCP Server

An MCP endpoint that lets an AI agent read one tenant's fleet — devices,
telemetry, alarms, alert rules, assets, hierarchy — and *request* device
commands that a person then approves.

It is mounted inside the existing FastAPI app at `/mcp`, not run as its own
service. It authenticates with the same JWT the REST API uses, reads through the
same routers, and writes the same `AuditLog` rows. A separate process would need
its own copy of all three, and the copy is where they would drift.

**Off by default.** `MCP_ENABLED=false` means the route is not mounted at all —
`/mcp` returns 404 rather than existing and refusing.

---

## Connecting a client

```bash
# .env
MCP_ENABLED=true
MCP_PROTOCOL_VERSION=2026-07-28          # asserted against the SDK at boot
MCP_ALLOWED_HOSTS=127.0.0.1,localhost    # Host header allowlist, see below
```

The transport is Streamable HTTP at `POST /mcp`. Authenticate with the same
bearer token the REST API takes:

```json
{
  "mcpServers": {
    "gito-iot": {
      "type": "http",
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer <jwt>" }
    }
  }
}
```

Get a token the same way the frontend does — `POST /api/v1/auth/login` returns
one, and its claims carry the tenant, user and role.

`MCP_ALLOWED_HOSTS` must list the hostnames clients actually use. DNS-rebinding
protection is left **on**; a missing entry surfaces as a `421`, not as a silent
hole. The fix is to add the host, never to disable the check.

Check what is running:

```bash
curl -s localhost:8000/api/health | jq .checks.mcp
# { "status": "enabled", "protocol_version": "2026-07-28" }
```

---

## The tool catalogue

Ten reads and one gated write. Every tool wraps an existing router function and
contains no SQL of its own, so an agent's answer and the dashboard's answer come
from the same query.

### Reads

| Tool | Answers |
|---|---|
| `list_devices` | Devices, filtered by site, group, type, status, or text search |
| `get_device` | One device in full, **plus its metric names, units and ranges** |
| `get_device_telemetry` | Readings for one device over a window; raw or aggregated |
| `get_telemetry_aggregate` | Min/max/avg/count per metric across the whole tenant |
| `list_active_alarms` | What is wrong right now, by severity or site |
| `get_alarm_history` | Every state over a window, for a device or a rule |
| `list_alert_rules` | Configured rules, threshold and composite, in API format |
| `get_hierarchy` | Organisation → site → group tree with rollup counts |
| `get_fleet_health` | One tenant-wide snapshot: devices, status mix, alarms |
| `get_asset_tree` | Assets with subtree-inclusive device and alarm rollups |

Two shaping rules apply to all of them:

- **Names travel with UUIDs.** An agent handed only ids will either show a UUID
  to a human or invent a name for it, and the second is worse.
- **Truncation is stated, never implied.** A capped result says `"showing 50 of
  213"`. A silent prefix is how an agent confidently reports a wrong fleet count.

### The write

`send_device_command` **does not send a command.** It records one with
`status='awaiting_approval'` and returns a reference. Nothing reaches the device
until a person calls:

```
POST /tenants/{tenant_id}/devices/{device_id}/commands/{command_id}/approve
```

The tool description and every result it returns both say the command was
*requested*, so a model reports "requested approval to close the valve" rather
than claiming the valve moved.

Requests lapse after 24 hours. Commands issued through the ordinary UI/REST path
are **unchanged and ungated** — they dispatch immediately, as they always have.

---

## The governance model

### Tenancy comes from the credential, never from an argument

No tool accepts `tenant_id`, `user_id`, or `organization_id`. This is enforced at
registration, twice: once against the function signature (which gives the author
a good error) and once against the JSON schema the model actually receives (which
is the one that is true). A violation raises during app construction, so a bad
tool fails the boot rather than shipping.

This is not belt-and-braces. **RLS is inert in this deployment** — the app
connects as the database owner — so a tool that accepted a tenant id would be a
cross-tenant read with a plausible-looking audit trail and nothing underneath to
stop it. The parameter guard is the boundary.

### Roles

MCP grants no authority the same user lacks in the UI. `VIEWER` and `CLIENT` are
read-only there, so they are read-only here: `send_device_command` is not
advertised to them and is refused if called anyway.

An unauthenticated caller gets an empty tool list — it learns nothing about the
tenant's capabilities before presenting a credential.

### Audit

Every call writes one `AuditLog` row, wrapped at *registration* time rather than
by each tool author, so a tool added in a hurry cannot skip it. Rows appear in
the existing `/tenants/{id}/audit-logs` endpoint and UI with no changes to
either, under action `mcp.tool.<name>` — an admin can tell at a glance that an
agent did this rather than a person clicking.

Recorded: who called, which tool, the arguments, and the *shape* of the result
(a row count, or the error).

Not recorded: the result payload. Telemetry and alarm bodies are large and carry
customer data; copying them would turn `audit_logs` into a second, unmanaged copy
of the fleet's data.

An audit write that fails never fails the call. A read that succeeded but could
not be logged still happened, and dropping the result to protect the log would
hide it entirely — the gap is logged loudly instead.

### Protocol version

`MCP_PROTOCOL_VERSION` is pinned and asserted against the installed SDK at boot.
MCP is a protocol boundary with clients we do not control, and the SDK will
happily negotiate whatever it supports — meaning a routine dependency bump could
change wire behaviour with nobody deciding to. A mismatch fails the boot. When it
does, decide which is right and move the pin deliberately; do not widen it to
make the error go away.

---

## Open question: agent credentials

Agents authenticate with a user's JWT today. That works and reuses one identity
path, but it means an agent's reads are indistinguishable from that user's in
every system except the `mcp.tool.*` action prefix, and the agent inherits the
whole of that user's authority for as long as the token lives.

A tenant-scoped API key with its own role and its own revocation is the likely
successor. Not built yet — recorded here so the choice is visible rather than
assumed.

---

## Where the code lives

```
api/app/mcp/
├── server.py       # construction, protocol pin, role-filtered tool list
├── auth.py         # credential → (tenant, user, role)
├── audit.py        # the wrapper applied at registration
├── shape.py        # guarded sessions, router calls, result capping
└── tools/
    ├── __init__.py # registration + the guards that hold at registration time
    ├── read.py     # the ten read tools
    └── write.py    # send_device_command
```

Tests: `api/tests/test_mcp_*.py` and `test_command_approval_gate.py`.
