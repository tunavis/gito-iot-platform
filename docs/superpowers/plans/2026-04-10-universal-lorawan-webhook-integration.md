# Universal LoRaWAN Webhook Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a universal HTTP webhook ingestion endpoint (`POST /api/v1/ingest/lorawan/{provider}`) that accepts uplinks from any LoRaWAN network server (ChirpStack, TTN, Helium, Actility, custom), plus a full integration management API for key generation, revocation, and per-provider setup instructions.

**Architecture:** A new `integrations` table stores hashed bearer keys scoped to a tenant + provider. The ingest endpoint resolves the key via a SECURITY DEFINER function (bypassing RLS), selects the correct provider parser to normalize the payload, resolves `dev_eui` to a `(tenant_id, device_id)` pair, then feeds data into the same telemetry pipeline used by `/ingest`.

**Tech Stack:** FastAPI, SQLAlchemy (async), PostgreSQL + RLS, Redis (deduplication + pub/sub), Pydantic v2, Alembic migrations.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `api/alembic/versions/015_integrations.py` | Create | DB migration: `integrations` table + `resolve_integration_key` SECURITY DEFINER function |
| `api/app/models/base.py` | Modify | Add `Integration` SQLAlchemy model |
| `api/app/schemas/integration.py` | Create | Pydantic request/response schemas |
| `api/app/services/lorawan_parsers.py` | Create | `NormalizedUplink` dataclass + one parser per provider |
| `api/app/routers/integrations.py` | Create | CRUD management endpoints (create, list, get, update, delete, rotate-key) |
| `api/app/routers/lorawan_ingest.py` | Create | `POST /ingest/lorawan/{provider}` webhook endpoint |
| `api/app/main.py` | Modify | Register 2 new routers |

---

## Task 1: Database Migration

**Files:**
- Create: `api/alembic/versions/015_integrations.py`

- [ ] **Step 1: Create the migration file**

```python
# api/alembic/versions/015_integrations.py
"""Add integrations table for universal LoRaWAN webhook ingestion.

Stores one row per tenant integration (TTN, ChirpStack, Helium, Actility, custom).
Authentication uses a hashed bearer key — raw key is never stored.
The resolve_integration_key SECURITY DEFINER function bypasses RLS for key lookup,
matching the same pattern as resolve_device_token.

Revision ID: 015_integrations
Revises: 014_key_mapping
Create Date: 2026-04-10
"""
from typing import Sequence, Union
from alembic import op

revision: str = "015_integrations"
down_revision: Union[str, None] = "014_key_mapping"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS integrations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            key_hash VARCHAR(64) NOT NULL,
            key_prefix VARCHAR(12) NOT NULL,
            config JSONB NOT NULL DEFAULT '{}',
            is_active BOOLEAN NOT NULL DEFAULT true,
            last_used_at TIMESTAMPTZ,
            message_count BIGINT NOT NULL DEFAULT 0,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT integrations_tenant_name_unique UNIQUE (tenant_id, name),
            CONSTRAINT valid_provider CHECK (
                provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom')
            )
        );
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_integrations_tenant
            ON integrations (tenant_id);
    """)

    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_key_hash
            ON integrations (key_hash);
    """)

    op.execute("""
        ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
    """)

    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'integrations' AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON integrations
                    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
            END IF;
        END $$;
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION resolve_integration_key(p_key_hash TEXT)
        RETURNS TABLE(
            integration_id UUID,
            tenant_id UUID,
            provider VARCHAR,
            config JSONB,
            is_active BOOLEAN
        )
        SECURITY DEFINER
        SET search_path = public
        LANGUAGE SQL
        AS $$
            SELECT id, tenant_id, provider, config, is_active
            FROM integrations
            WHERE key_hash = p_key_hash
            LIMIT 1;
        $$;
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS resolve_integration_key(TEXT);")
    op.execute("DROP TABLE IF EXISTS integrations;")
```

- [ ] **Step 2: Run migration to verify it applies cleanly**

```bash
cd api && alembic upgrade head
```

Expected: `Running upgrade 014_key_mapping -> 015_integrations, ...` with no errors.

- [ ] **Step 3: Verify table and function exist**

```bash
docker exec gito-postgres psql -U gito -d gito -c "\d integrations"
docker exec gito-postgres psql -U gito -d gito -c "\df resolve_integration_key"
```

Expected: table with all columns, function listed as SECURITY DEFINER.

- [ ] **Step 4: Commit**

```bash
git add api/alembic/versions/015_integrations.py
git commit -m "feat: add integrations table + resolve_integration_key function"
```

---

## Task 2: Integration SQLAlchemy Model

**Files:**
- Modify: `api/app/models/base.py`

- [ ] **Step 1: Add the `Integration` model at the end of `api/app/models/base.py`**

Open `api/app/models/base.py`. Locate the last model class definition. Add the following after it (before any `if __name__` block if one exists):

```python
class Integration(BaseModel):
    """Tenant integration for external LoRaWAN network server webhooks.

    Stores one row per integration (TTN, ChirpStack, Helium, Actility, custom).
    The raw integration key is never stored — only its SHA256 hash.
    """
    __tablename__ = "integrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    provider = Column(String(50), nullable=False)
    key_hash = Column(String(64), nullable=False, unique=True)
    key_prefix = Column(String(12), nullable=False)
    config = Column(JSONB, nullable=False, server_default="{}")
    is_active = Column(Boolean, nullable=False, default=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    message_count = Column(Integer, nullable=False, default=0)
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_integrations_tenant", "tenant_id"),
        CheckConstraint(
            "provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom')",
            name="valid_provider",
        ),
    )
```

- [ ] **Step 2: Verify the import block at the top of `base.py` already includes all needed types**

Check that `Boolean`, `Integer`, `JSONB`, `String`, `DateTime`, `Index`, `CheckConstraint`, `ForeignKey`, `Column`, `UUID` are all imported. Add any missing ones to the existing import block. The existing imports are:

```python
from sqlalchemy import (
    Column, String, DateTime, ForeignKey, CheckConstraint,
    Text, Integer, Float, Index, Boolean
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
```

`Integer` and `Boolean` are already there. No additions needed.

- [ ] **Step 3: Commit**

```bash
git add api/app/models/base.py
git commit -m "feat: add Integration model"
```

---

## Task 3: Pydantic Schemas

**Files:**
- Create: `api/app/schemas/integration.py`

- [ ] **Step 1: Create the schemas file**

```python
# api/app/schemas/integration.py
"""Pydantic schemas for integration management API."""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Any
from datetime import datetime
from uuid import UUID
from enum import Enum

PROVIDER_DOCS = {
    "chirpstack": {
        "name": "ChirpStack",
        "docs_url": "https://www.chirpstack.io/docs/chirpstack/integrations/mqtt.html",
        "steps": [
            "In ChirpStack, go to Applications → Your Application → Integrations",
            "Click 'Add integration' → Select 'HTTP'",
            "Set Event endpoint URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Enable 'Uplink' events and click Save",
        ],
    },
    "ttn": {
        "name": "The Things Network (TTN v3)",
        "docs_url": "https://www.thethingsindustries.com/docs/integrations/webhooks/",
        "steps": [
            "In TTN Console, go to Applications → Your App → Integrations → Webhooks",
            "Click 'Add webhook' → Choose 'Custom webhook'",
            "Set Base URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Enable 'Uplink message' under message types and click Save",
        ],
    },
    "helium": {
        "name": "Helium",
        "docs_url": "https://docs.helium.com/use-the-network/console/integrations/http/",
        "steps": [
            "In Helium Console, go to Integrations → Add Integration → HTTP",
            "Set Endpoint URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Connect your devices to this integration and Save",
        ],
    },
    "actility": {
        "name": "Actility ThingPark",
        "docs_url": "https://docs.thingpark.com/thingpark-enterprise/",
        "steps": [
            "In ThingPark, go to Application Servers → Create",
            "Set Type to 'HTTP Application Server'",
            "Set Destination URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Link your devices to this application server",
        ],
    },
    "custom": {
        "name": "Custom / Other",
        "docs_url": None,
        "steps": [
            "Configure your LNS to POST to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Payload must be JSON with: { \"dev_eui\": \"...\", \"metrics\": { ... } }",
        ],
    },
}


class ProviderEnum(str, Enum):
    chirpstack = "chirpstack"
    ttn = "ttn"
    helium = "helium"
    actility = "actility"
    custom = "custom"


class IntegrationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, description="Human-readable name")
    provider: ProviderEnum = Field(description="LoRaWAN network server provider")
    config: dict[str, Any] = Field(default_factory=dict, description="Provider-specific config")


class IntegrationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    config: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None


class SetupInstructions(BaseModel):
    provider_name: str
    steps: list[str]
    docs_url: Optional[str] = None


class IntegrationCreatedResponse(BaseModel):
    """Returned only on create and rotate-key. Contains raw key — shown once."""
    id: UUID
    name: str
    provider: ProviderEnum
    key: str = Field(description="Raw integration key — store this, it will not be shown again")
    key_prefix: str
    webhook_url: str
    setup_instructions: SetupInstructions
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class IntegrationResponse(BaseModel):
    """Safe response — never includes the raw key."""
    id: UUID
    tenant_id: UUID
    name: str
    provider: ProviderEnum
    key_prefix: str
    config: dict[str, Any]
    is_active: bool
    last_used_at: Optional[datetime] = None
    message_count: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


def build_setup_instructions(
    provider: str, webhook_url: str, key_prefix: str
) -> SetupInstructions:
    """Build provider-specific setup instructions with URL and key interpolated."""
    meta = PROVIDER_DOCS[provider]
    steps = [
        s.replace("{webhook_url}", webhook_url).replace("{key_preview}", key_prefix)
        for s in meta["steps"]
    ]
    return SetupInstructions(
        provider_name=meta["name"],
        steps=steps,
        docs_url=meta.get("docs_url"),
    )
```

- [ ] **Step 2: Commit**

```bash
git add api/app/schemas/integration.py
git commit -m "feat: add integration Pydantic schemas"
```

---

## Task 4: Provider Parsers

**Files:**
- Create: `api/app/services/lorawan_parsers.py`

- [ ] **Step 1: Create the parsers file**

```python
# api/app/services/lorawan_parsers.py
"""Provider-specific LoRaWAN uplink parsers.

Each parser accepts a raw JSON dict from a network server webhook and returns
a NormalizedUplink — a common format consumed by the lorawan_ingest router.

Returns None if the payload is structurally invalid for that provider.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

PROVIDERS = ("chirpstack", "ttn", "helium", "actility", "custom")


@dataclass
class NormalizedUplink:
    dev_eui: str                          # 16-char hex, lower-cased
    metrics: dict[str, Any]              # {"temperature": 25.5, ...}
    dedup_id: str                         # provider-unique string for deduplication
    radio: dict[str, Any] = field(default_factory=dict)  # optional radio metadata
    raw_payload: str | None = None        # base64 raw LoRa payload (for debugging)


def _safe_float(val: Any) -> float | None:
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_int(val: Any) -> int | None:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# ChirpStack v4
# ---------------------------------------------------------------------------

def parse_chirpstack(body: dict) -> NormalizedUplink | None:
    """Parse a ChirpStack v4 uplink webhook payload.

    ChirpStack sends decoded sensor data in body["object"].
    Radio info is in body["rxInfo"][0] (best gateway = first entry).
    """
    device_info = body.get("deviceInfo") or {}
    dev_eui = device_info.get("devEui") or body.get("devEui")
    if not dev_eui:
        logger.warning("chirpstack: missing deviceInfo.devEui")
        return None

    metrics = body.get("object")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("chirpstack: missing or empty 'object' field — configure a codec in ChirpStack")
        return None

    dedup_id = body.get("deduplicationId") or dev_eui + str(body.get("fCnt", ""))

    radio: dict[str, Any] = {}
    rx_info = body.get("rxInfo") or []
    if rx_info:
        best = rx_info[0]
        if (rssi := _safe_float(best.get("rssi"))) is not None:
            radio["rssi"] = rssi
        if (snr := _safe_float(best.get("snr"))) is not None:
            radio["snr"] = snr
        if gw := best.get("gatewayId"):
            radio["gateway_id"] = gw

    tx_info = body.get("txInfo") or {}
    if (freq := _safe_float(tx_info.get("frequency"))) is not None:
        radio["frequency"] = freq
    lora = (tx_info.get("modulation") or {}).get("lora") or {}
    if (sf := _safe_int(lora.get("spreadingFactor"))) is not None:
        radio["spreading_factor"] = sf
    if (fc := _safe_int(body.get("fCnt"))) is not None:
        radio["frame_count"] = fc
    if (dr := _safe_int(body.get("dr"))) is not None:
        radio["data_rate"] = dr

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=body.get("data"),
    )


# ---------------------------------------------------------------------------
# The Things Network v3 (The Things Stack)
# ---------------------------------------------------------------------------

def parse_ttn(body: dict) -> NormalizedUplink | None:
    """Parse a TTN v3 (The Things Stack) uplink webhook payload."""
    ids = body.get("end_device_ids") or {}
    dev_eui = ids.get("dev_eui")
    if not dev_eui:
        logger.warning("ttn: missing end_device_ids.dev_eui")
        return None

    uplink = body.get("uplink_message") or {}
    metrics = uplink.get("decoded_payload")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("ttn: missing or empty uplink_message.decoded_payload — configure a payload formatter in TTN")
        return None

    correlation_ids = body.get("correlation_ids") or []
    dedup_id = correlation_ids[0] if correlation_ids else dev_eui + str(uplink.get("f_cnt", ""))

    radio: dict[str, Any] = {}
    rx_meta = uplink.get("rx_metadata") or []
    if rx_meta:
        best = rx_meta[0]
        if (rssi := _safe_float(best.get("rssi"))) is not None:
            radio["rssi"] = rssi
        if (snr := _safe_float(best.get("snr"))) is not None:
            radio["snr"] = snr
        gw_ids = (best.get("gateway_ids") or {})
        if gw := gw_ids.get("gateway_id"):
            radio["gateway_id"] = gw

    settings = uplink.get("settings") or {}
    if (freq := _safe_float(settings.get("frequency"))) is not None:
        radio["frequency"] = freq
    lora = (settings.get("data_rate") or {}).get("lora") or {}
    if (sf := _safe_int(lora.get("spreading_factor"))) is not None:
        radio["spreading_factor"] = sf
    if (fc := _safe_int(uplink.get("f_cnt"))) is not None:
        radio["frame_count"] = fc

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=uplink.get("frm_payload"),
    )


# ---------------------------------------------------------------------------
# Helium
# ---------------------------------------------------------------------------

def parse_helium(body: dict) -> NormalizedUplink | None:
    """Parse a Helium Console HTTP integration uplink payload."""
    dev_eui = body.get("dev_eui")
    if not dev_eui:
        logger.warning("helium: missing dev_eui")
        return None

    decoded = body.get("decoded") or {}
    metrics = decoded.get("payload")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("helium: missing or empty decoded.payload — configure a function decoder in Helium")
        return None

    dedup_id = body.get("id") or dev_eui + str(body.get("fcnt", ""))

    radio: dict[str, Any] = {}
    hotspots = body.get("hotspots") or []
    if hotspots:
        best = hotspots[0]
        if (rssi := _safe_float(best.get("rssi"))) is not None:
            radio["rssi"] = rssi
        if (snr := _safe_float(best.get("snr"))) is not None:
            radio["snr"] = snr
        if name := best.get("name"):
            radio["gateway_id"] = name
        if (freq := _safe_float(best.get("frequency"))) is not None:
            radio["frequency"] = freq * 1_000_000  # MHz → Hz
        if (sf := _safe_int(best.get("spreading_factor"))) is not None:
            radio["spreading_factor"] = sf

    if (fc := _safe_int(body.get("fcnt"))) is not None:
        radio["frame_count"] = fc

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=body.get("payload"),
    )


# ---------------------------------------------------------------------------
# Actility ThingPark
# ---------------------------------------------------------------------------

def parse_actility(body: dict) -> NormalizedUplink | None:
    """Parse an Actility ThingPark uplink webhook payload."""
    uplink = body.get("DevEUI_uplink") or {}
    dev_eui = uplink.get("DevEUI")
    if not dev_eui:
        logger.warning("actility: missing DevEUI_uplink.DevEUI")
        return None

    # Actility sends hex-encoded payload; decoded metrics come from a custom AS
    # If a decoded 'payload_cleartext' dict is present, use it; else warn.
    metrics = uplink.get("payload_cleartext")
    if not metrics or not isinstance(metrics, dict):
        logger.warning(
            "actility: missing payload_cleartext dict — configure an Application Server decoder in ThingPark"
        )
        return None

    fc = _safe_int(uplink.get("FCntUp"))
    dedup_id = f"{dev_eui}:{fc}" if fc is not None else dev_eui

    radio: dict[str, Any] = {}
    if (rssi := _safe_float(uplink.get("LrrRSSI"))) is not None:
        radio["rssi"] = rssi
    if (snr := _safe_float(uplink.get("LrrSNR"))) is not None:
        radio["snr"] = snr
    if gw := uplink.get("Lrrid"):
        radio["gateway_id"] = gw
    if fc is not None:
        radio["frame_count"] = fc

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=uplink.get("payload_hex"),
    )


# ---------------------------------------------------------------------------
# Custom / Other — escape hatch for any LNS
# ---------------------------------------------------------------------------

def parse_custom(body: dict) -> NormalizedUplink | None:
    """Parse a custom/generic uplink payload.

    Expected format:
        {"dev_eui": "0102030405060708", "metrics": {"temperature": 25.5}}
    Optional:
        {"radio": {"rssi": -90, "snr": 7.5}, "dedup_id": "unique-string"}
    """
    dev_eui = body.get("dev_eui")
    if not dev_eui:
        logger.warning("custom: missing 'dev_eui' field")
        return None

    metrics = body.get("metrics")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("custom: missing or empty 'metrics' dict")
        return None

    radio = body.get("radio") or {}
    dedup_id = body.get("dedup_id") or dev_eui + str(body.get("timestamp", ""))

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio if isinstance(radio, dict) else {},
    )


# ---------------------------------------------------------------------------
# Parser registry
# ---------------------------------------------------------------------------

PARSERS: dict[str, Any] = {
    "chirpstack": parse_chirpstack,
    "ttn": parse_ttn,
    "helium": parse_helium,
    "actility": parse_actility,
    "custom": parse_custom,
}


def get_parser(provider: str):
    """Return the parser function for a given provider string.

    Raises KeyError if provider is unknown.
    """
    return PARSERS[provider]
```

- [ ] **Step 2: Write parser unit tests**

Create `api/tests/test_lorawan_parsers.py`:

```python
# api/tests/test_lorawan_parsers.py
"""Unit tests for LoRaWAN provider parsers."""

import pytest
from app.services.lorawan_parsers import (
    parse_chirpstack, parse_ttn, parse_helium, parse_actility, parse_custom,
    get_parser, PROVIDERS,
)

# --- ChirpStack ---

def test_parse_chirpstack_happy_path():
    body = {
        "deduplicationId": "abc123",
        "deviceInfo": {"devEui": "0102030405060708"},
        "fCnt": 5,
        "dr": 3,
        "object": {"temperature": 24.5, "humidity": 61},
        "rxInfo": [{"rssi": -80, "snr": 9.5, "gatewayId": "gw-001"}],
        "txInfo": {
            "frequency": 868100000,
            "modulation": {"lora": {"spreadingFactor": 7}},
        },
    }
    result = parse_chirpstack(body)
    assert result is not None
    assert result.dev_eui == "0102030405060708"
    assert result.metrics == {"temperature": 24.5, "humidity": 61}
    assert result.dedup_id == "abc123"
    assert result.radio["rssi"] == -80
    assert result.radio["snr"] == 9.5
    assert result.radio["gateway_id"] == "gw-001"
    assert result.radio["frequency"] == 868100000
    assert result.radio["spreading_factor"] == 7
    assert result.radio["frame_count"] == 5
    assert result.radio["data_rate"] == 3


def test_parse_chirpstack_no_deveui_returns_none():
    result = parse_chirpstack({"object": {"temperature": 24.5}})
    assert result is None


def test_parse_chirpstack_no_object_returns_none():
    result = parse_chirpstack({"deviceInfo": {"devEui": "abc123"}})
    assert result is None


def test_parse_chirpstack_empty_rxinfo():
    body = {
        "deviceInfo": {"devEui": "0102030405060708"},
        "object": {"temperature": 24.5},
        "rxInfo": [],
    }
    result = parse_chirpstack(body)
    assert result is not None
    assert result.radio == {}


def test_parse_chirpstack_dev_eui_lowercased():
    body = {
        "deviceInfo": {"devEui": "AABBCCDD11223344"},
        "object": {"temp": 20},
        "rxInfo": [],
    }
    result = parse_chirpstack(body)
    assert result.dev_eui == "aabbccdd11223344"


# --- TTN ---

def test_parse_ttn_happy_path():
    body = {
        "end_device_ids": {"dev_eui": "AABB112233445566"},
        "correlation_ids": ["corr-id-001"],
        "uplink_message": {
            "f_cnt": 10,
            "decoded_payload": {"level": 85.0},
            "rx_metadata": [{
                "rssi": -95,
                "snr": 6.0,
                "gateway_ids": {"gateway_id": "my-gateway"},
            }],
            "settings": {
                "frequency": "868100000",
                "data_rate": {"lora": {"spreading_factor": 9}},
            },
        },
    }
    result = parse_ttn(body)
    assert result is not None
    assert result.dev_eui == "aabb112233445566"
    assert result.metrics == {"level": 85.0}
    assert result.dedup_id == "corr-id-001"
    assert result.radio["rssi"] == -95
    assert result.radio["snr"] == 6.0
    assert result.radio["gateway_id"] == "my-gateway"
    assert result.radio["frame_count"] == 10


def test_parse_ttn_no_decoded_payload_returns_none():
    body = {
        "end_device_ids": {"dev_eui": "AABB112233445566"},
        "uplink_message": {},
    }
    assert parse_ttn(body) is None


# --- Helium ---

def test_parse_helium_happy_path():
    body = {
        "dev_eui": "CCDD556677889900",
        "id": "helium-dedup-001",
        "fcnt": 7,
        "decoded": {"payload": {"flow_rate": 12.3}},
        "hotspots": [{"rssi": -100, "snr": 4.0, "name": "hot-spot-1", "frequency": 868.1, "spreading_factor": 10}],
        "payload": "base64abc",
    }
    result = parse_helium(body)
    assert result is not None
    assert result.dev_eui == "ccdd556677889900"
    assert result.metrics == {"flow_rate": 12.3}
    assert result.dedup_id == "helium-dedup-001"
    assert result.radio["rssi"] == -100
    assert result.radio["frequency"] == pytest.approx(868100000.0)


def test_parse_helium_no_decoded_returns_none():
    body = {"dev_eui": "CCDD556677889900"}
    assert parse_helium(body) is None


# --- Actility ---

def test_parse_actility_happy_path():
    body = {
        "DevEUI_uplink": {
            "DevEUI": "EEFF001122334455",
            "FCntUp": 3,
            "LrrRSSI": -85.0,
            "LrrSNR": 8.0,
            "Lrrid": "actility-gw-01",
            "payload_cleartext": {"pressure": 1013.25},
        }
    }
    result = parse_actility(body)
    assert result is not None
    assert result.dev_eui == "eeff001122334455"
    assert result.metrics == {"pressure": 1013.25}
    assert result.radio["rssi"] == -85.0
    assert result.radio["frame_count"] == 3


def test_parse_actility_no_decoded_returns_none():
    body = {"DevEUI_uplink": {"DevEUI": "EEFF001122334455"}}
    assert parse_actility(body) is None


# --- Custom ---

def test_parse_custom_happy_path():
    body = {
        "dev_eui": "1122334455667788",
        "metrics": {"co2": 420, "voc": 15},
        "radio": {"rssi": -70},
        "dedup_id": "my-dedup",
    }
    result = parse_custom(body)
    assert result is not None
    assert result.dev_eui == "1122334455667788"
    assert result.metrics == {"co2": 420, "voc": 15}
    assert result.dedup_id == "my-dedup"
    assert result.radio["rssi"] == -70


def test_parse_custom_missing_dev_eui_returns_none():
    assert parse_custom({"metrics": {"temp": 20}}) is None


def test_parse_custom_missing_metrics_returns_none():
    assert parse_custom({"dev_eui": "abc"}) is None


# --- Registry ---

def test_get_parser_returns_correct_function():
    assert get_parser("chirpstack") is parse_chirpstack
    assert get_parser("ttn") is parse_ttn
    assert get_parser("helium") is parse_helium
    assert get_parser("actility") is parse_actility
    assert get_parser("custom") is parse_custom


def test_get_parser_unknown_raises_key_error():
    with pytest.raises(KeyError):
        get_parser("unknown_lns")
```

- [ ] **Step 3: Run the tests**

```bash
cd api && python -m pytest tests/test_lorawan_parsers.py -v
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add api/app/services/lorawan_parsers.py api/tests/test_lorawan_parsers.py
git commit -m "feat: add LoRaWAN provider parsers (ChirpStack, TTN, Helium, Actility, custom)"
```

---

## Task 5: Integration Management Router

**Files:**
- Create: `api/app/routers/integrations.py`

- [ ] **Step 1: Create the router file**

```python
# api/app/routers/integrations.py
"""Integration management API — CRUD for LoRaWAN network server integrations.

Integrations let customers forward LoRaWAN uplinks from any LNS (TTN,
ChirpStack, Helium, Actility) into Gito via HTTP webhook.

Each integration has a hashed bearer key. The raw key is returned only
on create and rotate-key — it is never retrievable afterward.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text

from app.database import get_session, RLSSession
from app.dependencies import get_current_user
from app.models.base import Integration
from app.schemas.common import SuccessResponse
from app.schemas.integration import (
    IntegrationCreate,
    IntegrationCreatedResponse,
    IntegrationResponse,
    IntegrationUpdate,
    SetupInstructions,
    build_setup_instructions,
)
from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/integrations",
    tags=["integrations"],
)

KEY_PREFIX = "gito_ik_"
KEY_BYTES = 32  # 256-bit random key → 43-char base64url string


def _generate_key() -> tuple[str, str, str]:
    """Generate a new integration key.

    Returns:
        (raw_key, key_hash, key_prefix)
    """
    raw = KEY_PREFIX + secrets.token_urlsafe(KEY_BYTES)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key_prefix = raw[:12]
    return raw, key_hash, key_prefix


def _webhook_url(provider: str) -> str:
    settings = get_settings()
    base = getattr(settings, "API_BASE_URL", "https://iot.gito.co.za")
    return f"{base}/api/v1/ingest/lorawan/{provider}"


async def _validate_tenant(
    tenant_id: UUID,
    current_user: tuple[UUID, UUID],
) -> None:
    current_tenant_id, _ = current_user
    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", response_model=IntegrationCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_integration(
    tenant_id: UUID,
    body: IntegrationCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Create a new integration and return the raw key (shown only once)."""
    await _validate_tenant(tenant_id, current_user)
    current_tenant_id, current_user_id = current_user
    await session.set_tenant_context(current_tenant_id, current_user_id)

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

    webhook_url = _webhook_url(body.provider.value)
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


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("", response_model=SuccessResponse)
async def list_integrations(
    tenant_id: UUID,
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

    return SuccessResponse(
        data=[IntegrationResponse.model_validate(i, from_attributes=True) for i in integrations]
    )


# ---------------------------------------------------------------------------
# Get (with setup instructions)
# ---------------------------------------------------------------------------

@router.get("/{integration_id}", response_model=SuccessResponse)
async def get_integration(
    tenant_id: UUID,
    integration_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Get a single integration including setup instructions."""
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

    webhook_url = _webhook_url(integration.provider)
    instructions = build_setup_instructions(integration.provider, webhook_url, integration.key_prefix)

    response_data = IntegrationResponse.model_validate(integration, from_attributes=True).model_dump()
    response_data["webhook_url"] = webhook_url
    response_data["setup_instructions"] = instructions.model_dump()

    return SuccessResponse(data=response_data)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

@router.put("/{integration_id}", response_model=SuccessResponse)
async def update_integration(
    tenant_id: UUID,
    integration_id: UUID,
    body: IntegrationUpdate,
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

    return SuccessResponse(data=IntegrationResponse.model_validate(integration, from_attributes=True))


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    tenant_id: UUID,
    integration_id: UUID,
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

    await session.delete(integration)
    await session.commit()


# ---------------------------------------------------------------------------
# Rotate key
# ---------------------------------------------------------------------------

@router.post("/{integration_id}/rotate-key", response_model=IntegrationCreatedResponse)
async def rotate_key(
    tenant_id: UUID,
    integration_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Generate a new key for an integration, invalidating the old one."""
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

    raw_key, key_hash, key_prefix = _generate_key()
    integration.key_hash = key_hash
    integration.key_prefix = key_prefix
    integration.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(integration)

    webhook_url = _webhook_url(integration.provider)
    instructions = build_setup_instructions(integration.provider, webhook_url, key_prefix)

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

- [ ] **Step 2: Commit**

```bash
git add api/app/routers/integrations.py
git commit -m "feat: add integration management CRUD router"
```

---

## Task 6: LoRaWAN Webhook Ingest Router

**Files:**
- Create: `api/app/routers/lorawan_ingest.py`

- [ ] **Step 1: Create the ingest router**

```python
# api/app/routers/lorawan_ingest.py
"""Universal LoRaWAN webhook ingestion endpoint.

Accepts uplinks from any LNS (ChirpStack, TTN, Helium, Actility, custom)
and feeds them into the same telemetry pipeline as /ingest.

Authentication: Bearer {integration_key} header.
Key lookup uses resolve_integration_key() SECURITY DEFINER function
(bypasses RLS, same pattern as resolve_device_token).
"""

import hashlib
import json as _json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, text

from app.database import get_session, RLSSession
from app.models.base import Device, Telemetry
from app.schemas.common import SuccessResponse
from app.services.lorawan_parsers import get_parser, NormalizedUplink

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest/lorawan", tags=["lorawan-ingest"])

SYSTEM_KEYS = {"timestamp", "ts", "device_id", "tenant_id", "id"}
RATE_LIMIT_KEY_TTL = 60   # seconds per rate window
RATE_LIMIT_MAX = 600      # messages per window per integration
DEDUP_TTL = 30            # seconds


async def _resolve_integration(
    session: RLSSession,
    key_hash: str,
    provider: str,
) -> dict:
    """Look up integration by key hash via SECURITY DEFINER function.

    Returns dict with keys: integration_id, tenant_id, provider, config, is_active.
    Raises 401 if not found or inactive, 403 if provider mismatch.
    """
    result = await session.execute(
        text("SELECT integration_id, tenant_id, provider, config, is_active FROM resolve_integration_key(:hash)"),
        {"hash": key_hash},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid integration key")
    row_dict = dict(row._mapping)
    if not row_dict["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Integration is disabled")
    if row_dict["provider"] != provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Key is for provider '{row_dict['provider']}', not '{provider}'",
        )
    return row_dict


async def _resolve_device(
    session: RLSSession,
    tenant_id,
    dev_eui: str,
) -> Any:
    """Resolve dev_eui to a Device row.

    Returns the Device ORM object, or raises 404.
    """
    result = await session.execute(
        select(Device).where(
            Device.tenant_id == tenant_id,
            Device.dev_eui == dev_eui,
        )
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with dev_eui '{dev_eui}' not found. Register it in Gito first.",
        )
    return device


def _build_telemetry_rows(
    tenant_id, device_id, metrics: dict, key_mapping: dict, ts: datetime
) -> list:
    """Convert a flat metrics dict into Telemetry ORM rows."""
    rows = []
    for raw_key, value in metrics.items():
        if raw_key in SYSTEM_KEYS:
            continue
        canonical_key = key_mapping.get(raw_key, raw_key)
        row = Telemetry(
            tenant_id=tenant_id,
            device_id=device_id,
            metric_key=canonical_key,
            ts=ts,
        )
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            row.metric_value = float(value)
        elif isinstance(value, str):
            row.metric_value_str = value
        elif isinstance(value, (dict, list)):
            row.metric_value_json = value
        else:
            row.metric_value_str = str(value)
        rows.append(row)
    return rows


def _radio_to_lora_metrics(radio: dict) -> dict:
    """Convert radio metadata dict to __lora_* metric keys."""
    mapping = {
        "rssi": "__lora_rssi",
        "snr": "__lora_snr",
        "gateway_id": "__lora_gateway_id",
        "frequency": "__lora_frequency",
        "spreading_factor": "__lora_spreading_factor",
        "frame_count": "__lora_frame_count",
        "data_rate": "__lora_data_rate",
    }
    return {mapping[k]: v for k, v in radio.items() if k in mapping}


@router.post("/{provider}", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def ingest_lorawan(
    provider: str,
    request: Request,
    body: dict,
    session: Annotated[RLSSession, Depends(get_session)] = None,
):
    # FastAPI needs the Annotated import — fix signature below
    ...
```

Replace the placeholder function with the full implementation:

```python
# api/app/routers/lorawan_ingest.py  (full file)
"""Universal LoRaWAN webhook ingestion endpoint.

Accepts uplinks from any LNS (ChirpStack, TTN, Helium, Actility, custom)
and feeds them into the same telemetry pipeline as /ingest.

Authentication: Authorization: Bearer {integration_key}
Key lookup uses resolve_integration_key() SECURITY DEFINER function.
"""

import hashlib
import json as _json
import logging
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select, text

from app.database import get_session, RLSSession
from app.models.base import Device, Telemetry
from app.schemas.common import SuccessResponse
from app.services.lorawan_parsers import get_parser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest/lorawan", tags=["lorawan-ingest"])

SYSTEM_KEYS = {"timestamp", "ts", "device_id", "tenant_id", "id"}
RATE_LIMIT_MAX = 600   # messages per minute per integration
DEDUP_TTL = 30         # seconds


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _radio_to_lora_metrics(radio: dict) -> dict:
    mapping = {
        "rssi": "__lora_rssi",
        "snr": "__lora_snr",
        "gateway_id": "__lora_gateway_id",
        "frequency": "__lora_frequency",
        "spreading_factor": "__lora_spreading_factor",
        "frame_count": "__lora_frame_count",
        "data_rate": "__lora_data_rate",
    }
    return {mapping[k]: v for k, v in radio.items() if k in mapping}


def _build_telemetry_rows(tenant_id, device_id, metrics: dict, key_mapping: dict, ts: datetime) -> list:
    rows = []
    for raw_key, value in metrics.items():
        if raw_key in SYSTEM_KEYS:
            continue
        canonical_key = key_mapping.get(raw_key, raw_key)
        row = Telemetry(
            tenant_id=tenant_id,
            device_id=device_id,
            metric_key=canonical_key,
            ts=ts,
        )
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            row.metric_value = float(value)
        elif isinstance(value, str):
            row.metric_value_str = value
        elif isinstance(value, (dict, list)):
            row.metric_value_json = value
        else:
            row.metric_value_str = str(value)
        rows.append(row)
    return rows


@router.post("/{provider}", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def ingest_lorawan(
    provider: str,
    request: Request,
    body: dict[str, Any],
    session: Annotated[RLSSession, Depends(get_session)],
    authorization: str = Header(None),
):
    """Ingest a LoRaWAN uplink from any network server.

    The {provider} path param selects the payload parser.
    Authentication is via Bearer {integration_key} header.
    """
    # --- Validate provider ---
    try:
        parser = get_parser(provider)
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown provider '{provider}'. Supported: chirpstack, ttn, helium, actility, custom",
        )

    # --- Validate bearer key ---
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    raw_key = authorization.split(" ", 1)[1]
    key_hash = _hash_key(raw_key)

    # --- Resolve integration (bypasses RLS) ---
    result = await session.execute(
        text("SELECT integration_id, tenant_id, provider, config, is_active FROM resolve_integration_key(:hash)"),
        {"hash": key_hash},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid integration key")
    integration = dict(row._mapping)

    if not integration["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Integration is disabled")
    if integration["provider"] != provider:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Key is registered for provider '{integration['provider']}', not '{provider}'",
        )

    tenant_id = integration["tenant_id"]
    integration_id = integration["integration_id"]

    # --- Rate limit per integration (Redis, 600/min) ---
    redis_client = getattr(request.app.state, "redis", None)
    import time
    rate_key = f"rate:integration:{integration_id}:{int(time.time()) // 60}"
    if redis_client:
        try:
            count = await redis_client.incr(rate_key)
            if count == 1:
                await redis_client.expire(rate_key, 120)
            config = integration.get("config") or {}
            limit = int(config.get("rate_limit", RATE_LIMIT_MAX))
            if count > limit:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Rate limit check failed: %s", e)

    # --- Parse provider payload ---
    uplink = parser(body)
    if not uplink:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not parse payload for provider '{provider}'. Check setup instructions for required fields.",
        )

    # --- Deduplication (30s TTL) ---
    if redis_client:
        try:
            dedup_key = f"dedup:lora:{uplink.dedup_id}"
            already_seen = await redis_client.set(dedup_key, 1, nx=True, ex=DEDUP_TTL) is None
            if already_seen:
                logger.debug("Duplicate LoRaWAN uplink ignored: %s", uplink.dedup_id)
                return SuccessResponse(data={"ingested": 0, "duplicate": True})
        except Exception as e:
            logger.warning("Deduplication check failed: %s", e)

    # --- Set RLS tenant context ---
    await session.set_tenant_context(tenant_id)

    # --- Resolve dev_eui → device ---
    dev_result = await session.execute(
        select(Device).where(
            Device.tenant_id == tenant_id,
            Device.dev_eui == uplink.dev_eui,
        )
    )
    device = dev_result.scalar_one_or_none()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device with dev_eui '{uplink.dev_eui}' not found. Register it in Gito first.",
        )

    device_id = device.id
    ts = datetime.now(timezone.utc)

    # --- Fetch key mapping from device type ---
    key_mapping: dict = {}
    km_result = await session.execute(
        text(
            "SELECT dt.key_mapping FROM devices d "
            "JOIN device_types dt ON d.device_type_id = dt.id "
            "WHERE d.id = :device_id"
        ),
        {"device_id": str(device_id)},
    )
    km_row = km_result.fetchone()
    if km_row and km_row[0]:
        key_mapping = km_row[0]

    # --- Build telemetry rows: user metrics + __lora_* radio metadata ---
    all_metrics = dict(uplink.metrics)
    if uplink.radio:
        all_metrics.update(_radio_to_lora_metrics(uplink.radio))

    rows = _build_telemetry_rows(tenant_id, device_id, all_metrics, key_mapping, ts)
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid metrics in payload")

    session.add_all(rows)
    await session.commit()

    # --- Update device last_seen + status ---
    await session.execute(
        text(
            "UPDATE devices SET last_seen = :ts, status = 'online', updated_at = now() "
            "WHERE id = :device_id AND tenant_id = :tenant_id"
        ),
        {"ts": ts, "device_id": str(device_id), "tenant_id": str(tenant_id)},
    )
    await session.commit()

    # --- Increment integration message_count + last_used_at ---
    await session.execute(
        text(
            "UPDATE integrations SET message_count = message_count + 1, last_used_at = now() "
            "WHERE id = :integration_id"
        ),
        {"integration_id": str(integration_id)},
    )
    await session.commit()

    # --- Publish to Redis for WebSocket + digital twin (non-critical) ---
    if redis_client:
        try:
            clean_payload = {k: v for k, v in uplink.metrics.items() if k not in SYSTEM_KEYS}
            channel = f"telemetry:{tenant_id}:{device_id}"
            message = _json.dumps({
                "device_id": str(device_id),
                "payload": clean_payload,
                "timestamp": ts.isoformat(),
            })
            await redis_client.publish(channel, message)
        except Exception as e:
            logger.warning("Failed to publish to Redis: %s", e)

    user_metric_count = len([k for k in all_metrics if not k.startswith("__lora_")])
    logger.info(
        "lorawan_ingest: %d metrics for device %s via %s (tenant %s)",
        user_metric_count, device_id, provider, tenant_id,
    )

    return SuccessResponse(data={"ingested": user_metric_count, "timestamp": ts.isoformat()})
```

- [ ] **Step 2: Commit**

```bash
git add api/app/routers/lorawan_ingest.py
git commit -m "feat: add universal LoRaWAN webhook ingest router"
```

---

## Task 7: Register Routers in main.py

**Files:**
- Modify: `api/app/main.py`

- [ ] **Step 1: Add the two new router imports in `create_app()`**

Find this block in `api/app/main.py`:

```python
    from app.routers import solution_templates as solution_templates_router
```

Add after it:

```python
    from app.routers import integrations as integrations_router
    from app.routers import lorawan_ingest as lorawan_ingest_router
```

- [ ] **Step 2: Register both routers**

Find this line in `main.py`:

```python
    app.include_router(solution_templates_router.router, prefix="/api/v1")
```

Add after it:

```python
    app.include_router(integrations_router.router, prefix="/api/v1")
    app.include_router(lorawan_ingest_router.router, prefix="/api/v1")
```

- [ ] **Step 3: Verify the app starts cleanly**

```bash
cd api && python -m uvicorn app.main:app --reload --port 8000
```

Expected: Server starts with no import errors. Check `http://localhost:8000/api/docs` — you should see the `integrations` and `lorawan-ingest` tag groups in the Swagger UI.

- [ ] **Step 4: Smoke test the endpoints**

```bash
# Should return 401 (no auth)
curl -X POST http://localhost:8000/api/v1/ingest/lorawan/ttn \
  -H "Content-Type: application/json" \
  -d '{}'

# Should return 400 (unknown provider)
curl -X POST http://localhost:8000/api/v1/ingest/lorawan/unknown \
  -H "Authorization: Bearer test" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `401` and `400` respectively with JSON error bodies.

- [ ] **Step 5: Commit**

```bash
git add api/app/main.py
git commit -m "feat: register integrations and lorawan_ingest routers"
```

---

## Task 8: Add API_BASE_URL to Config

**Files:**
- Modify: `api/app/config.py`

- [ ] **Step 1: Add `API_BASE_URL` setting**

Open `api/app/config.py`. Find the `Settings` class. Add this field alongside the other URL settings:

```python
API_BASE_URL: str = "https://iot.gito.co.za"
```

- [ ] **Step 2: Add to `.env` and `.env.staging`**

In `.env` (local dev):
```
API_BASE_URL=http://localhost:8000
```

In `.env.staging`:
```
API_BASE_URL=https://dev-iot.gito.co.za
```

- [ ] **Step 3: Commit**

```bash
git add api/app/config.py .env.staging
git commit -m "config: add API_BASE_URL for webhook URL generation"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - `integrations` table → Task 1 ✓
  - `resolve_integration_key` SECURITY DEFINER → Task 1 ✓
  - `Integration` model → Task 2 ✓
  - Pydantic schemas + setup instructions → Task 3 ✓
  - All 5 provider parsers → Task 4 ✓
  - CRUD management API (create, list, get, update, delete, rotate-key) → Task 5 ✓
  - Webhook ingest endpoint with full processing flow → Task 6 ✓
  - Router registration → Task 7 ✓
  - `API_BASE_URL` config for webhook URL generation → Task 8 ✓

- [x] **No placeholders:** All steps contain complete code.

- [x] **Type consistency:**
  - `NormalizedUplink` defined in Task 4, imported in Task 6 ✓
  - `IntegrationCreatedResponse` / `IntegrationResponse` defined in Task 3, used in Task 5 ✓
  - `build_setup_instructions()` defined in Task 3, called in Tasks 5 and inline in Task 6 ✓
  - `get_parser()` defined in Task 4, called in Task 6 ✓

- [x] **Rate limit config key:** Task 6 reads `config.get("rate_limit", RATE_LIMIT_MAX)` — matches `config JSONB` column from Task 1 ✓
