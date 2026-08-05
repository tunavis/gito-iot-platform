## MODIFIED Requirements

### Requirement: Template selection matches the notification's type, falling back to an untyped template
Template selection SHALL prefer an enabled template whose `alert_type` matches
the notification being sent, and SHALL fall back to an enabled template with no
`alert_type` when none matches.

`alert_type` is stored on templates today and never read — selection takes the
first enabled template for the channel type, so exactly one template per channel
can ever be used. A platform fault and a critical alarm reaching the same wording
is the immediate problem; the general one is that a stored field the product
invites people to fill in does nothing.

The untyped fallback is what keeps existing setups working: a tenant with one
enabled template per channel and no `alert_type` set continues to get that
template for everything.

#### Scenario: A typed template matches
- **WHEN** a notification is sent and an enabled template for that channel names
  its type
- **THEN** that template is used

#### Scenario: No typed template matches
- **WHEN** no enabled template for that channel names the notification's type
- **THEN** an enabled template with no type is used

#### Scenario: An existing single-template setup
- **WHEN** a tenant has one enabled template per channel with no type set
- **THEN** it is selected for every notification, exactly as before

#### Scenario: No template at all
- **WHEN** no enabled template matches by either rule
- **THEN** the source's own default rendering is used rather than an alarm
  sentence

### Requirement: The notification queue accepts sources other than alert events
The queue SHALL accept a row that references no alert event, and processing SHALL
handle such a row without treating the missing reference as corruption.

#### Scenario: Processing a row with no alert event
- **WHEN** the queue processor reaches a row whose source is not an alert event
- **THEN** it is dispatched using that source's own data, and no alert lookup is
  attempted

#### Scenario: Alarm rows keep their exactly-once guarantee
- **WHEN** an alert event is queued twice
- **THEN** the second is still refused, unchanged by this capability
