## ADDED Requirements

### Requirement: Onboarding a device family requires data, not platform code
The system SHALL allow a new device family to be integrated by supplying a
driver declaration for its device type, without adding or modifying dispatch
branches, parsers, or lifecycle special cases.

This is the acceptance criterion for the whole capability. A driver that works
for one vendor while the next vendor still needs a code change has not met it.

#### Scenario: A new vendor is integrated
- **WHEN** a device family with an unfamiliar wire format is added
- **THEN** it is onboarded by declaring a driver for its device type, and no
  platform source file changes

#### Scenario: A device type has no driver
- **WHEN** a device's type declares no driver
- **THEN** dispatch, decoding and timing behave exactly as they did before this
  capability existed — absence is the compatibility guarantee, not an error

### Requirement: A driver declares how the platform speaks to a device type
A driver SHALL declare transport binding, downlink encoding, uplink decoding,
acknowledgement semantics and timing for one device type.

The unit is the device type and not the vendor or the protocol, because one
vendor's own product lines demonstrably share nothing: B METERS IWM uses a
5-byte header with the verb in the opcode while RFM uses a 2-byte header with an
explicit verb, and `0x0A` resets the first while reading a temperature on the
second.

#### Scenario: Two families from one vendor
- **WHEN** two device types from the same vendor use conflicting opcode meanings
- **THEN** each carries its own driver and neither can misinterpret the other's
  commands

#### Scenario: Transport parameters travel with the driver
- **WHEN** a driver declares a LoRaWAN port and confirmed flag
- **THEN** dispatch uses them rather than any platform-wide default

### Requirement: A codec may be declarative or a script, and declarative is preferred
The system SHALL accept two codec forms: a declarative byte-layout spec, and a
script supplied by a vendor or customer. Declarative SHALL be the default form.

Both are necessary. Declarative alone would require transcribing every vendor's
codec by hand — dozens of models per vendor, each an opportunity for a wrong
offset — which is the per-vendor friction this capability exists to remove.
Script alone would force a sandbox onto integrations that do not need one.

#### Scenario: A vendor ships JavaScript
- **WHEN** a vendor publishes `*-decoder.js` and `*-encoder.js` for its models
- **THEN** those files can be used as the driver's codec unmodified

#### Scenario: A layout is transcribed from a manual
- **WHEN** a device family is documented only as a byte table
- **THEN** it is declared declaratively and no code executes for it

### Requirement: Script codecs execute under containment, or not at all
A script codec SHALL execute with no filesystem access, no network access, no
host bindings, and hard CPU, wall-clock and memory limits, in a context that
cannot carry state between tenants.

This is not hardening to schedule later. RLS is inert under the application's
database role, so tenant-supplied code runs beside every tenant's data with
nothing beneath it to contain a breach. A codec is a pure function from bytes to
JSON and requires nothing else.

#### Scenario: A codec loops forever
- **WHEN** a script codec does not terminate
- **THEN** it is killed at its wall-clock limit and the payload is recorded as
  undecodable, without affecting other decoding

#### Scenario: A codec attempts to reach outside itself
- **WHEN** a script codec attempts filesystem, network or host access
- **THEN** the attempt fails and the codec cannot observe anything about the host

#### Scenario: Containment cannot be demonstrated
- **WHEN** no candidate runtime demonstrably contains hostile inputs
- **THEN** the script codec form is not shipped, and the declarative form still
  delivers multi-vendor support

### Requirement: The platform states honestly what it knows about a command
A driver SHALL declare how its device acknowledges commands, including that some
commands cannot be acknowledged at all. A command that cannot be acknowledged
SHALL reach a terminal state on successful delivery rather than awaiting a reply.

No third-party device echoes the platform's correlation id. IWM echoes the
opcode; RFM echoes the frame and has a NACK; IWM `RESET` and RFM `0x03 0x05`
answer nothing ever. Without this, a correctly delivered command is recorded as
a failure — the system working and the records lying.

#### Scenario: A command that can never be answered
- **WHEN** a command listed as unacknowledgeable is delivered successfully
- **THEN** it reaches a terminal state reflecting delivery, and is never recorded
  as timed out

#### Scenario: A device answers in its own dialect
- **WHEN** a device confirms by echoing an opcode or a frame rather than a
  correlation id
- **THEN** the response is correlated to the command by device and opcode, with
  at most one such command in flight per pair

### Requirement: Timing is a property of the device, not a platform constant
A driver SHALL declare the window within which its device can respond, and that
window SHALL govern expiry for commands to that device type.

A B METERS IWM reports on an interval of up to twelve hours, settable only over
NFC. The platform's sixty-second constant is not mistuned for such a device, it
is wrong by three orders of magnitude, and would mark every command failed long
before the device could physically answer.

#### Scenario: A device with a long reporting interval
- **WHEN** a command is sent to a device whose driver declares a twelve-hour
  response window
- **THEN** it remains outstanding for that window rather than expiring on the
  platform default

#### Scenario: A device type with no driver
- **WHEN** no driver declares a window
- **THEN** the existing platform default applies unchanged

### Requirement: An unknown protocol fails loudly
Protocol selection SHALL consult the driver's declared transport first, then the
device type's declared protocol, and SHALL raise for a protocol it cannot
dispatch rather than falling back to a default.

Today an unrecognised protocol falls through to MQTT: a device type declaring
`modbus` has its commands published to an MQTT channel silently. A wrong answer
delivered quietly is worse than a refusal.

#### Scenario: A protocol with no dispatch path
- **WHEN** a device's resolved protocol has no implementation
- **THEN** the command fails with that reason recorded, and nothing is published
  to any other transport

#### Scenario: The declared protocol disagrees with the heuristics
- **WHEN** a driver declares a transport that the field heuristics would not have
  inferred
- **THEN** the declaration wins
