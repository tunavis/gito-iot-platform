# ChirpStack MQTT Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `chirpstack_mqtt` as an outbound MQTT bridge integration type so Gito can subscribe to a ChirpStack v4 MQTT broker and ingest uplinks without ChirpStack needing to reach Gito.

**Architecture:** A new `ChirpStackBridgeManager` in the processor maintains one outbound `aiomqtt` connection per active `chirpstack_mqtt` integration, reconciling against the DB every 60s and on Redis pub/sub `integration:changes` events. The existing `_process_chirpstack_uplink()` parser is reused unchanged. The API becomes provider-aware: `chirpstack_mqtt` creates no bearer key and returns broker info instead.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), aiomqtt + asyncio (processor), Next.js 14 + React + Tailwind (frontend), Redis for pub/sub and bridge status, pytest (tests)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `api/alembic/versions/017_chirpstack_mqtt.py` | Create | Nullable key columns, partial unique index, add chirpstack_mqtt provider |
| `api/app/models/base.py` | Modify | Make `key_hash`/`key_prefix` nullable, update CheckConstraint |
| `api/app/schemas/integration.py` | Modify | Add `chirpstack_mqtt` to ProviderEnum, add `MqttConfigValidator`, `MqttIntegrationCreatedResponse`, update `IntegrationResponse` |
| `api/app/routers/integrations.py` | Modify | Provider-aware create, credential masking, `bridge_status` from Redis, Redis pub/sub on mutations |
| `processor/mqtt_processor.py` | Modify | Add `ChirpStackBridgeWorker`, `ChirpStackBridgeManager`, update `main()` |
| `web/src/app/dashboard/connections/page.tsx` | Modify | Add `chirpstack_mqtt` provider card, MQTT form, status indicators, auto-refresh |

---

## Task 1: DB Migration 017

**Files:**
- Create: `api/alembic/versions/017_chirpstack_mqtt.py`

- [ ] **Step 1: Create the migration file**

```python
# api/alembic/versions/017_chirpstack_mqtt.py
"""Add chirpstack_mqtt provider — nullable key columns, partial unique index.

Revision ID: 017_chirpstack_mqtt
Revises: 016_extend_providers
Create Date: 2026-04-13
"""
from typing import Sequence, Union
from alembic import op

revision: str = "017_chirpstack_mqtt"
down_revision: Union[str, None] = "016_extend_providers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make key columns nullable — MQTT bridge integrations have no bearer key
    op.execute("""
        ALTER TABLE integrations ALTER COLUMN key_hash DROP NOT NULL;
    """)
    op.execute("""
        ALTER TABLE integrations ALTER COLUMN key_prefix DROP NOT NULL;
    """)

    # Replace simple unique index with partial index (only enforce when key_hash present)
    op.execute("""
        DROP INDEX IF EXISTS idx_integrations_key_hash;
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_key_hash
            ON integrations (key_hash) WHERE key_hash IS NOT NULL;
    """)

    # Extend valid_provider constraint to include chirpstack_mqtt
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE table_name = 'integrations' AND constraint_name = 'valid_provider'
            ) THEN
                ALTER TABLE integrations DROP CONSTRAINT valid_provider;
            END IF;
        END $$;
    """)
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN (
                'chirpstack', 'ttn', 'helium', 'actility', 'custom',
                'mqtt', 'http', 'chirpstack_mqtt'
            )
        );
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE integrations DROP CONSTRAINT IF EXISTS valid_provider;")
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http')
        );
    """)
    op.execute("DROP INDEX IF EXISTS idx_integrations_key_hash;")
    op.execute("""
        CREATE UNIQUE INDEX idx_integrations_key_hash ON integrations (key_hash);
    """)
    op.execute("ALTER TABLE integrations ALTER COLUMN key_hash SET NOT NULL;")
    op.execute("ALTER TABLE integrations ALTER COLUMN key_prefix SET NOT NULL;")
```

- [ ] **Step 2: Apply the migration**

```bash
docker exec gito-api alembic upgrade head
```

Expected output:
```
Running upgrade 016_extend_providers -> 017_chirpstack_mqtt, Add chirpstack_mqtt provider...
```

- [ ] **Step 3: Verify schema**

```bash
docker exec gito-postgres psql -U gito -d gito -c "\d integrations" | grep -E "key_hash|key_prefix"
```

Expected: both columns show no `not null` constraint.

- [ ] **Step 4: Commit**

```bash
git add api/alembic/versions/017_chirpstack_mqtt.py
git commit -m "feat: migration 017 — nullable key columns and chirpstack_mqtt provider"
```

---

## Task 2: Update SQLAlchemy Model

**Files:**
- Modify: `api/app/models/base.py`

- [ ] **Step 1: Make key columns nullable and update CheckConstraint**

In `api/app/models/base.py`, find the `Integration` class (around line 400) and replace:

```python
    key_hash = Column(String(64), nullable=False, unique=True)
    key_prefix = Column(String(12), nullable=False)
```

with:

```python
    key_hash = Column(String(64), nullable=True, unique=False)  # partial unique enforced by DB index
    key_prefix = Column(String(12), nullable=True)
```

And replace the `__table_args__` tuple:

```python
    __table_args__ = (
        Index("idx_integrations_tenant", "tenant_id"),
        CheckConstraint(
            "provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http')",
            name="valid_provider",
        ),
    )
```

with:

```python
    __table_args__ = (
        Index("idx_integrations_tenant", "tenant_id"),
        CheckConstraint(
            "provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http', 'chirpstack_mqtt')",
            name="valid_provider",
        ),
    )
```

- [ ] **Step 2: Commit**

```bash
git add api/app/models/base.py
git commit -m "feat: make integration key columns nullable, add chirpstack_mqtt to model constraint"
```

---

## Task 3: Update Pydantic Schemas

**Files:**
- Modify: `api/app/schemas/integration.py`

- [ ] **Step 1: Add chirpstack_mqtt to ProviderEnum and PROVIDER_DOCS**

Replace the `ProviderEnum` class:

```python
class ProviderEnum(str, Enum):
    chirpstack = "chirpstack"
    ttn = "ttn"
    helium = "helium"
    actility = "actility"
    mqtt = "mqtt"
    http = "http"
    custom = "custom"
    chirpstack_mqtt = "chirpstack_mqtt"
```

Add to `PROVIDER_DOCS` dict (after the `"custom"` entry):

```python
    "chirpstack_mqtt": {
        "name": "ChirpStack MQTT",
        "docs_url": "https://www.chirpstack.io/docs/chirpstack/integrations/mqtt.html",
        "steps": [],  # No setup steps — Gito connects outbound
    },
```

- [ ] **Step 2: Add MqttConfigValidator**

After the `IntegrationCreate` class, add:

```python
class MqttConfigValidator(BaseModel):
    """Validates config for chirpstack_mqtt integrations."""
    broker_url: str = Field(min_length=1, description="ChirpStack MQTT broker hostname or IP")
    port: int = Field(default=1883, ge=1, le=65535)
    username: Optional[str] = None
    password: Optional[str] = None
    tls: bool = False
    ca_cert: Optional[str] = None
```

- [ ] **Step 3: Add MqttIntegrationCreatedResponse**

After `IntegrationCreatedResponse`, add:

```python
class MqttIntegrationCreatedResponse(BaseModel):
    """Returned on create of a chirpstack_mqtt integration."""
    id: UUID
    name: str
    provider: ProviderEnum
    broker_url: str
    port: int
    bridge_status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 4: Update IntegrationResponse — make key_prefix optional, add bridge_status**

Replace the `IntegrationResponse` class:

```python
class IntegrationResponse(BaseModel):
    """Safe response — never includes the raw key."""
    id: UUID
    tenant_id: UUID
    name: str
    provider: ProviderEnum
    key_prefix: Optional[str] = None
    config: dict[str, Any]
    is_active: bool
    last_used_at: Optional[datetime] = None
    message_count: int
    created_at: datetime
    updated_at: datetime
    bridge_status: Optional[str] = None  # set for chirpstack_mqtt integrations

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 5: Commit**

```bash
git add api/app/schemas/integration.py
git commit -m "feat: add chirpstack_mqtt to schemas — MqttConfigValidator, MqttIntegrationCreatedResponse"
```

---

## Task 4: Update Integrations Router

**Files:**
- Modify: `api/app/routers/integrations.py`

- [ ] **Step 1: Update imports**

Replace the existing imports block at the top of `api/app/routers/integrations.py`:

```python
import hashlib
import json
import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.database import get_session, RLSSession
from app.dependencies import get_current_user
from app.models.base import Integration
from app.schemas.common import SuccessResponse
from app.schemas.integration import (
    IntegrationCreate,
    IntegrationCreatedResponse,
    IntegrationResponse,
    IntegrationUpdate,
    MqttConfigValidator,
    MqttIntegrationCreatedResponse,
    ProviderEnum,
    build_setup_instructions,
)
from app.config import get_settings
```

- [ ] **Step 2: Add credential masking helper and Redis publish helper**

After the `_connection_endpoint` function, add:

```python
def _mask_config(config: dict, provider: str) -> dict:
    """Strip sensitive fields from MQTT bridge config before returning."""
    if provider == "chirpstack_mqtt":
        masked = dict(config)
        if "password" in masked:
            masked["password"] = "••••••••"
        if "ca_cert" in masked and masked["ca_cert"]:
            masked["ca_cert"] = "(set)"
        return masked
    return config


async def _notify_bridge_manager(request: Request, action: str, integration_id: str) -> None:
    """Publish integration change to Redis so the processor reconciles immediately."""
    redis = getattr(request.app.state, "redis", None)
    if redis:
        try:
            await redis.publish(
                "integration:changes",
                json.dumps({"action": action, "integration_id": integration_id}),
            )
        except Exception as e:
            logger.warning("Failed to publish integration change to Redis: %s", e)


async def _get_bridge_status(request: Request, integration_id: str) -> str:
    """Read live bridge connection status from Redis."""
    redis = getattr(request.app.state, "redis", None)
    if not redis:
        return "pending"
    try:
        val = await redis.get(f"bridge:status:{integration_id}")
        return val.decode() if val else "pending"
    except Exception:
        return "pending"
```

- [ ] **Step 3: Replace the create endpoint with provider-aware version**

Replace the entire `create_integration` function:

```python
@router.post("", status_code=status.HTTP_201_CREATED)
async def create_integration(
    tenant_id: UUID,
    body: IntegrationCreate,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Create a new integration. MQTT bridge integrations return broker info; webhook integrations return a bearer key."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    if body.provider == ProviderEnum.chirpstack_mqtt:
        # Validate MQTT config — broker_url required
        mqtt_conf = MqttConfigValidator(**body.config)

        integration = Integration(
            tenant_id=tenant_id,
            name=body.name,
            provider=body.provider.value,
            key_hash=None,
            key_prefix=None,
            config=body.config,
            created_by=current_user_id,
        )
        session.add(integration)
        await session.commit()
        await session.refresh(integration)

        await _notify_bridge_manager(request, "created", str(integration.id))

        return MqttIntegrationCreatedResponse(
            id=integration.id,
            name=integration.name,
            provider=integration.provider,
            broker_url=mqtt_conf.broker_url,
            port=mqtt_conf.port,
            bridge_status="pending",
            created_at=integration.created_at,
        )

    # Webhook path — existing behaviour unchanged
    raw_key, key_hash, key_prefix = _generate_key()

    integration = Integration(
        tenant_id=tenant_id,
        name=body.name,
        provider=body.provider.value,
        key_hash=key_hash,
        key_prefix=key_prefix,
        config=body.config,
        created_by=current_user_id,
    )
    session.add(integration)
    await session.commit()
    await session.refresh(integration)

    webhook_url = _connection_endpoint(body.provider.value)
    instructions = build_setup_instructions(body.provider.value, webhook_url, key_prefix)

    return IntegrationCreatedResponse(
        id=integration.id,
        name=integration.name,
        provider=integration.provider,
        key=raw_key,
        key_prefix=key_prefix,
        webhook_url=webhook_url,
        setup_instructions=instructions,
        created_at=integration.created_at,
    )
```

- [ ] **Step 4: Update list_integrations — mask credentials and add bridge_status**

Replace the `list_integrations` function:

```python
@router.get("", response_model=SuccessResponse)
async def list_integrations(
    tenant_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """List all integrations for the tenant."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration)
        .where(Integration.tenant_id == tenant_id)
        .order_by(Integration.created_at.desc())
    )
    integrations = result.scalars().all()

    # Batch-fetch bridge statuses for all chirpstack_mqtt integrations
    mqtt_ids = [str(i.id) for i in integrations if i.provider == "chirpstack_mqtt"]
    bridge_statuses: dict[str, str] = {}
    if mqtt_ids:
        redis = getattr(request.app.state, "redis", None)
        if redis:
            try:
                keys = [f"bridge:status:{iid}" for iid in mqtt_ids]
                vals = await redis.mget(*keys)
                for iid, val in zip(mqtt_ids, vals):
                    bridge_statuses[iid] = val.decode() if val else "pending"
            except Exception as e:
                logger.warning("Failed to fetch bridge statuses: %s", e)

    items = []
    for i in integrations:
        row = IntegrationResponse.model_validate(i, from_attributes=True)
        row.config = _mask_config(dict(row.config), i.provider)
        if i.provider == "chirpstack_mqtt":
            row.bridge_status = bridge_statuses.get(str(i.id), "pending")
        items.append(row)

    return SuccessResponse(data=items)
```

- [ ] **Step 5: Update get_integration — mask credentials and bridge_status**

Replace the `get_integration` function:

```python
@router.get("/{integration_id}", response_model=SuccessResponse)
async def get_integration(
    tenant_id: UUID,
    integration_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Get a single integration. Webhook integrations include setup instructions."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    response_data = IntegrationResponse.model_validate(integration, from_attributes=True).model_dump()
    response_data["config"] = _mask_config(dict(response_data["config"]), integration.provider)

    if integration.provider == "chirpstack_mqtt":
        response_data["bridge_status"] = await _get_bridge_status(request, str(integration_id))
    else:
        webhook_url = _connection_endpoint(integration.provider)
        instructions = build_setup_instructions(
            integration.provider, webhook_url, integration.key_prefix or ""
        )
        response_data["webhook_url"] = webhook_url
        response_data["setup_instructions"] = instructions.model_dump()

    return SuccessResponse(data=response_data)
```

- [ ] **Step 6: Update update_integration — notify Redis on change**

Replace the entire `update_integration` function:

```python
@router.put("/{integration_id}", response_model=SuccessResponse)
async def update_integration(
    tenant_id: UUID,
    integration_id: UUID,
    body: IntegrationUpdate,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Update name, config, or is_active on an integration."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    if body.name is not None:
        integration.name = body.name
    if body.config is not None:
        integration.config = body.config
    if body.is_active is not None:
        integration.is_active = body.is_active

    integration.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(integration)

    if integration.provider == "chirpstack_mqtt":
        await _notify_bridge_manager(request, "updated", str(integration_id))

    row = IntegrationResponse.model_validate(integration, from_attributes=True)
    row.config = _mask_config(dict(row.config), integration.provider)
    return SuccessResponse(data=row)
```

- [ ] **Step 7: Update delete_integration — notify Redis on delete**

Replace the `delete_integration` function:

```python
@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    tenant_id: UUID,
    integration_id: UUID,
    request: Request,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Delete an integration and revoke its key."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    provider = integration.provider
    await session.delete(integration)
    await session.commit()

    if provider == "chirpstack_mqtt":
        await _notify_bridge_manager(request, "deleted", str(integration_id))
```

- [ ] **Step 8: Update rotate_key — block for MQTT bridges**

At the start of `rotate_key`, after `_validate_tenant`, add a guard:

```python
    result = await session.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.tenant_id == tenant_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    if integration.provider == "chirpstack_mqtt":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MQTT bridge integrations do not use bearer keys",
        )
```

Then continue with the existing key rotation logic (no further changes needed).

- [ ] **Step 9: Commit**

```bash
git add api/app/routers/integrations.py
git commit -m "feat: provider-aware integration router — chirpstack_mqtt create path, credential masking, Redis pub/sub"
```

---

## Task 5: Processor — ChirpStackBridgeManager

**Files:**
- Modify: `processor/mqtt_processor.py`

- [ ] **Step 1: Add bridge config constants near top of file (after existing env vars)**

After the `RATE_LIMIT_PER_MINUTE` line (around line 75), add:

```python
# ChirpStack MQTT Bridge config
BRIDGE_SYNC_INTERVAL_S  = 60    # seconds between periodic DB syncs
BRIDGE_LOCK_TTL_S       = 90    # Redis lock TTL — lost if process crashes
BRIDGE_LOCK_RENEW_S     = 30    # renew lock every N seconds
BRIDGE_BACKOFF_BASE_S   = 1.0   # initial reconnect backoff
BRIDGE_BACKOFF_MAX_S    = 60.0  # max reconnect backoff
BRIDGE_AUTH_FAIL_MAX    = 5     # stop retrying after N consecutive auth failures
BRIDGE_COUNT_FLUSH_S    = 30    # flush message_count to DB every N seconds
```

- [ ] **Step 2: Add BridgeWorker class before the MQTTProcessor class**

Insert the following class just before the `class MQTTProcessor:` line (around line 855):

```python
# ---------------------------------------------------------------------------
# ChirpStack MQTT Bridge — outbound connection per tenant integration
# ---------------------------------------------------------------------------

class BridgeWorker:
    """
    Manages one outbound MQTT connection to a tenant's ChirpStack broker.

    Lifecycle: started by ChirpStackBridgeManager, cancelled when the
    integration is deleted/disabled or config changes.
    """

    def __init__(
        self,
        integration_id: str,
        config: dict,
        db_service: "DatabaseService",
        redis_service: "RedisService",
        process_uplink_fn,  # bound method: MQTTProcessor._process_chirpstack_uplink
    ):
        self.integration_id = integration_id
        self.config = config
        self.db_service = db_service
        self.redis_service = redis_service
        self._process_uplink = process_uplink_fn
        self._pending_count = 0
        self._last_flush = time.monotonic()

    async def run(self) -> None:
        """Run with exponential backoff reconnection. Stops after too many auth failures."""
        redis = self.redis_service.redis
        lock_key = f"bridge:lock:{self.integration_id}"
        status_key = f"bridge:status:{self.integration_id}"
        auth_failures = 0
        backoff = BRIDGE_BACKOFF_BASE_S

        while True:
            # Acquire distributed lock — skip if another instance holds it
            acquired = await redis.set(lock_key, "1", nx=True, ex=BRIDGE_LOCK_TTL_S)
            if not acquired:
                logger.info("Bridge lock held by another instance for %s — skipping", self.integration_id)
                await asyncio.sleep(BRIDGE_SYNC_INTERVAL_S)
                continue

            try:
                await self._run_connection(redis, lock_key, status_key)
                auth_failures = 0
                backoff = BRIDGE_BACKOFF_BASE_S
            except aiomqtt.MqttError as e:
                err_str = str(e)
                if "not authorised" in err_str.lower() or "unauthorized" in err_str.lower() or "authentication" in err_str.lower():
                    auth_failures += 1
                    logger.error(
                        "ChirpStack bridge auth failure %d/%d for integration %s: %s",
                        auth_failures, BRIDGE_AUTH_FAIL_MAX, self.integration_id, e,
                    )
                    if auth_failures >= BRIDGE_AUTH_FAIL_MAX:
                        await redis.set(status_key, "error: authentication failed (retries exhausted)", ex=3600)
                        logger.error(
                            "ChirpStack bridge %s stopped — too many auth failures. Fix credentials and re-enable.",
                            self.integration_id,
                        )
                        return
                else:
                    logger.warning("ChirpStack bridge %s disconnected: %s — retrying in %.0fs", self.integration_id, e, backoff)
            except asyncio.CancelledError:
                logger.info("ChirpStack bridge %s cancelled — disconnecting", self.integration_id)
                await redis.delete(status_key)
                raise
            except Exception as e:
                logger.error("ChirpStack bridge %s unexpected error: %s", self.integration_id, e, exc_info=True)

            await redis.set(status_key, f"reconnecting", ex=BRIDGE_LOCK_TTL_S)
            await redis.delete(lock_key)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, BRIDGE_BACKOFF_MAX_S)

    async def _run_connection(self, redis, lock_key: str, status_key: str) -> None:
        """Establish and maintain one MQTT connection."""
        cfg = self.config
        broker = cfg.get("broker_url", "")
        port = int(cfg.get("port", 1883))
        username = cfg.get("username") or None
        password = cfg.get("password") or None
        tls_params = aiomqtt.TLSParameters() if cfg.get("tls") else None

        connect_kwargs: dict = dict(hostname=broker, port=port)
        if username:
            connect_kwargs["username"] = username
        if password:
            connect_kwargs["password"] = password
        if tls_params:
            connect_kwargs["tls_params"] = tls_params

        async with aiomqtt.Client(**connect_kwargs) as client:
            await client.subscribe("application/+/device/+/event/up", qos=1)
            await redis.set(status_key, "connected", ex=BRIDGE_LOCK_TTL_S)
            logger.info(
                "ChirpStack bridge %s connected to %s:%s — subscribed to application/+/device/+/event/up",
                self.integration_id, broker, port,
            )

            # Lock renewal + count flush as concurrent tasks
            lock_renewer = asyncio.create_task(self._renew_lock_loop(redis, lock_key, status_key))
            count_flusher = asyncio.create_task(self._flush_count_loop())

            try:
                async for message in client.messages:
                    topic_parts = str(message.topic).split("/")
                    # topic: application/{appId}/device/{devEui}/event/up
                    if (
                        len(topic_parts) == 6
                        and topic_parts[0] == "application"
                        and topic_parts[2] == "device"
                        and topic_parts[4] == "event"
                        and topic_parts[5] == "up"
                    ):
                        dev_eui = topic_parts[3]
                        await self._process_uplink(dev_eui, message.payload)
                        self._pending_count += 1
            finally:
                lock_renewer.cancel()
                count_flusher.cancel()
                for t in (lock_renewer, count_flusher):
                    try:
                        await t
                    except asyncio.CancelledError:
                        pass
                await self._flush_count_to_db()

    async def _renew_lock_loop(self, redis, lock_key: str, status_key: str) -> None:
        """Renew the Redis lock and status TTL periodically."""
        while True:
            await asyncio.sleep(BRIDGE_LOCK_RENEW_S)
            await redis.expire(lock_key, BRIDGE_LOCK_TTL_S)
            await redis.expire(status_key, BRIDGE_LOCK_TTL_S)

    async def _flush_count_loop(self) -> None:
        """Periodically flush accumulated message_count to DB."""
        while True:
            await asyncio.sleep(BRIDGE_COUNT_FLUSH_S)
            await self._flush_count_to_db()

    async def _flush_count_to_db(self) -> None:
        """Write accumulated message_count + last_used_at to integrations row."""
        if self._pending_count == 0:
            return
        count = self._pending_count
        self._pending_count = 0
        try:
            async with self.db_service.pool.connection() as conn:
                await conn.execute(
                    "UPDATE integrations SET message_count = message_count + %s, last_used_at = now() WHERE id = %s",
                    (count, self.integration_id),
                )
        except Exception as e:
            logger.warning("Failed to flush bridge message_count for %s: %s", self.integration_id, e)
            self._pending_count += count  # put it back


class ChirpStackBridgeManager:
    """
    Manages all outbound ChirpStack MQTT bridge connections.

    Uses a Kubernetes-style reconciliation loop:
      - Desired state: active chirpstack_mqtt integrations in DB
      - Current state: dict of running BridgeWorker tasks
      - Sync: start new, stop removed, restart config-changed workers

    Triggered by:
      1. Redis pub/sub 'integration:changes' channel (immediate)
      2. Periodic sync every BRIDGE_SYNC_INTERVAL_S (safety net)
    """

    def __init__(self, db_service: "DatabaseService", redis_service: "RedisService", process_uplink_fn):
        self.db_service = db_service
        self.redis_service = redis_service
        self._process_uplink = process_uplink_fn
        self._workers: dict[str, asyncio.Task] = {}       # integration_id → Task
        self._configs: dict[str, dict] = {}               # integration_id → config snapshot

    async def run(self) -> None:
        """Main loop — listens for Redis changes and syncs periodically."""
        await asyncio.gather(
            self._listen_for_changes(),
            self._periodic_sync(),
        )

    async def _listen_for_changes(self) -> None:
        """Subscribe to Redis integration:changes and trigger sync on each message."""
        redis = self.redis_service.redis
        try:
            async with redis.pubsub() as ps:
                await ps.subscribe("integration:changes")
                logger.info("ChirpStackBridgeManager listening on integration:changes")
                async for message in ps.listen():
                    if message["type"] != "message":
                        continue
                    try:
                        payload = json.loads(message["data"])
                        logger.info("Bridge manager received change: %s", payload)
                    except Exception:
                        pass
                    await self._sync()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Bridge manager pub/sub error: %s", e, exc_info=True)

    async def _periodic_sync(self) -> None:
        """Safety-net sync every BRIDGE_SYNC_INTERVAL_S seconds."""
        while True:
            await asyncio.sleep(BRIDGE_SYNC_INTERVAL_S)
            await self._sync()

    async def _sync(self) -> None:
        """Reconcile running workers against DB desired state."""
        try:
            active = await self._load_active_integrations()
        except Exception as e:
            logger.error("Bridge manager sync failed to load integrations: %s", e)
            return

        active_map = {row["id"]: row for row in active}

        # Stop workers for integrations that are gone or disabled
        for iid in list(self._workers):
            if iid not in active_map:
                await self._stop_worker(iid)

        # Start or restart workers
        for iid, row in active_map.items():
            new_config = dict(row["config"] or {})
            if iid not in self._workers:
                await self._start_worker(iid, new_config)
            elif new_config != self._configs.get(iid):
                logger.info("Bridge config changed for %s — restarting worker", iid)
                await self._stop_worker(iid)
                await self._start_worker(iid, new_config)

    async def _load_active_integrations(self) -> list[dict]:
        """Query DB for all active chirpstack_mqtt integrations."""
        async with self.db_service.pool.connection() as conn:
            rows = await conn.execute(
                "SELECT id::text, tenant_id::text, config FROM integrations "
                "WHERE provider = 'chirpstack_mqtt' AND is_active = true"
            )
            return [dict(r) for r in await rows.fetchall()]

    async def _start_worker(self, integration_id: str, config: dict) -> None:
        worker = BridgeWorker(
            integration_id=integration_id,
            config=config,
            db_service=self.db_service,
            redis_service=self.redis_service,
            process_uplink_fn=self._process_uplink,
        )
        self._workers[integration_id] = asyncio.create_task(
            worker.run(), name=f"bridge:{integration_id}"
        )
        self._configs[integration_id] = config
        logger.info("Started ChirpStack bridge worker for integration %s", integration_id)

    async def _stop_worker(self, integration_id: str) -> None:
        task = self._workers.pop(integration_id, None)
        self._configs.pop(integration_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        logger.info("Stopped ChirpStack bridge worker for integration %s", integration_id)
```

- [ ] **Step 3: Update main() to run ChirpStackBridgeManager alongside MQTTProcessor**

Replace the entire entry point section at the bottom of the file:

```python
# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main():
    processor = MQTTProcessor()
    bridge_manager = ChirpStackBridgeManager(
        db_service=processor.db_service,
        redis_service=processor.redis_service,
        process_uplink_fn=processor._process_chirpstack_uplink,
    )

    try:
        # Start processor (connects DB, Redis, local Mosquitto)
        await processor.start()
        # Initial sync — pick up any integrations that existed before this process started
        await bridge_manager._sync()
        # Run both concurrently
        await asyncio.gather(
            processor.run_loop(),   # see Step 4
            bridge_manager.run(),
        )
    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
    finally:
        await processor.stop()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 4: Extract run_loop() from MQTTProcessor.run()**

The existing `MQTTProcessor.run()` method both starts resources AND runs the loop. Split it so `main()` can call `start()` once and then `run_loop()`:

Replace the existing `run()` method on `MQTTProcessor`:

```python
    async def run(self):
        """Convenience entry point for standalone use — starts and runs loop."""
        await self.start()
        try:
            await self.run_loop()
        finally:
            await self.stop()

    async def run_loop(self):
        """MQTT listener loop — call after start()."""
        try:
            async with aiomqtt.Client(
                MQTT_BROKER,
                port=MQTT_PORT,
                username=MQTT_USERNAME,
                password=MQTT_PASSWORD,
            ) as client:
                logger.info(f"Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}")

                await client.subscribe("+/devices/+/telemetry")
                logger.info("Subscribed to +/devices/+/telemetry")

                await client.subscribe("application/+/device/+/event/up")
                logger.info("Subscribed to application/+/device/+/event/up (ChirpStack uplinks)")

                consumer_task = asyncio.create_task(self.stream_consumer.run())
                bridge = CommandBridge(REDIS_URL, client)
                bridge_task = asyncio.create_task(bridge.run())

                try:
                    async for message in client.messages:
                        if not self.running:
                            break
                        topic_str = str(message.topic)
                        parts = topic_str.split("/")

                        if (len(parts) == 4
                                and parts[1] == "devices"
                                and parts[3] == "telemetry"):
                            await self.process_telemetry(message.topic, message.payload)

                        elif (len(parts) == 6
                              and parts[0] == "application"
                              and parts[2] == "device"
                              and parts[4] == "event"):
                            if parts[5] == "up":
                                await self._process_chirpstack_uplink(parts[3], message.payload)

                        else:
                            logger.debug("Ignoring unknown topic: %s", topic_str)

                finally:
                    consumer_task.cancel()
                    bridge_task.cancel()
                    for task in (consumer_task, bridge_task):
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass

        except Exception as e:
            logger.error(f"MQTT connection error: {e}", exc_info=True)
        finally:
            await self.stop()
```

- [ ] **Step 5: Restart processor container and check logs**

```bash
docker restart gito-processor
sleep 5
docker logs gito-processor --tail 20
```

Expected: logs show "ChirpStackBridgeManager listening on integration:changes" and "Bridge manager sync" without errors.

- [ ] **Step 6: Commit**

```bash
git add processor/mqtt_processor.py
git commit -m "feat: add ChirpStackBridgeManager and BridgeWorker for outbound MQTT bridge"
```

---

## Task 6: Frontend — Connections Page

**Files:**
- Modify: `web/src/app/dashboard/connections/page.tsx`

- [ ] **Step 1: Extend ProviderKey type and add CreatedMqttIntegration interface**

Replace the `ProviderKey` type and add the new interface after `CreatedIntegration`:

```typescript
type ProviderKey = 'chirpstack' | 'ttn' | 'helium' | 'actility' | 'mqtt' | 'http' | 'custom' | 'chirpstack_mqtt';
```

Add after the `CreatedIntegration` interface:

```typescript
interface CreatedMqttIntegration {
  id: string;
  name: string;
  provider: ProviderKey;
  broker_url: string;
  port: number;
  bridge_status: string;
  created_at: string;
}
```

Update the `Integration` interface to handle nullable `key_prefix` and add `bridge_status`:

```typescript
interface Integration {
  id: string;
  tenant_id: string;
  name: string;
  provider: ProviderKey;
  key_prefix: string | null;
  config: Record<string, string>;
  is_active: boolean;
  last_used_at: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  bridge_status?: string;
}
```

- [ ] **Step 2: Add chirpstack_mqtt to PROVIDERS map**

In the `PROVIDERS` constant, replace the existing `chirpstack` entry and add `chirpstack_mqtt`:

```typescript
const PROVIDERS: Record<ProviderKey, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  chirpstack: {
    label: 'ChirpStack Webhook',
    description: 'ChirpStack sends uplinks to Gito (inbound)',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-purple-400',
  },
  chirpstack_mqtt: {
    label: 'ChirpStack MQTT',
    description: 'Gito subscribes to ChirpStack MQTT broker (outbound)',
    icon: <Server className="w-5 h-5" />,
    color: 'text-purple-300',
  },
  ttn: {
    label: 'The Things Network',
    description: 'TTN v3 LoRaWAN network',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-blue-400',
  },
  helium: {
    label: 'Helium',
    description: 'Helium LoRaWAN network',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-emerald-400',
  },
  actility: {
    label: 'Actility ThingPark',
    description: 'Enterprise LoRaWAN platform',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-orange-400',
  },
  mqtt: {
    label: 'MQTT',
    description: 'Devices connecting via MQTT broker',
    icon: <Wifi className="w-5 h-5" />,
    color: 'text-cyan-400',
  },
  http: {
    label: 'HTTP Ingest',
    description: 'Generic HTTP device posting',
    icon: <Globe className="w-5 h-5" />,
    color: 'text-yellow-400',
  },
  custom: {
    label: 'Custom',
    description: 'Custom LNS or device protocol',
    icon: <Server className="w-5 h-5" />,
    color: 'text-slate-400',
  },
};
```

- [ ] **Step 3: Add BridgeStatusDot helper component**

Add this after the `CopyButton` component:

```typescript
// ── BridgeStatusDot ────────────────────────────────────────────────────────────

function BridgeStatusDot({ status }: { status: string }) {
  const isConnected = status === 'connected';
  const isReconnecting = status === 'reconnecting';
  const isPending = status === 'pending';

  const color = isConnected
    ? 'bg-emerald-400'
    : isReconnecting
    ? 'bg-amber-400'
    : isPending
    ? 'bg-slate-400'
    : 'bg-red-400';

  const label = isConnected
    ? 'Connected'
    : isReconnecting
    ? 'Reconnecting…'
    : isPending
    ? 'Pending'
    : status.replace('error: ', '');

  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Update ConnectionCard to show bridge status for chirpstack_mqtt**

In the `ConnectionCard` component, find the section that renders the card header (provider label + active badge). After the existing badge, add bridge status display. Find the line that renders the key_prefix (something like `{integration.key_prefix}...`) and update the card to handle null key_prefix and show bridge status:

Replace the key_prefix display section in `ConnectionCard`. Find:
```typescript
              {integration.key_prefix && (
```
and make sure this guard is already there. If showing `key_prefix` without a null check, add one.

Also add bridge status display in the card header for `chirpstack_mqtt`. Find where the provider label or active/inactive badge is shown and add after it:

```typescript
              {integration.provider === 'chirpstack_mqtt' && integration.bridge_status && (
                <BridgeStatusDot status={integration.bridge_status} />
              )}
```

- [ ] **Step 5: Add auto-refresh for MQTT bridge cards**

In the `ConnectionsPage` component, add an auto-refresh effect that polls every 10 seconds if any `chirpstack_mqtt` integration exists:

Add after the existing `useEffect`:

```typescript
  // Auto-refresh every 10s if any MQTT bridge integration is present
  useEffect(() => {
    const hasBridge = integrations.some(i => i.provider === 'chirpstack_mqtt');
    if (!hasBridge) return;
    const interval = setInterval(fetchIntegrations, 10_000);
    return () => clearInterval(interval);
  }, [integrations, fetchIntegrations]);
```

- [ ] **Step 6: Update AddConnectionModal state and handleCreate for chirpstack_mqtt**

Add state variables for MQTT fields in `AddConnectionModal`:

```typescript
  const [brokerUrl, setBrokerUrl] = useState('');
  const [brokerPort, setBrokerPort] = useState('1883');
  const [mqttUsername, setMqttUsername] = useState('');
  const [mqttPassword, setMqttPassword] = useState('');
  const [mqttTls, setMqttTls] = useState(false);
  const [createdMqtt, setCreatedMqtt] = useState<CreatedMqttIntegration | null>(null);
```

Update `handleCreate` to handle `chirpstack_mqtt`:

```typescript
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    const auth = getAuth();
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      if (provider === 'chirpstack_mqtt') {
        const config: Record<string, unknown> = {
          broker_url: brokerUrl.trim(),
          port: parseInt(brokerPort, 10) || 1883,
          tls: mqttTls,
        };
        if (mqttUsername.trim()) config.username = mqttUsername.trim();
        if (mqttPassword) config.password = mqttPassword;

        const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({ name, provider, config }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Failed to create connection');
        }
        const data: CreatedMqttIntegration = await res.json();
        setCreatedMqtt(data);
        setStep('success');
        return;
      }

      // Existing webhook path
      const config: Record<string, string> = {};
      if (provider === 'chirpstack') {
        if (serverUrl) config.server_url = serverUrl;
        if (apiKey) config.api_key = apiKey;
      }
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ name, provider, config }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create connection');
      }
      const data: CreatedIntegration = await res.json();
      setCreated(data);
      setStep('success');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 7: Add chirpstack_mqtt form fields in the form step**

In the form step (`{step === 'form' && provider && ...}`), add the MQTT fields after the ChirpStack webhook fields block:

```typescript
            {/* chirpstack_mqtt: outbound MQTT broker config */}
            {provider === 'chirpstack_mqtt' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Broker address
                  </label>
                  <input
                    value={brokerUrl}
                    onChange={e => setBrokerUrl(e.target.value)}
                    placeholder="10.0.0.5"
                    required
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Port
                  </label>
                  <input
                    value={brokerPort}
                    onChange={e => setBrokerPort(e.target.value)}
                    placeholder="1883"
                    type="number"
                    min={1}
                    max={65535}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Username <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span>
                  </label>
                  <input
                    value={mqttUsername}
                    onChange={e => setMqttUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Password <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span>
                  </label>
                  <input
                    type="password"
                    value={mqttPassword}
                    onChange={e => setMqttPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mqttTls}
                    onChange={e => setMqttTls(e.target.checked)}
                    className="rounded"
                  />
                  Use TLS
                </label>
              </>
            )}
```

- [ ] **Step 8: Add chirpstack_mqtt success screen**

In the success step (`{step === 'success' && ...}`), add a branch for MQTT bridge:

```typescript
        {step === 'success' && createdMqtt && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              Bridge created — connecting to ChirpStack MQTT…
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5">Broker</p>
              <div className="flex items-center gap-2 font-mono text-xs bg-black/20 rounded-lg px-3 py-2">
                <span className="flex-1 text-[var(--color-text-primary)]">
                  {createdMqtt.broker_url}:{createdMqtt.port}
                </span>
                <CopyButton value={`${createdMqtt.broker_url}:${createdMqtt.port}`} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5">Status</p>
              <BridgeStatusDot status={createdMqtt.bridge_status} />
            </div>

            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              Make sure your devices are registered in Gito with matching <span className="font-mono">dev_eui</span> values.
              Uplinks will flow automatically once the bridge connects (typically within 60 seconds).
            </p>

            <button onClick={onClose} className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors">
              Done
            </button>
          </div>
        )}
```

Ensure the existing `{step === 'success' && created && ...}` block still shows for webhook integrations (it uses `created` not `createdMqtt` so it's unaffected as long as both checks are present).

- [ ] **Step 9: Commit**

```bash
git add web/src/app/dashboard/connections/page.tsx
git commit -m "feat: add ChirpStack MQTT provider to connections page — form, status indicator, auto-refresh"
```

---

## Task 7: Smoke Test End-to-End

- [ ] **Step 1: Verify migration applied**

```bash
docker exec gito-postgres psql -U gito -d gito -c "SELECT version_num FROM alembic_version;"
```

Expected: `017_chirpstack_mqtt`

- [ ] **Step 2: Create a chirpstack_mqtt integration via API**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

TENANT_ID=$(echo $TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | grep -o '"tenant_id":"[^"]*"' | cut -d'"' -f4)

curl -s -X POST "http://localhost:8000/api/v1/tenants/$TENANT_ID/integrations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test CS MQTT","provider":"chirpstack_mqtt","config":{"broker_url":"10.0.0.9","port":1883}}' \
  | python -m json.tool
```

Expected response:
```json
{
  "id": "...",
  "name": "Test CS MQTT",
  "provider": "chirpstack_mqtt",
  "broker_url": "10.0.0.9",
  "port": 1883,
  "bridge_status": "pending",
  "created_at": "..."
}
```

- [ ] **Step 3: Check processor picked up the bridge**

```bash
docker logs gito-processor --tail 30 | grep -i bridge
```

Expected: `Started ChirpStack bridge worker for integration <uuid>`

- [ ] **Step 4: Check bridge status in Redis**

```bash
docker exec gito-keydb redis-cli keys "bridge:*"
```

Expected: `bridge:status:<uuid>` and `bridge:lock:<uuid>`

- [ ] **Step 5: Verify GET returns bridge_status and masked password**

```bash
curl -s "http://localhost:8000/api/v1/tenants/$TENANT_ID/integrations" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

Expected: `bridge_status` field present, no plaintext password in config.

- [ ] **Step 6: Commit any fixes found during smoke test**

```bash
git add -A
git commit -m "fix: smoke test fixes for chirpstack_mqtt bridge"
```

---

## Self-Review Checklist

- [x] Migration 017 correctly makes key_hash/key_prefix nullable with partial index
- [x] Model updated to match migration
- [x] ProviderEnum includes chirpstack_mqtt
- [x] Create endpoint: chirpstack_mqtt path skips key generation, webhook path unchanged
- [x] Redis pub/sub notified on create/update/delete for chirpstack_mqtt
- [x] Credential masking applied in list and get
- [x] bridge_status read from Redis in list (mget) and get
- [x] rotate_key blocked for chirpstack_mqtt
- [x] BridgeWorker: exponential backoff, auth failure limit, lock renewal, count flush
- [x] ChirpStackBridgeManager: reconciliation on pub/sub + periodic sync
- [x] main() runs both processor and bridge manager concurrently
- [x] Frontend: new provider card, MQTT form, success screen, status dot, auto-refresh
- [x] Existing webhook integrations: completely unchanged
