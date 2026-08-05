## ADDED Requirements

### Requirement: A notification may be about something that is not an alert
A queued notification SHALL be able to describe a source other than an alert
event, and the source SHALL be named by an explicit discriminator rather than
inferred from the absence of an alert reference.

Every notification the product could send had to first be an alarm, because
`notification_queue.alert_event_id` was `NOT NULL`. Inferring "not an alarm" from
a null reference would make the second non-alarm source indistinguishable from
the first, leaving a reader holding a payload it cannot identify.

#### Scenario: A non-alert notification is queued
- **WHEN** a source that is not an alert event queues a notification
- **THEN** it is accepted with no alert reference, and its kind is recorded
  explicitly

#### Scenario: Existing alarm notifications are unaffected
- **WHEN** an alert event queues a notification after this capability exists
- **THEN** it behaves exactly as before, and is recorded as being of the alert
  kind

#### Scenario: A reader distinguishes sources
- **WHEN** a queued notification is processed
- **THEN** its source is determined from the recorded kind, never from whether an
  alert reference happens to be absent

### Requirement: A non-alert source is queued at most once per event it reports
A non-alert notification SHALL carry a key identifying the event it reports, and
the platform SHALL refuse a second notification for the same key at the database
rather than in the raising code.

The unique index on the alert reference gives alarms exactly-once queuing. Nulls
are distinct in that index, so non-alert rows would inherit no protection at all
and a flapping condition would queue one notification per tick. Two concurrent
raisers would each read "nothing queued" and both insert, so the check cannot
live in the caller.

#### Scenario: The same event is reported twice
- **WHEN** a source raises a notification for an event it has already raised
- **THEN** the second is refused, and one notification exists for that event

#### Scenario: Two raisers race
- **WHEN** two concurrent attempts raise the same event
- **THEN** exactly one is stored, decided by the database rather than by
  whichever read first

#### Scenario: Distinct events from the same source
- **WHEN** one source raises notifications for two different events
- **THEN** both are stored

### Requirement: A platform fault is delivered to the management tenant, or to nobody
Where a notification describes a platform-wide fault rather than a tenant's own
data, the platform SHALL resolve the management tenant from stored tenant records
and deliver there. If exactly one management tenant cannot be identified, it
SHALL record the failure and deliver nothing.

A stall is detected across all tenants by construction, but a queued notification
requires a tenant and channels are per-user-per-tenant. Fanning a platform fault
to every tenant's admins tells twenty people something none of them can act on.
Nothing in the schema enforces that exactly one management tenant exists, so both
the zero and the many case are reachable and neither has a safe guess: with none
there is nobody to tell, and with several an arbitrary pick delivers our
infrastructure's problems to a customer.

#### Scenario: One management tenant exists
- **WHEN** a platform fault is raised
- **THEN** it is delivered to that tenant's configured channels

#### Scenario: No management tenant exists
- **WHEN** a platform fault is raised and no tenant is marked as management
- **THEN** nothing is queued, and the reason is recorded

#### Scenario: Several management tenants exist
- **WHEN** more than one tenant is marked as management
- **THEN** nothing is queued and all candidates are named in the record, rather
  than one being chosen

### Requirement: Failing to notify never fails the thing being notified about
Raising a notification SHALL NOT propagate a failure into the operation that
triggered it.

The stall detector must keep detecting if the queue is unavailable, and a command
must still enter its approval state if the announcement cannot be sent. A queued
but unannounced approval is recoverable, because the queue is still visible; an
approval refused because notification failed is a device command silently lost.

#### Scenario: The queue is unavailable when a stall is detected
- **WHEN** raising a stall notification fails
- **THEN** stall detection completes and the failure is recorded

#### Scenario: The queue is unavailable when a command awaits approval
- **WHEN** raising an approval notification fails
- **THEN** the command still enters the awaiting-approval state and remains
  visible in the approval queue

### Requirement: A notification renders meaningfully with no template configured
Where no template matches, the platform SHALL render a default appropriate to the
notification's source.

The no-template path is not an edge case — it is the live path wherever no
templates have been authored. That default is written for alarms and names a
device, so a platform fault, which has no device, would render as a sentence
about a device that does not exist.

#### Scenario: A platform fault with no template
- **WHEN** a stall notification is sent and no template matches
- **THEN** the message describes the stall, and names no device

#### Scenario: An alarm with no template
- **WHEN** an alarm notification is sent and no template matches
- **THEN** it renders exactly as it did before this capability existed
