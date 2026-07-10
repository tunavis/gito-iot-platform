## Purpose
Lets a tenant admin manage inbound/outbound device-network integrations (ChirpStack webhook, ChirpStack MQTT bridge, TTN, Helium, Actility, generic MQTT/HTTP) and bulk-register devices a bridge has discovered but the tenant hasn't onboarded yet. Implemented in `web/src/app/dashboard/connections/page.tsx`.

## Requirements

### Requirement: Integrations are typed by provider, each with its own setup flow
The system SHALL support 8 provider keys (`chirpstack`, `chirpstack_mqtt`, `ttn`, `helium`, `actility`, `mqtt`, `http`, `custom`), distinguishing webhook-style (device network pushes to Gito) from `chirpstack_mqtt` (Gito subscribes outbound to the customer's broker via the processor's `BridgeWorker`).

#### Scenario: Creating a webhook integration
- **WHEN** a user creates a `chirpstack`/`ttn`/`helium`/`actility` integration
- **THEN** the response includes a generated API key (shown once), a `webhook_url`, and provider-specific `setup_instructions.steps`

#### Scenario: Creating a ChirpStack MQTT bridge integration
- **WHEN** a user creates a `chirpstack_mqtt` integration
- **THEN** the response is a `CreatedMqttIntegration` (broker URL, port, `bridge_status`) instead of an API key — there is no secret to copy because Gito connects outbound using stored broker credentials

### Requirement: Unregistered devices discovered by a bridge are surfaced per-integration and bulk-registerable
The system SHALL, for a `chirpstack_mqtt` integration with `unknown_device_count > 0`, let the user expand an "Unregistered devices" panel that fetches `GET /tenants/{id}/integrations/{id}/unknown-devices`, select any subset by `dev_eui`, choose one device type, an optional name prefix, and submit `POST /tenants/{id}/devices/bulk-register` with `{dev_euis, device_type_id, name_prefix, integration_id}`.

#### Scenario: Select-all toggling
- **WHEN** the user clicks the header checkbox while some but not all discovered devices are selected
- **THEN** the checkbox shows an indeterminate state, and clicking it selects all remaining (rather than clearing)

#### Scenario: Bulk register succeeds
- **WHEN** the bulk-register call returns 2xx
- **THEN** the registered `dev_euis` are removed from the unknown-devices list, the selection is cleared, and a success message (from the response, or a computed `Registered {n} device(s)` fallback) is shown

#### Scenario: Register button is disabled without a device type
- **WHEN** no devices are selected or no `typeId` is chosen
- **THEN** the "Register selected" button is disabled regardless of submit state

### Requirement: Bulk-register is unavailable without at least one active device type
The system SHALL populate the device-type dropdown from `GET /tenants/{id}/device-types?is_active=true`; if that list is empty the dropdown has only the placeholder "Device type…" option, which — combined with the disabled-without-typeId rule — makes registration impossible until a device type exists.

#### Scenario: Tenant has no device types yet
- **WHEN** `device-types?is_active=true` returns an empty list
- **THEN** the register button stays disabled for every discovered device until the user creates a device type elsewhere in the app
