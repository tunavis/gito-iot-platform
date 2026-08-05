## Purpose
Binds a device to the network server its downlinks are actually dispatched to, and
declares how that server accepts them, so uplinks and downlinks cannot describe two
different servers. Backed by `api/app/services/network_server.py`,
`devices.integration_id`, `integrations.downlink_mode`,
`api/app/services/secrets.py::EncryptedString`, and
`scripts/network_server_bindings.py`.

## Requirements

### Requirement: A device records which network server it is reached through
A device SHALL be able to name the integration its downlinks are dispatched to,
and that binding SHALL be explicit rather than inferred from traffic.

Uplinks already arrive per integration — one bridge per row. Dispatch resolved
from a single global setting, so the two halves could describe different servers
and a command would report `sent` having gone somewhere the device is not.

Inference from traffic is rejected: a device could not be dispatched to until it
had spoken, which excludes the post-join provisioning window that is the only
reliable one on both examined device families, and a wrong inference is silent.

#### Scenario: A device on a second network server
- **WHEN** a tenant runs two network servers and a command is sent to a device on
  the second
- **THEN** it is dispatched to the second, not to whichever one a platform-wide
  setting names

#### Scenario: A device with no binding
- **WHEN** a device names no integration
- **THEN** dispatch resolves exactly as it did before this capability existed —
  absence is the compatibility guarantee, not an error

#### Scenario: A binding is proposed rather than applied
- **WHEN** existing devices need binding to the server their uplinks arrive
  through
- **THEN** the mapping is reported for a person to apply, and no process assigns
  a binding on its own

### Requirement: How a downlink reaches a network server is declared, not inferred
An integration SHALL declare its downlink transport explicitly. The declaration
SHALL NOT be derived from how that server's uplinks arrive.

The two directions are independent. One client forwards uplinks over MQTT and
accepts downlinks on the same broker; another pushes uplinks over HTTP and
accepts downlinks only through a network-server API; a third can send to us and
receive nothing. Inferring the second direction from the first is correct for
whichever client is in front of us and wrong for the next.

#### Scenario: Uplinks and downlinks use different transports
- **WHEN** a network server delivers uplinks by one transport and accepts
  downlinks by another
- **THEN** both are honoured, because each is declared separately

#### Scenario: An undeclared downlink transport
- **WHEN** an integration has no declared downlink transport and a command is
  sent to one of its devices
- **THEN** the command is refused, rather than a transport being guessed

#### Scenario: A declared transport that is not implemented
- **WHEN** an integration declares a downlink transport the platform cannot
  perform
- **THEN** it is refused when saved, not when a command is dispatched

### Requirement: A server that cannot accept downlinks says so
An integration SHALL be able to declare that it accepts no downlinks, and a
command to a device on such a server SHALL be refused with that reason at the
moment it is issued.

A client who forwards uplinks and grants nothing else is a real configuration.
Without a way to say so, the command queues, waits out its full response window —
up to twelve hours for a B METERS IWM — and is recorded as timed out, which
asserts the device stayed silent. The device was never addressable.

#### Scenario: A receive-only network server
- **WHEN** a command is issued to a device on a server declared as accepting no
  downlinks
- **THEN** it is refused immediately, naming that as the reason, and no command
  is left pending

### Requirement: A binding that cannot be used fails loudly
When a device names an integration, dispatch SHALL use that integration or fail
with the reason. It SHALL NOT fall back to a platform-wide default.

Falling back would send the command to *a* network server rather than the right
one, over possibly the wrong transport, and report success. The fallback exists
only for a device that names nothing at all.

#### Scenario: The named integration is disabled or deleted
- **WHEN** a device's integration is inactive, missing, or lacks the endpoint its
  declared transport needs
- **THEN** the command fails with that reason recorded, and nothing is dispatched
  to any other server

#### Scenario: A platform-wide default is configured and a binding exists
- **WHEN** a device names an integration and a platform-wide endpoint is also set
- **THEN** the binding wins, and the platform-wide endpoint is not consulted

### Requirement: A downlink is addressed to the application the device reports from
Where the downlink transport addresses devices by network-server application,
the platform SHALL use the application the device's own uplinks state. It SHALL
allow the value to be set by hand to seed a device that has not yet spoken, and
an observed value SHALL then take precedence over the seeded one.

The application is a property of the device rather than of the server — devices
on one server may belong to different applications — and the address cannot be
formed without it. Unlike the choice of server, this is a fact the device's
traffic states about itself rather than a routing decision, which is why
observation is the authority: a downlink must be addressed to where the device
actually reports from, not to where someone believed it was.

#### Scenario: The application is learned from an uplink
- **WHEN** an uplink states the application its device belongs to
- **THEN** that is recorded against the device for addressing downlinks

#### Scenario: A device that has not yet spoken
- **WHEN** an operator sets the application by hand before any uplink
- **THEN** downlinks can be addressed immediately, without waiting for the
  device's next transmission

#### Scenario: Observation corrects a hand-entered value
- **WHEN** a device's uplinks state a different application from the one entered
- **THEN** the observed value replaces it, because the device is the authority on
  where it reports from and a stale entry would address downlinks into the wrong
  application

### Requirement: One credential per network server, never per device
The credential authorising downlinks SHALL be held once on the integration that
describes the network server, and SHALL NOT be stored on individual devices.

A credential copied onto every device is a credential rotated on every device,
and it places a secret in the same unencrypted attribute blob as a webhook URL
and a location.

#### Scenario: Rotating a network server's credential
- **WHEN** a network server's credential changes
- **THEN** it is updated in one place and every device reached through that
  server continues to dispatch

#### Scenario: A network server needing no credential
- **WHEN** a server accepts downlinks without authentication
- **THEN** no credential is required, and none is invented

### Requirement: A stored outbound credential is encrypted at rest
A credential used to authenticate outbound calls SHALL be encrypted before it is
stored, using a key that is not held in the database.

Row-level security is inert under the application's database role, so a
plaintext credential is readable by any code path, injection, or backup that
reaches the table — and this credential can queue downlinks to every device on
its server.

#### Scenario: The database is read without the application
- **WHEN** the stored value is read directly from the database
- **THEN** it does not yield a usable credential

#### Scenario: The encryption key is absent
- **WHEN** the application starts without its key and encrypted credentials exist
- **THEN** it fails to start, rather than degrading to reading plaintext or
  skipping decryption

#### Scenario: A credential is read back through the API
- **WHEN** an integration is retrieved
- **THEN** the credential is returned masked, never in full

#### Scenario: A credential is written by a path that forgot to encrypt
- **WHEN** any write path stores this credential
- **THEN** encryption is applied by construction rather than by each caller
  remembering, so a plaintext value cannot reach the column
