"""Pydantic schemas for integration management API."""

from pydantic import BaseModel, ConfigDict, Field, model_validator
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
    "mqtt": {
        "name": "MQTT",
        "docs_url": None,
        "steps": [
            "Configure your MQTT client or gateway to connect to: {webhook_url}",
            "Use your device EUI or identifier as the MQTT username",
            "Use this key as the MQTT password: {key_preview}...",
            "Publish telemetry to topic: devices/<dev_eui>/telemetry",
            'Payload must be JSON: { "metric_key": value, ... }',
        ],
    },
    "http": {
        "name": "HTTP Ingest",
        "docs_url": None,
        "steps": [
            "POST device telemetry as JSON to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            'Payload must be JSON: { "dev_eui": "...", "metrics": { "temperature": 22.5 } }',
        ],
    },
    "custom": {
        "name": "Custom / Other",
        "docs_url": None,
        "steps": [
            "Configure your LNS to POST to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            'Payload must be JSON with: { "dev_eui": "...", "metrics": { ... } }',
        ],
    },
    "chirpstack_mqtt": {
        "name": "ChirpStack MQTT",
        "docs_url": "https://www.chirpstack.io/docs/chirpstack/integrations/mqtt.html",
        "steps": [],  # No setup steps — Gito connects outbound
    },
}


class ProviderEnum(str, Enum):
    chirpstack = "chirpstack"
    ttn = "ttn"
    helium = "helium"
    actility = "actility"
    mqtt = "mqtt"
    http = "http"
    custom = "custom"
    chirpstack_mqtt = "chirpstack_mqtt"


# Declared, never inferred from how this server's uplinks arrive. The two
# directions are independent: one client forwards uplinks over MQTT and accepts
# downlinks on the same broker; another pushes uplinks over HTTP and accepts
# downlinks only through a REST API; a third can send to us and receive nothing.
DOWNLINK_MODES = ("mqtt", "rest", "none")

_DOWNLINK_MODE_DESC = (
    "How downlinks reach this network server. 'mqtt' publishes to the broker in "
    "config on application/{app}/device/{eui}/command/down. 'rest' POSTs to "
    "downlink_api_url. 'none' means this server accepts no downlinks, and "
    "commands to its devices are refused when issued rather than left to expire. "
    "Omit if not configured yet — which is different from 'none'."
)


def _validate_downlink(mode, api_url, config):
    """Refuse a declaration that cannot be acted on, when it is saved.

    At dispatch it is too late: the command already exists, and a mode the
    platform cannot perform would look like the device failing to answer.
    """
    if mode is None:
        return
    if mode not in DOWNLINK_MODES:
        raise ValueError(f"downlink_mode must be one of {list(DOWNLINK_MODES)}, got {mode!r}")
    if mode == "rest" and not api_url:
        raise ValueError("downlink_mode 'rest' requires downlink_api_url")
    if mode == "mqtt" and not (config or {}).get("broker_url"):
        raise ValueError(
            "downlink_mode 'mqtt' requires a broker_url in config — the same broker "
            "its uplinks arrive on"
        )


class IntegrationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, description="Human-readable name")
    provider: ProviderEnum = Field(description="LoRaWAN network server provider")
    config: dict[str, Any] = Field(default_factory=dict, description="Provider-specific config")


class MqttConfigValidator(BaseModel):
    """Validates config for chirpstack_mqtt integrations."""

    broker_url: str = Field(min_length=1, description="ChirpStack MQTT broker hostname or IP")
    port: int = Field(default=1883, ge=1, le=65535)
    username: Optional[str] = None
    password: Optional[str] = None
    tls: bool = False
    ca_cert: Optional[str] = None


class IntegrationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    config: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None
    downlink_mode: Optional[str] = Field(None, description=_DOWNLINK_MODE_DESC)
    downlink_api_url: Optional[str] = Field(
        None, description="REST base URL, for downlink_mode 'rest' only."
    )
    # Write-only. Encrypted by the column type on the way in and never returned;
    # reads get a mask, the way key_prefix already works for inbound keys.
    downlink_api_key: Optional[str] = Field(
        None, description="Outbound credential. Stored encrypted, never returned."
    )

    @model_validator(mode="after")
    def check_downlink(self) -> "IntegrationUpdate":
        _validate_downlink(self.downlink_mode, self.downlink_api_url, self.config)
        return self


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
    unknown_device_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class UnknownDeviceEntry(BaseModel):
    dev_eui: str
    first_seen: str  # ISO-8601


class UnknownDevicesResponse(BaseModel):
    integration_id: UUID
    unknown_devices: list[UnknownDeviceEntry]


def build_setup_instructions(provider: str, webhook_url: str, key_prefix: str) -> SetupInstructions:
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
