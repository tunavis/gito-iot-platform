# Universal LoRaWAN Webhook Integration

**Project:** Gito IoT Platform
**Date:** 2026-03-26
**Status:** Design approved, pending implementation

## Problem

Gito can only receive LoRaWAN telemetry from a self-hosted ChirpStack instance on the same Docker network (via MQTT). Customers using TTN, Helium, Actility, or a remote ChirpStack have no way to forward data into the platform. This blocks enterprise adoption — competitors (Cumulocity, ThingsBoard) accept data from any LoRaWAN network server via HTTP webhooks.

## Solution

A universal HTTP webhook endpoint that accepts uplinks from any LoRaWAN network server, with provider-specific parsers that normalize payloads into Gito's telemetry format. Backed by an integration management API for key generation, revocation, and per-provider setup instructions.

## Architecture

### New Ingestion Path (Path 4)

```
Any LNS (TTN, ChirpStack, Helium, Actility, custom)
  → POST /api/v1/ingest/lorawan/{provider}
  → Authorization: Bearer {integration_key}
  → Provider parser normalizes payload
  → dev_eui resolved to (tenant_id, device_id)
  → Same telemetry pipeline as /ingest
  → Redis pub/sub (WebSocket) + digital twin update
```

### Coexistence With Existing Paths

| Path | Transport | Auth | Use Case |
|------|-----------|------|----------|
| 1. Direct MQTT | `+/devices/+/telemetry` | MQTT broker credentials | Devices publishing directly |
| 2. HTTP Token | `POST /api/v1/ingest` | `X-Device-Token` | HTTP devices, microcontrollers |
| 3. ChirpStack MQTT | `application/+/device/+/event/up` | MQTT broker credentials | Self-hosted ChirpStack (same network) |
| **4. LoRaWAN Webhook** | **`POST /api/v1/ingest/lorawan/{provider}`** | **Integration key (Bearer)** | **Any external LNS** |

Paths 1-3 remain unchanged. Path 4 is additive.

---

## Database Schema

### `integrations` table

```sql
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- What provider this integration connects to
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,

    -- Auth
    key_hash VARCHAR(64) NOT NULL,
    key_prefix VARCHAR(12) NOT NULL,

    -- Config (provider-specific settings)
    config JSONB NOT NULL DEFAULT '{}',

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ,
    message_count BIGINT NOT NULL DEFAULT 0,

    -- Audit
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(tenant_id, name)
);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integrations
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE INDEX idx_integrations_tenant ON integrations(tenant_id);
CREATE INDEX idx_integrations_key_hash ON integrations(key_hash);

-- SECURITY DEFINER function for key lookup (bypasses RLS, same pattern as device tokens)
CREATE OR REPLACE FUNCTION resolve_integration_key(p_key_hash VARCHAR)
RETURNS TABLE(integration_id UUID, tenant_id UUID, provider VARCHAR, config JSONB, is_active BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT id, tenant_id, provider, config, is_active
    FROM integrations
    WHERE key_hash = p_key_hash;
$$;
```

Key design decisions:
- `key_hash` — SHA256 of the raw key, never stored in plaintext
- `key_prefix` — first 12 chars shown in UI for identification (e.g., `gito_ik_a3b2`)
- `message_count` + `last_used_at` — operational health at a glance
- `config` — future-proofs for custom field mappings, filtering, etc.
- `provider` — validated against known providers, determines which parser handles payloads

---

## Provider Parsers

### Normalized Output Format

Every parser produces:

```python
@dataclass
class NormalizedUplink:
    dev_eui: str
    metrics: dict[str, Any]           # {"temperature": 25.5, "humidity": 60}
    radio: dict[str, Any] | None      # {"rssi": -95, "snr": 7.5, ...}
    dedup_id: str                     # provider-unique deduplication ID
    raw_payload: str | None           # base64 raw bytes (for debugging)
```

### Provider Field Mapping

| Field | ChirpStack v4 | TTN v3 | Helium | Actility |
|---|---|---|---|---|
| dev_eui | `deviceInfo.devEui` | `end_device_ids.dev_eui` | `dev_eui` | `DevEUI_uplink.DevEUI` |
| metrics | `object` | `uplink_message.decoded_payload` | `decoded.payload` | `DevEUI_uplink.payload_hex` (needs codec) |
| rssi | `rxInfo[0].rssi` | `uplink_message.rx_metadata[0].rssi` | `hotspots[0].rssi` | `DevEUI_uplink.LrrRSSI` |
| snr | `rxInfo[0].snr` | `uplink_message.rx_metadata[0].snr` | `hotspots[0].snr` | `DevEUI_uplink.LrrSNR` |
| gateway | `rxInfo[0].gatewayId` | `uplink_message.rx_metadata[0].gateway_ids.gateway_id` | `hotspots[0].name` | `DevEUI_uplink.Lrrid` |
| dedup_id | `deduplicationId` | `correlation_ids[0]` | `id` | `DevEUI_uplink.FCntUp` + dev_eui |
| frame_count | `fCnt` | `uplink_message.f_cnt` | `fcnt` | `DevEUI_uplink.FCntUp` |

### Parser Functions

```python
def parse_chirpstack(body: dict) -> NormalizedUplink | None
def parse_ttn(body: dict) -> NormalizedUplink | None
def parse_helium(body: dict) -> NormalizedUplink | None
def parse_actility(body: dict) -> NormalizedUplink | None
def parse_custom(body: dict) -> NormalizedUplink | None
```

The `custom` parser is the escape hatch — accepts `{"dev_eui": "...", "metrics": {...}}` directly for any LNS without a named parser.

---

## Webhook Ingestion Endpoint

### `POST /api/v1/ingest/lorawan/{provider}`

**Request:**
```
Authorization: Bearer gito_ik_a3b2c4d5e6f7g8h9i0j1k2l3m4n5o6p7
Content-Type: application/json

{ ...provider-specific JSON... }
```

**Processing Flow:**
1. Hash key → look up integration (bypass RLS via SECURITY DEFINER function)
2. Validate: integration exists, `is_active`, provider matches URL
3. Select parser by provider → parse payload → `NormalizedUplink`
4. Resolve `dev_eui` → `(tenant_id, device_id)` from devices table
5. Reject unknown dev_eui with 404: `"Device with dev_eui '...' not found. Register it in Gito first."`
6. Deduplicate using `dedup_id` (30s TTL in Redis)
7. Apply device type `key_mapping` (raw keys → canonical)
8. Store telemetry rows (one per metric)
9. Store radio metadata as `__lora_*` prefixed metrics
10. Update device `last_seen`, `status = 'online'`
11. Publish to Redis (WebSocket + digital twin)
12. Increment `integration.message_count`, update `last_used_at`
13. Return 201

**Response Codes:**
- `201` — ingested successfully
- `400` — unparseable payload (with provider-specific error hint)
- `401` — invalid/missing integration key
- `404` — unknown dev_eui
- `429` — rate limited

**Rate Limiting:** Per-integration, 600 msgs/min default (configurable in `config` JSONB).

**Deduplication:** Provider's `dedup_id` with 30s TTL in Redis. Guards against webhook retries on timeout.

**No auto-registration of unknown devices** — security risk, and user needs to assign device type, site, etc.

---

## Integration Management API

### Endpoints

```
POST   /tenants/{tenant_id}/integrations              — Create integration
GET    /tenants/{tenant_id}/integrations              — List integrations
GET    /tenants/{tenant_id}/integrations/{id}         — Get details + setup instructions
PUT    /tenants/{tenant_id}/integrations/{id}         — Update (name, config, is_active)
DELETE /tenants/{tenant_id}/integrations/{id}         — Revoke & delete
POST   /tenants/{tenant_id}/integrations/{id}/rotate-key — Generate new key, invalidate old
```

### Create Response (raw key shown once only)

```json
{
    "id": "uuid",
    "name": "My TTN Integration",
    "provider": "ttn",
    "key": "gito_ik_a3b2c4d5e6f7g8h9i0j1k2l3m4n5o6p7",
    "key_prefix": "gito_ik_a3b2",
    "webhook_url": "https://iot.gito.co.za/api/v1/ingest/lorawan/ttn",
    "setup_instructions": {
        "steps": [
            "Go to TTN Console → Applications → Your App → Integrations → Webhooks",
            "Click 'Add webhook' → Choose 'Custom webhook'",
            "Webhook URL: https://iot.gito.co.za/api/v1/ingest/lorawan/ttn",
            "Authorization: Bearer gito_ik_a3b2c4d5e6f7...",
            "Enable 'Uplink message' events",
            "Save"
        ],
        "provider_docs_url": "https://www.thethingsindustries.com/docs/integrations/webhooks/"
    }
}
```

- Raw key shown only on create and rotate — never retrievable again
- Setup instructions are provider-specific
- `rotate-key` generates new key, returns it, invalidates old

### List Response

```json
{
    "data": [
        {
            "id": "uuid",
            "name": "My TTN Integration",
            "provider": "ttn",
            "key_prefix": "gito_ik_a3b2",
            "is_active": true,
            "last_used_at": "2026-03-26T10:00:00Z",
            "message_count": 12847,
            "created_at": "2026-03-20T08:00:00Z"
        }
    ]
}
```

---

## Files Involved

| File | Action |
|---|---|
| `api/alembic/versions/015_integrations.py` | New — migration for `integrations` table |
| `api/app/models/base.py` | Add `Integration` model |
| `api/app/schemas/integration.py` | New — Pydantic schemas |
| `api/app/routers/integrations.py` | New — CRUD management endpoints |
| `api/app/routers/lorawan_ingest.py` | New — webhook ingestion endpoint |
| `api/app/services/lorawan_parsers.py` | New — provider parser functions |
| `api/app/main.py` | Register 2 new routers |

**No changes to:**
- `processor/mqtt_processor.py` — MQTT path is independent
- `device_management.py` — ChirpStack sync unchanged
- `device_ingest.py` — token ingest unchanged
- Docker/infrastructure — no new services

---

## Security Considerations

- Integration keys are hashed (SHA256) before storage — raw key never persisted
- Key lookup uses SECURITY DEFINER function to bypass RLS (same pattern as device tokens)
- Provider in URL must match provider on integration record — prevents key reuse across providers
- Unknown dev_eui rejected (no auto-registration)
- Rate limiting per integration prevents abuse
- Deduplication prevents duplicate processing from webhook retries