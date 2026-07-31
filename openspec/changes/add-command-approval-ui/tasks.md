## 1. Data model

- [x] 1.1 Migration `028_command_rejection_and_reason`: add
      `device_commands.request_reason` (text, nullable), `.rejected_by` (uuid FK
      users SET NULL), `.rejected_at` (timestamptz), and add `'rejected'` to the
      `valid_command_status` CHECK. Additive, no backfill — mirror `027`'s shape.
- [x] 1.2 Downgrade moves any `rejected` row to `failed` preserving
      `error_message`, then narrows the CHECK. A refusal happened; deleting it
      would be the one thing rollback must not do.
- [x] 1.3 Update the `DeviceCommand` model and `CommandResponse` schema. NULL on
      the decision columns means "no decision was required", not "undecided" —
      say so in a comment, because the next reader will assume otherwise.

## 2. Authorization — the root cause, not the symptom

- [x] 2.1 One shared FastAPI dependency for "may actuate a device"
      (`SUPER_ADMIN`/`TENANT_ADMIN`/`SITE_ADMIN`), using the same ladder
      `ToolContext.may_issue_commands` already encodes. One definition, not two
      that drift.
- [x] 2.2 Apply it to `send_command`, `approve_command`, and the new
      `reject_command`. **BREAKING** on `send_command`.
- [x] 2.3 The 403 detail names the permitted roles — a refusal a user cannot act
      on is a support ticket.
- [x] 2.4 Checked on staging 2026-07-31: `SELECT count(*) FROM device_commands`
      is **0** — no command has ever been issued there, by any role, so the gate
      cuts nobody off. Re-run this against production before it goes there.

## 3. Endpoints

- [x] 3.1 `POST /tenants/{t}/devices/{d}/commands/{c}/reject` — mirrors approve:
      same `FOR UPDATE` lock, same "still awaiting?" check, sets
      `rejected_by`/`rejected_at`, status `rejected`, dispatches nothing.
- [x] 3.2 `GET /tenants/{t}/command-approvals` — second `APIRouter` in
      `commands.py` (tenant-scoped), returning pending requests with device and
      site names joined, plus the pending count for the badge. Keep it in
      `commands.py`: everything deciding whether a command reaches a device
      lives in one file.
- [x] 3.3 Expired requests are excluded from the list and refused at approve —
      already true at approve; assert the list agrees.
- [x] 3.4 `approve_command` returns whether the decision was a self-approval
      (`approved_by == requested_by`) so the UI can label it rather than making
      the client compare two ids.

## 4. Notification — DEFERRED to `add-approval-notifications`

Removed from this change during implementation, not dropped. The premise these
tasks rested on was wrong: `NotificationDispatcher` has exactly one entry point,
`process_alert_event(alert_event_id)`, and `notification_queue.alert_event_id` is
**NOT NULL** with an FK to `alert_events`. There is no generic "send a
notification" path to reuse — the whole pipeline is alert-event-shaped.

Widening it means making that FK nullable and teaching the dispatcher a second
source: a migration on a live table the entire alarm path depends on, for one new
caller. That is a bigger and riskier change than everything else here combined,
and it earns its own proposal rather than arriving as a footnote to a UI change.

Rejected on the way: synthesising an `AlertEvent` per approval request. It would
have worked in an afternoon and put approval requests into alarm counts, alert
trends, and every existing `alert_events` aggregation — corrupting the meaning of
data other features already read, to save a migration.

**Consequence, stated plainly:** until that change lands, a pending request is
visible only to someone already signed in. That is a real and partial fix, not
the whole one.

- [x] 4.1 Deferred — see `openspec/changes/add-approval-notifications`.

## 5. MCP

- [x] 5.1 `send_device_command` gains a required `reason` argument, positional
      before the optional `parameters` so it cannot be quietly omitted.
- [x] 5.2 Persist it to `request_reason` via `request_command_approval`.
- [x] 5.3 Tool description states the reason is shown to the human who decides —
      a model told who reads it writes a better one.
- [x] 5.4 Add `ToolAnnotations` through `register()`: `read_only_hint` on the ten
      reads, `destructive_hint` on the write.
- [x] 5.5 Make the annotation **required** by the registrar, so a tool cannot be
      added without declaring its effect — same enforcement-by-construction as
      the tenant-parameter guard, and a test that registration fails without it.

## 6. Frontend

- [x] 6.1 Role helper in `web/src/lib/` reading the role claim already parsed
      from the JWT. None exists today; this is the first.
- [x] 6.2 `/dashboard/approvals` page: device and site, command and parameters,
      the agent's reason, requester, time remaining, Approve / Reject per row.
- [x] 6.3 Sidebar entry with pending count, hidden entirely for roles that may
      not decide.
- [x] 6.4 Hide the send control on the device Commands tab for those same roles —
      a control that always 403s is worse than an absent one.
- [x] 6.5 Label a self-approval in the UI, so an auditor sees it rather than
      inferring it from two ids.
- [x] 6.6 Empty state that reads as reassurance, not breakage: no pending
      requests is the normal condition, not an error.
- [x] 6.7 Optimistic removal on decide, with the row restored if the call fails —
      a 409 from a concurrent decision must not look like success.

## 7. Verification

- [x] 7.1 Reject dispatches nothing and records the actor; approve still
      dispatches exactly once (extend `test_command_approval_gate.py`).
- [x] 7.2 `VIEWER`/`CLIENT` get 403 on send, approve and reject.
- [x] 7.3 `GET /command-approvals` is tenant-scoped — extend
      `test_mcp_tenant_isolation.py`, which already has the two-tenant fixture.
- [x] 7.4 MCP tool refuses without a reason; the reason reaches `request_reason`
      and the audit row.
- [x] 7.5 Registration fails for a tool with no annotation.
- [x] 7.6 The badge count equals the number of rows the list returns.
- [x] 7.7 Full suite in-container: `docker exec gito-api python -m pytest tests/ -q`.
- [ ] 7.8 End-to-end through the **real login** as the Claude test account
      (`claude-playwright@gito.demo`), not a minted token: request a command over
      MCP, see it on the approvals page with its reason, approve it, confirm one
      dispatch and the audit trail.

## 8. Deployment

- [ ] 8.1 Migration runs on api start; rebuild and restart api.
- [ ] 8.2 Build web **locally** and ship the image. Never build web on the
      staging box — 4.8 GB total RAM, and a Next.js build there takes the
      running app down with it.
- [ ] 8.3 Verify on `:8090`, never on the public hostname, which does not
      resolve.

## 9. Documentation

- [x] 9.1 `docs/MCP_SERVER.md`: the reason argument, the annotations, and where a
      human actually approves — the doc currently describes a gate with no
      described way to pass it.
- [x] 9.2 `CLAUDE.md`: record that issuing a device command is role-restricted,
      since it previously was not and that assumption is in people's heads.
