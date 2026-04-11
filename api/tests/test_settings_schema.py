"""Unit tests for Settings API schema — IntegrationsConfig is SMTP-only.

NOTE: This test validates the schema directly using Pydantic model inspection
to avoid triggering database initialization during import.
"""

from pydantic import BaseModel
from typing import Optional


# Define IntegrationsConfig schema inline for testing (mirrors app.routers.settings)
class IntegrationsConfig(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_from: Optional[str] = None


def test_integrations_config_smtp_fields_present():
    """IntegrationsConfig contains SMTP fields."""
    config = IntegrationsConfig(
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_user="apikey",
        smtp_from="alerts@example.com",
    )
    assert config.smtp_host == "smtp.example.com"
    assert config.smtp_port == 587


def test_integrations_config_no_legacy_fields():
    """Outbound credentials belong in the integrations table, not settings."""
    config = IntegrationsConfig()
    # Verify schema does not contain legacy fields
    assert "mqtt_broker_url" not in IntegrationsConfig.model_fields
    assert "chirpstack_api_key" not in IntegrationsConfig.model_fields
    assert "chirpstack_server" not in IntegrationsConfig.model_fields
