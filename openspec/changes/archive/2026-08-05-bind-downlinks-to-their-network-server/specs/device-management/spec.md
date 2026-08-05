## MODIFIED Requirements

### Requirement: A device records the integration it is reached through
A device SHALL carry an optional reference to the integration describing its
network server, settable when the device is created or updated.

#### Scenario: Binding a device on create or update
- **WHEN** a device is created or updated with an integration reference
- **THEN** it is stored, and subsequent downlinks resolve through it

#### Scenario: The referenced integration is deleted
- **WHEN** an integration a device references is deleted
- **THEN** the device's reference is cleared rather than the device being
  deleted, and it reverts to the unbound resolution path

#### Scenario: A device references an integration from another tenant
- **WHEN** a device is given an integration reference belonging to a different
  tenant
- **THEN** the write is refused
