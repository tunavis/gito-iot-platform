## MODIFIED Requirements

### Requirement: Dispatch resolves its network server from the device, not from a setting
Command and firmware dispatch SHALL resolve the network server, its downlink
transport, and its credential from the device's integration binding, falling
back to the existing device-attribute and platform-wide lookup only when the
device names no integration.

Today both paths read `attributes.chirpstack_server` or a single
`CHIRPSTACK_API_URL`, and always over one transport. That cannot express a fleet
spread across two network servers, nor a server reached by a different transport,
and the attribute path requires a credential in plaintext on every device.

#### Scenario: A bound device is dispatched to
- **WHEN** a command or firmware update is sent to a device that names an
  integration
- **THEN** the transport, endpoint and credential come from that integration

#### Scenario: Firmware dispatch resolves the same way
- **WHEN** an OTA campaign reaches a bound device
- **THEN** it resolves through the same binding as a command, because they share
  one transport and must not disagree about where the device is

#### Scenario: An unbound device keeps today's behaviour
- **WHEN** a device names no integration
- **THEN** the existing resolution order applies unchanged

### Requirement: A command that cannot be delivered is refused, not left pending
When the platform can determine before dispatch that a device is unreachable —
its network server accepts no downlinks, or its binding cannot be resolved — the
command SHALL be refused with that reason instead of entering the pending
lifecycle.

A command left pending expires against its response window and is recorded as
timed out, which asserts the device did not answer. A device on a receive-only
server was never asked.

#### Scenario: The device's server accepts no downlinks
- **WHEN** a command is issued to a device whose network server is declared
  receive-only
- **THEN** it is refused at issue, and the reason names the server rather than
  the device

#### Scenario: The reason reaches the operator
- **WHEN** dispatch fails because the network server could not be resolved
- **THEN** the recorded error says which server was expected and why it could not
  be used
