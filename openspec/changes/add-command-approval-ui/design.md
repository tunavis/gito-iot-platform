## Context

`add-mcp-server` put a gate on agent-issued device commands: `send_device_command`
records a row with `status='awaiting_approval'` and dispatches nothing, and a
person approves through `POST /tenants/{t}/devices/{d}/commands/{c}/approve`.
The database half is sound — `awaiting_approval` is a value on the existing
`status` column, so every existing reader is blind to it by construction,
including the timeout sweep, which must not expire a request waiting on a human
using the device's radio TTL.

What does not exist is the person. There is no reference to `awaiting_approval`
or `/approve` anywhere in `web/src`, and the only way to list commands is
`GET /tenants/{t}/devices/{d}/commands` — per device, so an operator must already
suspect a device to find a request against it.

Two constraints shape everything below:

- **RLS is inert** in this deployment; the app connects as the database owner.
  Tenant scoping is whatever the query says it is.
- The approval gate is not an IoT-platform convention. Cumulocity Operations and
  ThingsBoard RPC gate on RBAC and audit the result; they do not interpose a
  human. This gate exists because the requester is an *agent*, and it is a
  second, different gate from the per-tool prompt an MCP client shows its own
  user — that prompt is answered by whoever runs the agent, who is not
  necessarily anyone authorised to operate the plant.

## Goals / Non-Goals

**Goals:**
- A pending request reaches a human who can act on it, without that human going
  looking for it.
- That human is shown enough to make a decision rather than rubber-stamp one.
- Approve and reject are both recorded with an actor, so refusal is
  distinguishable from neglect.
- The rules about who may actuate a device stop disagreeing between MCP and REST.
- MCP clients can tell a destructive tool from a read.

**Non-Goals:**
- Reject reasons. The decision and the decider are recorded; the words are not.
- Approval delegation, escalation, or multi-party approval.
- Any change to how an approved command is dispatched — `_dispatch_now` stays
  the single dispatch path and is not touched.
- Blocking self-approval (see Decisions).
- Bulk approve. An approval queue whose main affordance is "approve all" is a
  gate in name only.

## Decisions

### Keep `approve` where it is; add one tenant-scoped list endpoint

The approve endpoint already exists, is tested, and is device-scoped
(`/tenants/{t}/devices/{d}/commands/{c}/approve`). The list rows carry
`device_id`, so the UI can call it unchanged. Rejected alternative: move approval
onto a new tenant-level path for symmetry with the list — that rewrites working,
verified code for tidiness and orphans the tests written against it.

The new list is a second `APIRouter` in `commands.py` with prefix
`/tenants/{tenant_id}/command-approvals`, not a new module. Everything that
decides whether a command reaches a device stays in one file; that is the same
reason `request_command_approval` lives there rather than in the MCP package.

### `rejected` as a status value, not a boolean

Same reasoning as `awaiting_approval` in `027`: existing readers filter on
`status`, so a new value is invisible to them by construction. A parallel
`is_rejected` column would allow `status='awaiting_approval'` and rejected at the
same time, and the approve path has no reason to consult a column it has never
heard of.

`rejected_by`/`rejected_at` are separate columns rather than reusing
`approved_by`/`approved_at` as generic "decided" columns. Renaming deployed
columns is churn, and `approved_by` holding the person who *refused* is the kind
of thing that reads correctly in code and wrongly in an audit export.

### `request_reason` is a column, not a key in `parameters`

`parameters` is the payload dispatched to the device. Folding UI metadata into it
would put the reason on the wire to a water meter.

### Self-approval is allowed, recorded, and displayed

Separation of duties is the standard control for consequential approvals, and the
agent here acts *as a user* — so the user who ran the agent could approve its
request. Blocking that breaks single-admin tenants outright, and buys nothing:
an admin refused at approve can issue the same command directly through the
ungated-by-role-for-them send path. The control this gate provides is that a
human looked at what the agent asked for, and in that case one did. The UI labels
it, so an auditor can see it rather than having to infer it from two ids.

### Role gate on send, approve and reject — the root cause, not the symptom

`POST .../commands` has no role check today. Gating only approve would produce a
gate anyone can walk around. One shared FastAPI dependency covers all three, with
the same ladder `ToolContext.may_issue_commands` already uses
(`SUPER_ADMIN`/`TENANT_ADMIN`/`SITE_ADMIN`), so there is one definition of "may
actuate a device" rather than two that drift.

This is the only breaking change here and the only part that can affect an
existing user. See Risks.

### A frontend role helper, because none exists

`web/src` has no role gating at all — not a helper, not an inline check. Gating
the API alone would leave a VIEWER looking at a Send button that 403s. The helper
is one small module reading the role claim already parsed out of the JWT, used by
the approvals page, the sidebar entry, and the device Commands tab.

### Notification on pending, not just a badge

A count badge is only seen by someone already logged in — which is the same
invisibility this change exists to remove, narrowed slightly. The existing
`notification_dispatcher` is reused; no new channel type. Deliberately fire on
entry to `awaiting_approval` only, not on approve/reject, so the notification
means "someone needs to act" rather than becoming a log.

### MCP tool annotations

`ToolAnnotations(read_only_hint=True)` on the ten reads and
`destructive_hint=True` on `send_device_command`, passed through `register()` so
a tool cannot be added without a decision about what it does. This is the
protocol's own mechanism for telling a client that a tool is consequential;
without it clients infer intent from the description, which is prose.

## Risks / Trade-offs

- **A VIEWER or CLIENT who sends device commands today will get 403.** → This is
  intended, but it is a live behaviour change to a shipped endpoint. Mitigation:
  the frontend helper hides the control rather than letting it fail, the 403
  detail names the required roles, and the change is called out as BREAKING in
  the proposal. Before deploying, check whether any non-admin user has actually
  issued a command (`SELECT DISTINCT` over `device_commands` joined to `users`) —
  if someone has, that is a conversation, not a silent cutoff.

- **The reason field becomes boilerplate.** → A required free-text field invites
  "user requested it". Nothing in code can prevent that. The mitigation is that
  it is recorded and attributable: a pattern of empty reasons is visible in the
  audit trail and is a conversation about the agent, not about this feature.

- **Notification volume.** → A misbehaving agent could request many commands and
  generate a notification each. Accepted for now: the request path is already
  role-restricted, so the blast radius is a trusted user's agent. If it bites,
  the fix is coalescing in the dispatcher, not dropping the notification.

- **`request_reason` is free text from a model.** → It is rendered in the
  browser, where React escapes it, and it is capped in length. It is never
  dispatched to a device and never interpolated into SQL.

- **Self-approval remains possible.** → Deliberate, documented above, and visible
  in the UI and the audit row. If a tenant later needs four-eyes, that is a
  policy flag on top of this, not a redesign.

## Migration Plan

1. Migration `028` — additive: three nullable columns, one widened CHECK. No
   backfill. Existing rows keep their status and get NULL, which for
   `approved_by`/`rejected_by` means "no decision was ever required", not "not
   decided".
2. Deploy api (migration runs on start via `entrypoint.sh`).
3. Build web **locally** and ship the image; never build web on the staging box.
4. Verify: a pending request appears on the page and in a notification, approve
   dispatches exactly once, reject dispatches nothing, and a VIEWER sees neither
   the Send control nor the approvals entry.

**Rollback:** `028` downgrade drops the three columns and narrows the CHECK,
moving any `rejected` row to `failed` with its `error_message` preserved — the
same treatment `027` gives `awaiting_approval`. The UI is additive; reverting the
web image removes the page and leaves the API working.

## Open Questions

- Should the approvals page also show recently decided requests, or only
  pending? Starting with pending only; the audit log already answers "what was
  decided" and a queue that accumulates history stops being a queue.
- Should `MCP_ENABLED=false` hide the approvals nav entry entirely? Leaning no —
  the gate is a property of the command lifecycle now, and a request could
  outlive MCP being switched off mid-flight.
