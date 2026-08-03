## MODIFIED Requirements

### Requirement: Ingest records the network-server application an uplink states
The ingest path SHALL record the network-server application an uplink declares
for its device, so a downlink can later be addressed to the same application.

The identifier arrives on every message — in the MQTT topic and in the uplink
body — and is currently discarded. Where the downlink transport addresses
devices by application, it cannot be formed without it, and asking an operator to
retype something the traffic already states is how the two drift apart.

#### Scenario: An uplink names its application
- **WHEN** an uplink arrives carrying the application its device belongs to
- **THEN** that application is recorded against the device

#### Scenario: A device moved to another application
- **WHEN** a device's uplinks begin stating a different application
- **THEN** the recorded value follows, so downlinks continue to address it
  correctly

#### Scenario: Recording it changes nothing else about ingest
- **WHEN** the application is recorded
- **THEN** telemetry decoding, storage and alarm evaluation are unaffected
