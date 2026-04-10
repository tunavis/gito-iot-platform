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
            'Payload must be JSON with: { "dev_eui": "...", "metrics": { ... } }',
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
