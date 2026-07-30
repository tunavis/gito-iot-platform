## ADDED Requirements

### Requirement: A device carries an optional asset attachment as a first-class column
The system SHALL add `asset_id` to `devices` as a real, nullable column with a
foreign key to `assets`, and SHALL accept and return it on the device create, update,
and read endpoints.

This is deliberately **not** folded into the `attributes` JSONB. The existing
requirement that GPS and vendor fields live in `attributes` rather than dedicated
columns is scoped to that named field list (`latitude`, `longitude`,
`mqtt_client_id`, `app_key`, and the duplicated `serial_number`) — fields nothing
joins on. `asset_id` is a foreign key that subtree rollups and asset device lists
join and index on, so a JSONB key would be the wrong shape.

#### Scenario: Creating a device with an asset
- **WHEN** `POST /tenants/{id}/devices` supplies `asset_id`
- **THEN** the device is stored with that `asset_id` in the column, and the value is
  absent from the `attributes` JSONB

#### Scenario: Reading a device that has no asset
- **WHEN** a device with `asset_id IS NULL` is read
- **THEN** the response includes `asset_id` as `null` rather than omitting the field

### Requirement: Devices may be attached and detached without affecting other device behaviour
The system SHALL allow a device's `asset_id` to be set, changed, or cleared through
the existing device update endpoint, and SHALL leave all other device behaviour
unchanged when it does — offline-status computation, dev_EUI uniqueness, ChirpStack/
TTN sync triggering, telemetry ingestion, and alarm evaluation SHALL NOT read or
depend on `asset_id` in this change.

#### Scenario: Clearing an asset attachment
- **WHEN** `PUT /tenants/{id}/devices/{device_id}` sets `asset_id` to `null`
- **THEN** the device is detached, still exists, and its status, dev_EUI, and
  telemetry are unaffected

#### Scenario: Attaching an asset does not trigger LoRaWAN sync
- **WHEN** a device update changes only `asset_id`
- **THEN** no ChirpStack/TTN sync is initiated, since no LoRaWAN field changed

#### Scenario: Alarm evaluation ignores asset attachment
- **GIVEN** a device attached to an asset with an alert rule that would fire
- **WHEN** telemetry arrives that breaches the rule
- **THEN** the alarm fires exactly as it would for an unattached device, and the
  alarm record is keyed by `device_id`

### Requirement: Existing devices remain valid and unattached after the migration
The system SHALL require no backfill for `asset_id`. Every device that existed before
the migration SHALL remain valid with `asset_id IS NULL`, and every device endpoint
SHALL behave for those devices exactly as it did before the column existed.

#### Scenario: Pre-existing device after migration
- **GIVEN** a device created before the asset registry migration
- **WHEN** it is read, updated, or listed after the migration
- **THEN** it succeeds with `asset_id` reported as `null`, and no request is rejected
  for lacking an asset

#### Scenario: Device creation without an asset
- **WHEN** `POST /tenants/{id}/devices` omits `asset_id` entirely
- **THEN** the device is created with `asset_id IS NULL` and no validation error
