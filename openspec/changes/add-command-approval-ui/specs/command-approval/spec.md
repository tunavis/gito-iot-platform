## ADDED Requirements

### Requirement: A pending approval reaches a human without being searched for
The system SHALL surface commands in `awaiting_approval` to authorised users
through a tenant-wide queue at `/dashboard/approvals`, a pending count in the
sidebar navigation, and a notification raised through the existing dispatcher
when a request enters the state.

Discovery is the whole point: the per-device commands list already existed and
was insufficient, because finding a request through it requires already
suspecting the device it targets.

#### Scenario: A request is raised while nobody is looking at the screen
- **WHEN** an agent calls `send_device_command` and a row enters `awaiting_approval`
- **THEN** a notification is dispatched through `notification_dispatcher`, so the
  request reaches someone who is not currently logged in

#### Scenario: An authorised user opens the platform
- **WHEN** a user with `SUPER_ADMIN`, `TENANT_ADMIN` or `SITE_ADMIN` loads any
  dashboard page while requests are pending
- **THEN** the sidebar shows the count of pending requests for their tenant

#### Scenario: Notifications fire on entry only
- **WHEN** a pending request is subsequently approved or rejected
- **THEN** no further notification is dispatched — the notification means
  "someone must act", not "something happened"

#### Scenario: Requests from another tenant are never listed
- **WHEN** `GET /tenants/{t}/command-approvals` is called with a credential for
  tenant A and tenant B has pending requests
- **THEN** only tenant A's requests are returned, and the count reflects only
  tenant A

### Requirement: The queue shows enough to decide, not merely enough to identify
The approvals list SHALL show, per request: the device name and its site, the
command name and its parameters, the reason the agent gave, who requested it, and
the time remaining before the request lapses.

An operator shown only "close_valve on Pump 3" is rubber-stamping. The reason is
required at the tool boundary precisely so this screen has something to show.

#### Scenario: A request is displayed
- **WHEN** an authorised user views the approvals queue
- **THEN** each row shows device name, site name, command name, parameters, the
  agent's `request_reason`, the requesting user, and time remaining

#### Scenario: A request is close to expiry
- **WHEN** a request's `expires_at` is in the past
- **THEN** it is not listed as pending, and approving it is refused — an expired
  request must be re-requested rather than actioned late

#### Scenario: Only pending requests appear
- **WHEN** requests have been approved or rejected
- **THEN** they leave the queue; the audit log is where decisions are read back,
  and a queue that accumulates history stops being a queue

### Requirement: Approving and rejecting are both recorded decisions
The system SHALL record an actor and a timestamp for both outcomes:
`approved_by`/`approved_at` on approval, `rejected_by`/`rejected_at` on
rejection. Rejection SHALL move the command to `rejected` and dispatch nothing.

Without an explicit rejection, "nobody approved this" and "someone actively
refused it" are the same row, which defeats the purpose of keeping the record.

#### Scenario: A request is rejected
- **WHEN** an authorised user rejects a pending request
- **THEN** the command's status becomes `rejected`, `rejected_by` and
  `rejected_at` are set, nothing is dispatched to the device, and the request
  leaves the queue

#### Scenario: A decision is attempted twice
- **WHEN** approve or reject is called on a command that is no longer
  `awaiting_approval`
- **THEN** `409 Conflict`, and no dispatch occurs — the row is locked
  `FOR UPDATE` for the duration of the decision so two concurrent approvals
  cannot both dispatch

#### Scenario: The requester approves their own agent's request
- **WHEN** `approved_by` equals `requested_by`
- **THEN** the approval succeeds and is displayed as self-approved — blocking it
  would break single-admin tenants and buys nothing, since the same user may
  issue the command directly; the control is that a human looked, and the record
  shows who

### Requirement: Only roles that may actuate a device may decide
Issuing, approving and rejecting a device command SHALL be restricted to
`SUPER_ADMIN`, `TENANT_ADMIN` and `SITE_ADMIN`, enforced by one shared dependency
so there is a single definition of "may actuate a device".

#### Scenario: A read-only role attempts to decide
- **WHEN** a `VIEWER` or `CLIENT` calls approve or reject
- **THEN** `403 Forbidden`, naming the roles that are permitted

#### Scenario: A read-only role loads the platform
- **WHEN** a `VIEWER` or `CLIENT` is signed in
- **THEN** the approvals navigation entry and the device Commands send control
  are not rendered — a control that always fails is worse than an absent one
