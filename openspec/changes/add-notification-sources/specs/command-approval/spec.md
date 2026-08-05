## MODIFIED Requirements

### Requirement: A pending approval reaches someone who is not signed in
When a command enters `awaiting_approval`, the platform SHALL raise a
notification to the tenant's configured channels, once per request.

The approval queue and its sidebar count are only visible to someone already
signed in, and an unapproved request lapses after 24 hours in silence. For a gate
whose entire purpose is that a human looks, "the human happened to be logged in"
is not a guarantee.

#### Scenario: An agent requests a command
- **WHEN** a command is recorded as awaiting approval
- **THEN** one notification is raised naming the device, the command and the
  stated reason

#### Scenario: A decision is made
- **WHEN** the request is approved or rejected
- **THEN** no further notification is raised — a notification per decision turns
  an alert into a log

#### Scenario: The same request cannot notify twice
- **WHEN** a notification has already been raised for a request
- **THEN** a second raise for that request is refused

#### Scenario: The command is recorded even if notification fails
- **WHEN** raising the approval notification fails
- **THEN** the command still enters `awaiting_approval` and appears in the
  approval queue, because a request nobody was told about is recoverable and a
  command silently refused is not
