# ChirpStack MQTT Bridge — Design Spec

**Date:** 2026-04-12
**Status:** Approved
**Goal:** Allow tenants to ingest LoRaWAN uplinks by subscribing to a ChirpStack v4 MQTT broker — for deployments where ChirpStack cannot reach Gito (no inbound webhooks).

---

## Context

Gito already supports ChirpStack via inbound HTTP webhooks (`provider: chirpstack`). This requires ChirpStack to reach Gito's API endpoint. In many local/private deployments the network topology is one-way: Gito can reach ChirpStack, but ChirpStack cannot reach Gito.

The industry standard for this scenario (used by ThingsBoard, Cumulocity, Node-RED) is an **outbound MQTT bridge** — the platform subscribes to ChirpStack's built-in MQTT broker and receives uplinks in real time.

Both webhook and MQTT bridge must coexist. They are independent integration types. A tenant can use either or both.

---

## Architecture

```
Existing (inbound webhook):
  ChirpStack ──HTTP POST──▶ Gito API (lorawan_ingest router)

New (outbound MQTT bridge):
  Gito Processor ──MQTT subscribe──▶ ChirpStack MQTT broker
       │
       ▼
  _process_chirpstack_uplink()  ← existing parser, no changes
       │
       ▼
  Telemetry pipeline (KeyDB Stream → batch insert → TimescaleDB)
```

Three components change:

1. **Database** — migration makes `key_hash`/`key_prefix` nullable, adds `chirpstack_mqtt` provider
2. **Processor** — new `ChirpStackBridgeManager` manages outbound MQTT connections dynamically
3. **API + Frontend** — new provider type in Connections page with MQTT-specific form and status indicators

---

## Database — Migration 017

### Schema changes

```sql
-- Make key columns nullable (MQTT bridges have no bearer key)
ALTER TABLE integrations ALTER COLUMN key_hash DROP NOT NULL;
ALTER TABLE integrations ALTER COLUMN key_prefix DROP NOT NULL;

-- Replace unique index with partial index (only enforce when key_hash is set)
DROP INDEX IF EXISTS idx_integrations_key_hash;
CREATE UNIQUE INDEX idx_integrations_key_hash
    ON integrations (key_hash) WHERE key_hash IS NOT NULL;

-- Extend valid_provider constraint
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS valid_provider;
ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
    provider IN (
        'chirpstack', 'ttn', 'helium', 'actility', 'custom',
        'mqtt', 'http', 'chirpstack_mqtt'
    )
);
```

### Config JSONB schema for `chirpstack_mqtt`

```json
{
  "broker_url": "10.0.0.5",
  "port": 1883,
  "username": "admin",
  "password": "secret",
  "tls": false,
  "ca_cert": null
}
```

`broker_url` is required. All other fields are optional with sensible defaults.

---

## Processor — ChirpStackBridgeManager

### Reconciliation pattern

The manager uses a Kubernetes-style declarative reconciliation loop. The database is desired state, running workers are current state:

```
Desired state: SELECT * FROM integrations
               WHERE provider = 'chirpstack_mqtt' AND is_active = true

Current state: dict of running BridgeWorker asyncio tasks

Sync logic:
  new in DB, not running       → start worker
  in DB, running, config same  → leave alone
  in DB, running, config diff  → restart worker (stop + start)
  not in DB, still running     → stop worker
```

### Trigger mechanisms

1. **Redis pub/sub** — channel `integration:changes`. The API publishes `{"action": "created|updated|deleted", "integration_id": "..."}` on every mutation. The manager listens and triggers an immediate sync.
2. **Periodic sync** — every 60 seconds as a safety net (catches missed pub/sub messages, startup recovery).

### BridgeWorker lifecycle

Each worker is a single asyncio task managing one outbound MQTT connection:

```
Connect to ChirpStack MQTT (QoS 1, optional TLS)
  → Subscribe to application/+/device/+/event/up
  → Set Redis key bridge:status:{integration_id} = "connected"

Message loop:
  → Parse topic: extract dev_eui from application/{appId}/device/{devEui}/event/up
  → Call _process_chirpstack_uplink(dev_eui, payload)
      (existing method — handles parsing, dedup, rate limit, telemetry insert)
  → Increment message_count + last_used_at on integration row (batched, not per-message)

On disconnect/error:
  → Set Redis key bridge:status:{integration_id} = "error:<reason>"
  → Reconnect with exponential backoff: 1s → 2s → 4s → 8s → ... → max 60s
  → Set status to "reconnecting" during backoff

On cancellation (integration disabled/deleted):
  → Disconnect cleanly
  → Delete Redis key bridge:status:{integration_id}
```

### Multi-instance safety

Redis distributed lock per integration prevents duplicate bridges when multiple processor instances run:

```
Key:   bridge:lock:{integration_id}
TTL:   90 seconds
Renew: every 30 seconds by the owning worker
```

Only the instance holding the lock runs that bridge. If the holder crashes, the lock expires and another instance claims it on next sync.

### Process entrypoint

```python
asyncio.gather(
    mqtt_processor.run(),        # existing — local Mosquitto
    bridge_manager.run(),        # new — outbound ChirpStack MQTT bridges
)
```

Completely independent. The local Mosquitto path is untouched.

### message_count batching

To avoid per-message DB writes, the worker accumulates a count in memory and flushes to the DB every 30 seconds:

```sql
UPDATE integrations
SET message_count = message_count + :batch_count,
    last_used_at = now()
WHERE id = :integration_id;
```

---

## API Changes

### Provider-aware create endpoint

The existing `POST /tenants/{tenant_id}/integrations` becomes provider-aware:

- **Webhook providers** (`chirpstack`, `ttn`, `helium`, `actility`, `custom`, `mqtt`, `http`): existing flow — generate bearer key, return webhook URL + setup instructions.
- **`chirpstack_mqtt`**: no bearer key generated. Validate MQTT config fields. Publish `integration:changes` to Redis. Return broker URL + bridge status.

### Redis notification on mutations

All create/update/delete operations on integrations publish to Redis:

```python
await redis.publish("integration:changes", json.dumps({
    "action": "created",  # or "updated" or "deleted"
    "integration_id": str(integration.id),
}))
```

### Credential masking in GET responses

Password and CA cert are never returned in API responses:

```python
def _mask_config(config: dict, provider: str) -> dict:
    if provider == "chirpstack_mqtt":
        masked = dict(config)
        if "password" in masked:
            masked["password"] = "••••••••"
        if "ca_cert" in masked:
            masked["ca_cert"] = "(set)"
        return masked
    return config
```

### Bridge status in GET responses

The GET endpoint reads `bridge:status:{integration_id}` from Redis and includes it:

```json
{
  "id": "uuid",
  "provider": "chirpstack_mqtt",
  "is_active": true,
  "bridge_status": "connected",
  "config": {
    "broker_url": "10.0.0.5",
    "port": 1883,
    "username": "admin",
    "password": "••••••••",
    "tls": false
  },
  "last_used_at": "2026-04-12T10:30:00Z",
  "message_count": 1482
}
```

States: `pending`, `connected`, `reconnecting`, `error: <message>`.

### New Pydantic schemas

```python
class MqttConfigValidator(BaseModel):
    broker_url: str = Field(min_length=1)
    port: int = Field(default=1883, ge=1, le=65535)
    username: Optional[str] = None
    password: Optional[str] = None
    tls: bool = False
    ca_cert: Optional[str] = None

class MqttIntegrationCreatedResponse(BaseModel):
    id: UUID
    name: str
    provider: ProviderEnum
    broker_url: str
    port: int
    bridge_status: str
    created_at: datetime
```

---

## Frontend — Connections Page

### Provider picker

New card added to the provider grid:

| Provider | Icon | Label | Description |
|---|---|---|---|
| `chirpstack` (existing) | Radio | ChirpStack Webhook | ChirpStack sends uplinks to Gito (inbound) |
| `chirpstack_mqtt` (new) | Server | ChirpStack MQTT | Subscribe to ChirpStack's MQTT broker (outbound) |

### Form fields for `chirpstack_mqtt`

```
Connection name        [My ChirpStack        ]
Broker address         [10.0.0.5             ]
Port                   [1883                 ]
Username (optional)    [                     ]
Password (optional)    [                     ]
☐ Use TLS

                 [Back]  [Create connection]
```

### Success screen

No bearer key or webhook URL. Instead:

```
✅ Bridge created — connecting to ChirpStack MQTT...

Broker:   10.0.0.5:1883
Status:   ● Pending (connecting...)

Make sure your devices are registered in Gito with matching
dev_eui values. Uplinks will flow automatically once the
bridge connects.

                                    [Done]
```

### Connection card — live status

MQTT bridge cards show a status indicator dot:

- **Green** `● Connected` — bridge is active, receiving messages
- **Yellow** `● Reconnecting` — temporarily disconnected, retrying
- **Red** `● Error: connection refused` — shows error detail
- **Grey** `● Pending` — just created, processor hasn't picked up yet

Status reads from `bridge_status` in the API response. The card auto-refreshes every 10 seconds while visible to reflect connection changes.

### Existing webhook cards

Unchanged. Webhook integrations continue to show webhook URL, bearer key prefix, and setup instructions exactly as before.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Invalid broker_url on create | API validates with `MqttConfigValidator`, returns 422 |
| ChirpStack MQTT unreachable | Worker retries with exponential backoff, status = `reconnecting` |
| ChirpStack MQTT auth failure | Worker sets status = `error: authentication failed (retries exhausted)`, stops retrying after 5 consecutive auth failures. User must fix credentials and re-enable. |
| dev_eui not found in Gito | Logged as warning (same as existing `_process_chirpstack_uplink` behaviour) |
| Duplicate uplink | Deduplicated via ChirpStack's `deduplicationId` (existing logic) |
| Processor crash/restart | Manager reloads all active integrations on startup, reconnects |
| Integration disabled via UI | API publishes change, manager stops worker within seconds |
| Credentials updated via UI | Manager detects config drift on next sync, restarts worker with new credentials |

---

## What does NOT change

- `lorawan_ingest.py` router (HTTP webhook ingestion) — untouched
- `_process_chirpstack_uplink()` method — untouched (both webhook and MQTT feed into it)
- Local Mosquitto connection in processor — untouched
- Existing webhook provider types — untouched
- Database telemetry pipeline — untouched

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `api/alembic/versions/017_chirpstack_mqtt.py` | Create | Nullable key columns, add chirpstack_mqtt provider |
| `api/app/schemas/integration.py` | Modify | Add chirpstack_mqtt to ProviderEnum, MqttConfigValidator, MqttIntegrationCreatedResponse |
| `api/app/models/base.py` | Modify | Update CheckConstraint to include chirpstack_mqtt |
| `api/app/routers/integrations.py` | Modify | Provider-aware create, credential masking, bridge_status from Redis, Redis pub/sub on mutations |
| `processor/mqtt_processor.py` | Modify | Add ChirpStackBridgeManager + BridgeWorker, launch in main() |
| `web/src/app/dashboard/connections/page.tsx` | Modify | Add chirpstack_mqtt provider card, MQTT form, status indicator, success screen |
