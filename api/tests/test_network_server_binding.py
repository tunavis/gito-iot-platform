"""Which network server a downlink goes to — and that it never goes to the wrong one.

The defect being closed: dispatch read one global `CHIRPSTACK_API_URL`, so a
fleet spread across two network servers had half its commands posted to the
wrong queue and reported `sent`. Uplinks were already per-integration; only
dispatch was not.

The assertion that matters most is the *negative* one — that a device whose
binding cannot be resolved has nothing posted anywhere. A wrong server is worse
than a refusal, because a refusal is visible.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import base64
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.base import Device, DeviceCommand, Integration
from app.models.device_type import DeviceType
from app.services import command_dispatch as cd
from app.services import network_server as ns

TENANT = uuid.uuid4()


def _device(**kwargs) -> Device:
    return Device(**{
        "id": uuid.uuid4(),
        "tenant_id": TENANT,
        "name": "Meter",
        "attributes": {},
        "dev_eui": "e41e0a9000009390",
        "ttn_synced": True,
        **kwargs,
    })


def _command() -> DeviceCommand:
    return DeviceCommand(
        id=uuid.uuid4(), tenant_id=TENANT, device_id=uuid.uuid4(),
        command_name="get_fw_version", parameters={}, status="pending",
    )


def _integration(**kwargs) -> Integration:
    return Integration(**{
        "id": uuid.uuid4(),
        "tenant_id": TENANT,
        "name": "Testing2",
        "provider": "chirpstack_mqtt",
        "is_active": True,
        # Explicit, because the resolver now refuses to guess. These tests assert
        # the REST path unless they say otherwise.
        "downlink_mode": "rest",
        "downlink_api_url": "https://cs-a.example",
        "downlink_api_key": "key-a",
        **kwargs,
    })


def _session_returning(integration):
    """A session whose one query yields `integration` (or None)."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=integration)
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


class _FakeResponse:
    def __init__(self, status=200):
        self.status = status

    async def text(self):
        return ""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeHttpSession:
    def __init__(self, recorder):
        self._recorder = recorder

    def post(self, url, **kwargs):
        kwargs.pop("timeout", None)
        self._recorder.append((url, kwargs))
        return _FakeResponse()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


# Every real device type declares its protocol, and since phase 4 the platform
# no longer guesses when none does. So the fixtures declare one too.
LORAWAN_TYPE = DeviceType(connectivity={"protocol": "lorawan"})


async def _dispatch(device, session=None, device_type=LORAWAN_TYPE):
    posts = []
    service = cd.CommandDispatchService(redis_url="redis://unused")
    with patch.object(cd.aiohttp, "ClientSession", lambda *a, **k: _FakeHttpSession(posts)):
        ok, err = await service.dispatch(device, _command(), None, device_type, session)
    return ok, err, posts


# ── Resolution ───────────────────────────────────────────────────────────────


class TestABoundDeviceUsesItsOwnServer:
    @pytest.mark.asyncio
    async def test_the_binding_wins_over_the_platform_setting(self):
        """Task 4.2. The global setting names a different server; the binding is
        the statement of fact."""
        integration = _integration()
        device = _device(integration_id=integration.id)

        with patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", "global-key"):
            server = await ns.resolve(_session_returning(integration), device)

        assert server.api_url == "https://cs-a.example"
        assert server.api_key == "key-a"
        assert server.source == "integration:Testing2"

    @pytest.mark.asyncio
    async def test_two_devices_reach_two_servers(self):
        """Task 4.3. Without this, 'multi-instance' is asserted rather than shown."""
        a = _integration(name="A", downlink_api_url="https://cs-a.example", downlink_api_key="ka")
        b = _integration(name="B", downlink_api_url="https://cs-b.example", downlink_api_key="kb")

        ok_a, _, posts_a = await _dispatch(
            _device(integration_id=a.id), _session_returning(a)
        )
        ok_b, _, posts_b = await _dispatch(
            _device(integration_id=b.id), _session_returning(b)
        )

        assert ok_a and ok_b
        assert posts_a[0][0].startswith("https://cs-a.example")
        assert posts_b[0][0].startswith("https://cs-b.example")
        assert posts_a[0][1]["headers"]["Authorization"] == "Bearer ka"
        assert posts_b[0][1]["headers"]["Authorization"] == "Bearer kb"


class TestABindingThatCannotBeUsedRefuses:
    """Task 4.4 — and the reason this capability exists. Falling back would post
    to a real server that this device is not on."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "integration,expected",
        [
            (None, "does not exist"),
            (_integration(is_active=False), "disabled"),
            (_integration(downlink_api_url=None), "no downlink API URL"),
            (_integration(downlink_mode=None), "no downlink mode configured"),
            (_integration(downlink_mode="none"), "accepts no downlinks"),
            (_integration(downlink_mode="mqtt", config={}), "names no broker"),
        ],
    )
    async def test_nothing_is_posted_anywhere(self, integration, expected):
        device = _device(integration_id=uuid.uuid4())

        # A platform-wide default is configured and must NOT rescue this.
        with patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", "global-key"):
            ok, err, posts = await _dispatch(device, _session_returning(integration))

        assert ok is False
        assert expected in err
        assert posts == [], "a refused binding must not fall through to another server"

    @pytest.mark.asyncio
    async def test_a_binding_without_a_session_refuses_rather_than_falling_back(self):
        """Dispatch called with no session cannot read the binding. Using the
        platform default there would be the same bug by a different route."""
        device = _device(integration_id=uuid.uuid4())
        with patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", "global-key"):
            ok, err, posts = await _dispatch(device, session=None)

        assert ok is False and "without a session" in err and posts == []

    @pytest.mark.asyncio
    async def test_an_integration_from_another_tenant_is_not_found(self):
        """The query is tenant-scoped explicitly — RLS is inert under the app's
        database role, so this is the check and not a second line of defence."""
        device = _device(integration_id=uuid.uuid4())
        session = _session_returning(None)  # cross-tenant row filtered out by the WHERE
        with pytest.raises(ns.NetworkServerUnresolved, match="does not exist in this tenant"):
            await ns.resolve(session, device)


class TestAnUnboundDeviceIsUnchanged:
    """Task 4.1 — the test that lets this ship. 68 live devices are unbound."""

    @pytest.mark.asyncio
    async def test_the_platform_setting_still_works(self):
        device = _device()
        with patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", "global-key"):
            server = await ns.resolve(_session_returning(None), device)
        assert server.api_url == "https://global.example"
        assert server.source == "platform_setting"
        # The pre-binding path always spoke REST; that is what it keeps speaking.
        assert server.mode == ns.MODE_REST

    @pytest.mark.asyncio
    async def test_device_attributes_still_win_over_the_setting(self):
        device = _device(attributes={
            "chirpstack_server": "https://per-device.example",
            "chirpstack_api_key": "per-device-key",
        })
        with patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"):
            server = await ns.resolve(_session_returning(None), device)
        assert server.api_url == "https://per-device.example"
        assert server.source == "device_attributes"

    @pytest.mark.asyncio
    async def test_nothing_configured_at_all_still_says_so(self):
        device = _device()
        with patch.object(ns.settings, "CHIRPSTACK_API_URL", ""), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", ""):
            with pytest.raises(ns.NetworkServerUnresolved, match="not configured"):
                await ns.resolve(_session_returning(None), device)

    @pytest.mark.asyncio
    async def test_the_frame_on_the_wire_is_unchanged_by_any_of_this(self):
        """Resolution decides *where*, never *what*. The queued bytes must be
        identical whether the server came from a binding or the setting."""
        integration = _integration()
        bound = _device(integration_id=integration.id)
        unbound = _device()

        _, _, bound_posts = await _dispatch(bound, _session_returning(integration))
        with patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", "global-key"):
            _, _, unbound_posts = await _dispatch(unbound, _session_returning(None))

        def frame(posts):
            item = dict(posts[0][1]["json"]["queueItem"])
            body = json.loads(base64.b64decode(item.pop("data")))
            # Each dispatch mints its own command, so the correlation id differs
            # by design. Everything that describes the *frame* must not.
            assert body.pop("command_id")
            return item, body

        assert frame(bound_posts) == frame(unbound_posts)
        item, body = frame(bound_posts)
        assert item == {"fPort": 201, "confirmed": False}
        assert body == {"type": "command", "command": "get_fw_version", "parameters": {}}


# ── The MQTT downlink path ───────────────────────────────────────────────────


class _FakeRedis:
    def __init__(self, listeners=1):
        self.published: list[tuple[str, str]] = []
        self._listeners = listeners

    async def publish(self, channel, message):
        self.published.append((channel, message))
        return self._listeners

    async def aclose(self):
        pass


async def _dispatch_mqtt(device, integration, listeners=1, driver=None):
    redis = _FakeRedis(listeners)
    posts = []
    service = cd.CommandDispatchService(redis_url="redis://unused")
    with patch.object(cd.aioredis, "from_url", new=AsyncMock(return_value=redis)), \
         patch.object(cd.aiohttp, "ClientSession", lambda *a, **k: _FakeHttpSession(posts)):
        ok, err = await service.dispatch(
            device, _command(), driver, LORAWAN_TYPE, _session_returning(integration)
        )
    return ok, err, redis.published, posts


MQTT_INTEGRATION = dict(
    downlink_mode="mqtt",
    downlink_api_url=None,
    downlink_api_key=None,
    config={"broker_url": "mqtt.cordys.co.za", "port": 2883, "tls": False},
)

APP_ID = "3c815fb6-cc9c-495e-97c6-e7b3ccf4e1bd"


class TestTheMQTTDownlinkPath:
    """ChirpStack's MQTT integration is bidirectional — it subscribes to
    `.../command/down` on the same broker it publishes uplinks to. So this path
    needs no API token at all, which matters because that token would carry
    authority over every device on the server."""

    @pytest.mark.asyncio
    async def test_it_queues_for_the_bridge_and_posts_to_no_rest_api(self):
        integration = _integration(**MQTT_INTEGRATION)
        device = _device(integration_id=integration.id, ttn_app_id=APP_ID)

        ok, err, published, posts = await _dispatch_mqtt(device, integration)

        assert (ok, err) == (True, "")
        assert posts == [], "the MQTT path must not touch the REST API"
        assert len(published) == 1
        channel, message = published[0]
        assert channel == f"chirpstack-downlink:{integration.id}"

        body = json.loads(message)
        assert body["application_id"] == APP_ID
        assert body["dev_eui"] == "e41e0a9000009390"
        assert body["f_port"] == 201 and body["confirmed"] is False
        # The frame is whatever the encoder produced; the transport does not
        # touch it.
        assert base64.b64decode(body["data"])

    @pytest.mark.asyncio
    async def test_the_driver_supplies_the_port_and_confirmed_flag(self):
        """Both B METERS families use fPort 1, not the platform's default 201."""
        driver = {
            "transport": {
                "mode": "payload", "protocol": "lorawan",
                "lorawan": {"f_port": 1, "confirmed": True},
            },
            "commands": {"mode": "passthrough_json"},
        }
        integration = _integration(**MQTT_INTEGRATION)
        device = _device(integration_id=integration.id, ttn_app_id=APP_ID)

        _, _, published, _ = await _dispatch_mqtt(device, integration, driver=driver)
        body = json.loads(published[0][1])
        assert body["f_port"] == 1 and body["confirmed"] is True

    @pytest.mark.asyncio
    async def test_a_device_with_no_application_is_refused_not_guessed(self):
        """The topic cannot be formed without it, and guessing would publish
        into some other application on the same broker."""
        integration = _integration(**MQTT_INTEGRATION)
        device = _device(integration_id=integration.id, ttn_app_id=None)

        ok, err, published, _ = await _dispatch_mqtt(device, integration)
        assert ok is False
        assert "no network-server application recorded" in err
        assert published == []

    @pytest.mark.asyncio
    async def test_no_connected_bridge_is_reported_not_swallowed(self):
        """Redis pub/sub does not retain a message with no subscriber. Reporting
        `sent` when nobody was listening would be the clearest possible lie."""
        integration = _integration(**MQTT_INTEGRATION)
        device = _device(integration_id=integration.id, ttn_app_id=APP_ID)

        ok, err, published, _ = await _dispatch_mqtt(device, integration, listeners=0)
        assert ok is False
        assert "No connected bridge" in err and "does not retain" in err

    @pytest.mark.asyncio
    async def test_each_integration_gets_its_own_channel(self):
        """One channel per integration is what lets a bridge subscribe only to
        its own downlinks — a bridge cannot publish to another server's broker."""
        a = _integration(name="A", **MQTT_INTEGRATION)
        b = _integration(name="B", **MQTT_INTEGRATION)
        _, _, pub_a, _ = await _dispatch_mqtt(
            _device(integration_id=a.id, ttn_app_id=APP_ID), a
        )
        _, _, pub_b, _ = await _dispatch_mqtt(
            _device(integration_id=b.id, ttn_app_id=APP_ID), b
        )
        assert pub_a[0][0] != pub_b[0][0]
        assert pub_a[0][0].endswith(str(a.id)) and pub_b[0][0].endswith(str(b.id))


# ── OTA shares the binding, and `none` refuses before a row exists ───────────


class TestFirmwareResolvesTheSameWay:
    """Task 6.8. OTA and commands share one transport, so they must not disagree
    about where a device is — a firmware image posted to the wrong network
    server is the same defect with a larger blast radius."""

    @pytest.mark.asyncio
    async def test_ota_uses_the_devices_own_server(self):
        from app.services import ota_dispatch as ota

        integration = _integration(name="A", downlink_api_url="https://cs-a.example",
                                   downlink_api_key="ka")
        device = _device(integration_id=integration.id)
        posts = []

        with patch.object(ota.aiohttp, "ClientSession", lambda *a, **k: _FakeHttpSession(posts)), \
             patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", "global-key"):
            ok, err = await ota.OTADispatchService().dispatch(
                device=device, firmware_url="https://fw", firmware_hash="h",
                firmware_version="1.0", session=_session_returning(integration),
                device_type=LORAWAN_TYPE,
            )

        assert (ok, err) == (True, "")
        assert posts[0][0].startswith("https://cs-a.example")
        assert posts[0][1]["headers"]["Authorization"] == "Bearer ka"

    @pytest.mark.asyncio
    async def test_ota_over_mqtt_says_it_is_not_implemented(self):
        """OTA payloads are not driver-encoded and have no MQTT shape yet. Saying
        so beats posting to the REST default, which for an mqtt-bound device is a
        different server entirely."""
        from app.services import ota_dispatch as ota

        integration = _integration(**MQTT_INTEGRATION)
        device = _device(integration_id=integration.id, ttn_app_id=APP_ID)
        posts = []
        with patch.object(ota.aiohttp, "ClientSession", lambda *a, **k: _FakeHttpSession(posts)):
            ok, err = await ota.OTADispatchService().dispatch(
                device=device, firmware_url="https://fw", firmware_hash="h",
                firmware_version="1.0", session=_session_returning(integration),
                device_type=LORAWAN_TYPE,
            )
        assert ok is False and "not implemented" in err and posts == []

    @pytest.mark.asyncio
    async def test_ota_on_a_bound_device_without_a_session_refuses(self):
        from app.services import ota_dispatch as ota

        device = _device(integration_id=uuid.uuid4())
        posts = []
        with patch.object(ota.aiohttp, "ClientSession", lambda *a, **k: _FakeHttpSession(posts)), \
             patch.object(ns.settings, "CHIRPSTACK_API_URL", "https://global.example"), \
             patch.object(ns.settings, "CHIRPSTACK_API_KEY", "global-key"):
            ok, err = await ota.OTADispatchService().dispatch(
                device=device, firmware_url="https://fw", firmware_hash="h",
                firmware_version="1.0", device_type=LORAWAN_TYPE,
            )
        assert ok is False and "without a session" in err and posts == []


class TestAReceiveOnlyServerRefusesBeforeARowExists:
    """Task 6.6. The command must never enter the lifecycle, because a pending
    command expires and is recorded as the device's silence."""

    @pytest.mark.asyncio
    async def test_the_guard_raises_a_conflict(self):
        from fastapi import HTTPException

        from app.routers import commands as router

        device = _device(integration_id=uuid.uuid4())
        integration = _integration(downlink_mode="none")

        with pytest.raises(HTTPException) as e:
            await router._assert_reachable(_session_returning(integration), device)
        assert e.value.status_code == 409
        assert "accepts no downlinks" in str(e.value.detail)

    @pytest.mark.asyncio
    async def test_other_resolution_faults_are_left_to_dispatch(self):
        """A missing or disabled server is a fault to fix, and its reason belongs
        on the command row where an operator will see it — not as a 409 that
        leaves no record at all."""
        from app.routers import commands as router

        device = _device(integration_id=uuid.uuid4())
        await router._assert_reachable(_session_returning(None), device)  # must not raise

    @pytest.mark.asyncio
    async def test_an_unbound_device_passes_the_guard(self):
        from app.routers import commands as router

        await router._assert_reachable(_session_returning(None), _device())
