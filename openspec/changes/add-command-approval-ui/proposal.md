## Why

`add-mcp-server` shipped an approval gate with no human on the other side of it.
An agent can request a device command, the row sits in `awaiting_approval`, and
**nothing in the product shows it to anyone** — there is not one reference to
`awaiting_approval` or `/approve` in `web/src`. The request expires silently
after 24 hours.

A safety mechanism nobody can see is worse than no safety mechanism, because it
reads as coverage. This change builds the half that was missing.

Two adjacent gaps are folded in because they are the same conversation:

- The operator has nothing to judge. `send_device_command` takes a device, a
  command name and parameters — no justification — so the screen would say
  "close_valve on Pump 3" and the human would be rubber-stamping, not deciding.
- `POST /tenants/{t}/devices/{d}/commands` has **no role check at all**. Any
  authenticated tenant user can actuate any device today. Gating only the
  approval path would be theatre: anyone refused at approve can send the same
  command directly.

## What Changes

- **New** `/dashboard/approvals` page listing every pending request for the
  tenant — device and site, command and parameters, the agent's stated reason,
  who requested it, and time remaining — with Approve and Reject per row.
- **New** sidebar entry with a pending count, so a waiting request is visible
  without going looking for it.
- ~~**New** notification raised when a request enters `awaiting_approval`~~ —
  **deferred to `add-approval-notifications`.** This was written believing the
  existing dispatcher could be reused; it cannot. `NotificationDispatcher`'s only
  entry point is `process_alert_event(alert_event_id)` and
  `notification_queue.alert_event_id` is NOT NULL against `alert_events`, so the
  pipeline is alert-event-shaped end to end. Widening it is a migration on a table
  the whole alarm path depends on and deserves its own change.
  **Consequence:** until that lands, a pending request is visible only to someone
  already signed in — a partial fix, not the whole one.
- **New** `GET /tenants/{t}/command-approvals` — tenant-wide pending list with
  device and site names joined. Today's commands list is per-device, so finding
  a request means already knowing which device to look at.
- **New** `POST /tenants/{t}/devices/{d}/commands/{c}/reject` — records who
  declined and when. Without it, "nobody approved this" and "someone actively
  refused it" are indistinguishable in the audit trail.
- **New** required `reason` argument on the MCP `send_device_command` tool,
  stored on the command and shown to the approver.
- **New** MCP `ToolAnnotations` on every tool: `read_only_hint` on the ten reads,
  `destructive_hint` on the write. This is how an MCP client knows to treat a
  tool cautiously; without it we rely on clients inferring intent from prose.
- **New** frontend role helper. No role gating exists anywhere in `web/src`
  today, so gating the API alone would ship buttons that 403.
- **BREAKING**: role gate (`SUPER_ADMIN`, `TENANT_ADMIN`, `SITE_ADMIN`) on
  send, approve and reject. A `VIEWER` or `CLIENT` who can send device commands
  today will receive 403. This matches what MCP already enforces for the same
  action, and the two rules currently disagree.
- Self-approval is **allowed**, recorded, and displayed as such. Blocking it
  sounds stricter but breaks single-admin tenants and buys nothing: an admin
  refused at approve can send the command directly. The control is that a human
  looked.

## Capabilities

### New Capabilities
- `command-approval`: the approval queue as a product surface — how a pending
  request is discovered, what an operator is shown in order to decide, what
  approving and rejecting do, and what is recorded about the decision.

### Modified Capabilities
- `integrations-and-commands`: the command lifecycle gains `rejected` alongside
  `awaiting_approval`, and issuing a command becomes role-restricted where it
  is currently open to any authenticated tenant user.
- `mcp`: `send_device_command` requires a reason, and every tool carries
  behavioural annotations.

## Impact

**Database** — migration `028`, additive in the same shape as `027`:
`device_commands.request_reason`, `.rejected_by`, `.rejected_at`, and
`'rejected'` added to the `valid_command_status` CHECK. No backfill; existing
rows keep their status and get NULL.

**API** — `api/app/routers/commands.py` (new tenant-scoped router alongside the
device-scoped one, new reject endpoint, role dependency on three endpoints),
`api/app/schemas/commands.py`.

**MCP** — `api/app/mcp/tools/write.py` (reason argument),
`api/app/mcp/tools/__init__.py` and `read.py` (annotations).

**Frontend** — new `web/src/app/dashboard/approvals/`, new role helper in
`web/src/lib/`, sidebar navigation, and the device detail page's Commands tab
(hide the send UI for roles that may no longer use it).

**Notifications** — reuses `notification_dispatcher.py`; no new channel.

**Deployment** — needs a migration, so an api rebuild and restart. Web changes
mean the web image must be rebuilt **locally and shipped**; the staging box has
4.8 GB and a Next.js build there takes the app down.

**Not in scope** — reject reasons (declining is recorded, the words are not),
approval delegation, and any change to how an approved command is dispatched.
