"""Unit tests for integration schemas — provider enum and setup instructions."""

import pytest
from pydantic import ValidationError
from app.schemas.integration import (
    IntegrationCreate,
    ProviderEnum,
    build_setup_instructions,
)


def test_mqtt_provider_accepted():
    body = IntegrationCreate(name="My MQTT", provider=ProviderEnum.mqtt, config={})
    assert body.provider == ProviderEnum.mqtt


def test_http_provider_accepted():
    body = IntegrationCreate(name="My HTTP", provider=ProviderEnum.http, config={})
    assert body.provider == ProviderEnum.http


def test_invalid_provider_rejected():
    with pytest.raises(ValidationError):
        IntegrationCreate(name="Bad", provider="fakelowan", config={})


def test_build_setup_instructions_mqtt():
    instructions = build_setup_instructions("mqtt", "mqtt://iot.gito.co.za:1883", "gito_ik_abc1")
    assert instructions.provider_name == "MQTT"
    assert len(instructions.steps) > 0
    assert any("mqtt://iot.gito.co.za:1883" in s for s in instructions.steps)


def test_build_setup_instructions_http():
    instructions = build_setup_instructions(
        "http",
        "https://iot.gito.co.za/api/v1/ingest/http",
        "gito_ik_abc1",
    )
    assert instructions.provider_name == "HTTP Ingest"
    assert len(instructions.steps) > 0
