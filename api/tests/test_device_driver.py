"""The driver model, verified without a network server.

Every assertion here is against bytes, a status, or a refusal — no ChirpStack,
no broker, no database. That is deliberate: the ChirpStack environment is on
another network, and a test suite that needed it would not run at all.

The tests are ordered by what they protect:

1. The manuals' own worked examples, byte for byte. If the encoder is wrong,
   these are what catch it, and they cost nothing to run.
2. That a device type with **no driver** is dispatched exactly as it was before
   this change existed, on all three transports. This is the test that lets
   phase 1 ship: 68 live meters depend on the answer being "identical".
3. That an unknown protocol refuses instead of publishing to MQTT.
4. That timing and the unacknowledgeable terminal state come from the driver.
5. **The criterion test** — a third, fictional vendor with a third header shape,
   onboarded by declaration alone. If that one ever needs a source change, the
   whole change has failed regardless of how well B METERS works.
6. Phase 2: that absorbing `device_types.decoder` into `driver.telemetry` is a
   move and not a rewrite, and that a device's own dialect of "yes" or "no" is
   read from its declaration. The correlation *write* is the processor's, and is
   tested in `processor/tests/test_driver_ack_correlation.py`.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.models.base import Device, DeviceCommand
from app.models.device_type import DeviceType
from app.routers import commands as commands_router
from app.services import command_dispatch as cd
from payload_codec import decode, encode
from payload_codec.driver import (
    DriverError,
    command_opcode,
    encode_command,
    is_unacknowledgeable,
    lorawan_params,
    parse_acknowledgement,
    response_window_seconds,
    telemetry_spec,
    validate_driver,
)
from app.services.ota_dispatch import UnsupportedProtocolError, _detect_protocol

DRIVERS_DIR = Path(__file__).resolve().parents[2] / "drivers"


def _load(name: str) -> dict:
    return json.loads((DRIVERS_DIR / name).read_text(encoding="utf-8"))


IWM = _load("b-meters-iwm-lr3-lr4.json")
RFM = _load("b-meters-rfm-lr1.json")


def _device(**kwargs) -> Device:
    defaults = {
        "id": uuid.uuid4(),
        "tenant_id": uuid.uuid4(),
        "name": "Meter-1",
        "attributes": {},
        "dev_eui": "0011223344556677",
        "ttn_synced": True,
    }
    return Device(**{**defaults, **kwargs})


def _command(name: str, parameters: dict | None = None) -> DeviceCommand:
    return DeviceCommand(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        device_id=uuid.uuid4(),
        command_name=name,
        parameters=parameters or {},
        status="pending",
    )


# ── Fake transports ──────────────────────────────────────────────────────────
#
# Small hand-written doubles rather than mocks, because these tests assert on
# what was *sent*, and a mock that records a call tells you the call happened
# without telling you what went on the wire.


class _FakeRedis:
    def __init__(self):
        self.published: list[tuple[str, str]] = []

    async def publish(self, channel, message):
        self.published.append((channel, message))

    async def aclose(self):
        pass


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


async def _dispatch_capture(device, command, driver=None, device_type=None, session=None):
    """Dispatch for real, with the two transports replaced by recorders.

    Returns (success, error, redis_publishes, http_posts).
    """
    redis = _FakeRedis()
    posts: list[tuple[str, dict]] = []
    service = cd.CommandDispatchService(redis_url="redis://unused")

    with patch.object(
        cd.aioredis, "from_url", new=AsyncMock(return_value=redis)
    ), patch.object(cd.aiohttp, "ClientSession", lambda *a, **k: _FakeHttpSession(posts)):
        success, error = await service.dispatch(device, command, driver, device_type, session)

    return success, error, redis.published, posts


# ── 1. The manuals' worked examples ──────────────────────────────────────────


class TestTheManualsWorkedExamples:
    """Task 2.5. Every frame here is quoted from a vendor manual.

    The IWM `0x26` examples are deliberately absent: the research found them
    internally inconsistent (one encodes a 33,685,504 mV battery threshold
    against a documented 2200 mV default), so asserting against them would be
    asserting the vendor's typo.
    """

    @pytest.mark.parametrize(
        "command_name,parameters,expected",
        [
            # RFM-LR1, manual p.8 — all seven decode cleanly.
            ("set_status", {"keep_mask": 0x00}, "012000"),
            ("set_reporting_interval", {"minutes": 1440}, "012205a0"),
            ("query_back_flow_volume", {}, "0227"),
            ("reset_device", {}, "0305"),
            ("query_volume", {}, "0221"),
            ("query_status", {}, "0220"),
            ("set_starting_value", {"litres": 5944}, "01250000_1738".replace("_", "")),
        ],
    )
    def test_rfm_downlinks(self, command_name, parameters, expected):
        assert encode_command(RFM, command_name, parameters).hex() == expected

    @pytest.mark.parametrize(
        "command_name,parameters,expected",
        [
            # IWM-LR3/LR4, manual p.21.
            ("get_fw_version", {}, "0700000000"),
            ("reset", {}, "0a0000000104"),
            (
                "set_revolution_counters",
                {"forward_counter": 864, "reset_backward": 0},
                "160000000604000003_6000".replace("_", ""),
            ),
            ("set_alarm_data", {"alarm_flags": 0}, "290000000504_00000000".replace("_", "")),
        ],
    )
    def test_iwm_downlinks(self, command_name, parameters, expected):
        assert encode_command(IWM, command_name, parameters).hex() == expected

    def test_one_vendors_two_families_disagree_on_0x0a(self):
        """The row that settles why the unit of declaration is the device type.

        `0x0A` resets an IWM's microcontroller and reads an RFM's CPU
        temperature. A flat opcode table shared across a vendor would not be
        untidy, it would reset meters that were asked for a temperature.
        """
        assert encode_command(IWM, "reset", {})[0] == 0x0A
        assert encode_command(RFM, "query_cpu_temperature", {})[1] == 0x0A

    def test_the_repos_driver_files_are_valid(self):
        """Whatever ships in `drivers/` must pass the validator that guards writes."""
        for path in sorted(DRIVERS_DIR.glob("*.json")):
            validate_driver(json.loads(path.read_text(encoding="utf-8")))

    def test_a_caller_cannot_reach_the_opcode(self):
        """`parameters` is caller-supplied. If it could overwrite a constant,
        "set the reporting interval" would be "send any frame I name"."""
        with pytest.raises(DriverError, match="fixed by the driver"):
            encode_command(RFM, "set_reporting_interval", {"index": 0x05, "minutes": 60})

    def test_an_undefined_command_is_refused_not_guessed(self):
        with pytest.raises(DriverError, match="not defined"):
            encode_command(RFM, "open_valve", {})


# ── 2. No driver means exactly today's behaviour ─────────────────────────────


class TestADeviceTypeWithNoDriverIsUnchanged:
    """Task 4.1 — the test that lets phase 1 ship.

    Sixty-eight live meters run through this path. Every assertion below is
    against the literal payload this platform sent before drivers existed.
    """

    def _legacy_payload(self, command: DeviceCommand) -> dict:
        return {
            "type": "command",
            "command_id": str(command.id),
            "command": command.command_name,
            "parameters": command.parameters,
        }

    @pytest.mark.asyncio
    async def test_mqtt_publishes_the_same_json_on_the_same_channel(self):
        device = _device(dev_eui=None, ttn_synced=False)
        command = _command("reboot", {"delay": 5})

        ok, err, published, _ = await _dispatch_capture(device, command)

        assert (ok, err) == (True, "")
        assert len(published) == 1
        channel, message = published[0]
        assert channel == f"{device.tenant_id}/devices/{device.id}/commands"
        assert json.loads(message) == self._legacy_payload(command)

    @pytest.mark.asyncio
    async def test_http_posts_the_same_json_body(self):
        device = _device(
            dev_eui=None, ttn_synced=False, attributes={"webhook_url": "https://device.test/cmd"}
        )
        command = _command("reboot", {"delay": 5})

        ok, err, _, posts = await _dispatch_capture(device, command)

        assert (ok, err) == (True, "")
        assert len(posts) == 1
        url, kwargs = posts[0]
        assert url == "https://device.test/cmd"
        assert kwargs == {"json": self._legacy_payload(command)}

    @pytest.mark.asyncio
    async def test_lorawan_still_sends_base64_json_on_fport_201_unconfirmed(self):
        device = _device(
            attributes={"chirpstack_server": "https://cs.test", "chirpstack_api_key": "k"}
        )
        command = _command("reboot", {"delay": 5})

        ok, err, _, posts = await _dispatch_capture(device, command)

        assert (ok, err) == (True, "")
        item = posts[0][1]["json"]["queueItem"]
        assert item["fPort"] == 201, "fPort 201 was the pre-driver default and must stay it"
        assert item["confirmed"] is False
        assert json.loads(base64.b64decode(item["data"])) == self._legacy_payload(command)

    @pytest.mark.asyncio
    async def test_passthrough_json_is_byte_identical_to_no_driver_at_all(self):
        """Task 2.3. An explicit `passthrough_json` codec and no driver must
        produce the same bytes — otherwise "opt in without changing anything"
        is not a thing a device type can express."""
        device = _device(
            attributes={"chirpstack_server": "https://cs.test", "chirpstack_api_key": "k"}
        )
        command = _command("reboot", {"delay": 5})
        driver = {
            "transport": {"mode": "payload", "protocol": "lorawan"},
            "commands": {"mode": "passthrough_json"},
        }
        validate_driver(driver)

        _, _, _, without = await _dispatch_capture(device, command)
        _, _, _, with_driver = await _dispatch_capture(device, command, driver)

        assert with_driver[0][1]["json"] == without[0][1]["json"]

    def test_every_driver_accessor_answers_for_a_missing_driver(self):
        """Absence is the compatibility guarantee, so no accessor may need one."""
        assert encode_command(None, "anything", {}) is None
        assert lorawan_params(None) == (201, False)
        assert response_window_seconds(None, 60) == 60
        assert is_unacknowledgeable(None, "reset") is False


# ── 3. An unknown protocol fails loudly ──────────────────────────────────────


class TestAnUnknownProtocolRefusesRatherThanDefaulting:
    """Task 4.3. Before this, a device type declaring `modbus` had its commands
    published to an MQTT channel and reported as sent."""

    def test_a_declared_undispatchable_protocol_raises(self):
        device_type = DeviceType(connectivity={"protocol": "modbus"})
        with pytest.raises(UnsupportedProtocolError, match="modbus"):
            _detect_protocol(_device(), None, device_type)

    @pytest.mark.asyncio
    async def test_nothing_is_published_to_any_other_transport(self):
        device_type = DeviceType(connectivity={"protocol": "modbus"})

        ok, err, published, posts = await _dispatch_capture(
            _device(), _command("reboot"), None, device_type
        )

        assert ok is False
        assert "modbus" in err
        assert published == [] and posts == []

    def test_the_declaration_beats_the_heuristics(self):
        """A device with a synced dev_eui would be inferred as LoRaWAN. The
        driver says MQTT, and the driver is the statement of fact."""
        driver = {"transport": {"mode": "payload", "protocol": "mqtt"}}
        assert _detect_protocol(_device(), driver) == "mqtt"

    def test_the_driver_beats_the_device_type(self):
        driver = {"transport": {"mode": "payload", "protocol": "http"}}
        device_type = DeviceType(connectivity={"protocol": "mqtt"})
        assert _detect_protocol(_device(), driver, device_type) == "http"

    def test_a_type_with_neither_still_gets_the_old_heuristics(self):
        assert _detect_protocol(_device()) == "lorawan"
        assert _detect_protocol(_device(dev_eui=None, ttn_synced=False)) == "mqtt"
        assert (
            _detect_protocol(
                _device(dev_eui=None, ttn_synced=False, attributes={"webhook_url": "https://x"})
            )
            == "http"
        )


# ── 4. Timing and the honest terminal state ──────────────────────────────────


class TestTimingComesFromTheDevice:
    """Task 4.4."""

    def test_the_iwm_declares_twelve_hours(self):
        assert response_window_seconds(IWM, 60) == 43200

    def test_a_twelve_hour_command_is_still_outstanding_after_an_hour(self):
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=response_window_seconds(IWM, 60))
        # The sweep's predicate, verbatim: status IN (...) AND expires_at < now().
        assert expires_at > now + timedelta(hours=1)

    def test_the_platform_default_still_applies_without_a_driver(self):
        assert response_window_seconds(None, commands_router.DEVICE_RESPONSE_TTL_SECONDS) == 60

    def test_a_window_beyond_the_ceiling_is_clamped_not_trusted(self):
        driver = {"acknowledgement": {"response_window_seconds": 10**9}}
        assert response_window_seconds(driver, 60) == 7 * 24 * 3600


class TestACommandThatCanNeverBeAnsweredReachesATerminalState:
    """Task 4.5. IWM RESET restarts the microcontroller and answers nothing.

    Without this it sits pending until the sweep records a correctly delivered
    command as `timed_out` — the system working and the records lying.
    """

    async def _dispatch_now(self, command_name: str, driver: dict | None):
        device_type = DeviceType(driver=driver, capabilities=["commands"])
        command = _command(command_name)
        session = AsyncMock()

        with patch.object(
            commands_router._dispatch, "dispatch", new=AsyncMock(return_value=(True, ""))
        ):
            return await commands_router._dispatch_now(session, _device(), command, device_type)

    @pytest.mark.asyncio
    async def test_an_unacknowledgeable_command_is_terminal_on_delivery(self):
        command = await self._dispatch_now("reset", IWM)
        assert command.status == "delivered_unconfirmed"
        assert command.completed_at is not None, "terminal means completed"

    @pytest.mark.asyncio
    async def test_it_is_excluded_from_the_sweep_by_its_status(self):
        """The sweep only touches pending/sent/delivered, so exclusion is
        structural rather than a second list that could fall out of step."""
        import inspect

        from app.services.background_tasks import NotificationBackgroundTasks

        source = inspect.getsource(NotificationBackgroundTasks.expire_timed_out_commands)
        swept = source[source.index("status IN (") : source.index("AND expires_at")]
        assert "delivered_unconfirmed" not in swept

    @pytest.mark.asyncio
    async def test_an_ordinary_command_still_becomes_sent(self):
        """The control. Without it, a bug that marked everything terminal would
        pass the test above."""
        command = await self._dispatch_now("set_alarm_data", IWM)
        assert command.status == "sent"
        assert command.completed_at is None

    @pytest.mark.asyncio
    async def test_a_type_with_no_driver_never_reaches_the_new_state(self):
        command = await self._dispatch_now("reboot", None)
        assert command.status == "sent"


# ── 5. The criterion test ────────────────────────────────────────────────────


class TestAThirdVendorIsOnboardedByDeclarationAlone:
    """Task 4.6. If this needs a source change, phase 1 failed.

    A fictional vendor with a third header shape — three bytes, little-endian
    payload, a trailing XOR-style checksum slot — sharing nothing with either
    B METERS family. It exists only in this file; no platform code knows it.
    """

    DRIVER = {
        "transport": {
            "mode": "payload",
            "protocol": "lorawan",
            "lorawan": {"f_port": 42, "confirmed": True},
        },
        "commands": {
            "mode": "declarative",
            "definitions": {
                "set_setpoint": {
                    # 3-byte header: preamble, opcode, payload length. Then a
                    # little-endian uint16 — the opposite convention to both
                    # B METERS lines — and a spare trailing byte.
                    "constants": {"preamble": 0xAA, "opcode": 0x31, "length": 3, "spare": 0},
                    "fields": [
                        {"name": "preamble", "offset": 0, "length": 1, "type": "uint8"},
                        {"name": "opcode", "offset": 1, "length": 1, "type": "uint8"},
                        {"name": "length", "offset": 2, "length": 1, "type": "uint8"},
                        {
                            "name": "setpoint",
                            "offset": 3,
                            "length": 2,
                            "type": "uint16",
                            "endian": "little",
                            "scale": 0.1,
                        },
                        {"name": "spare", "offset": 5, "length": 1, "type": "uint8"},
                    ],
                },
                "halt": {
                    "constants": {"preamble": 0xAA, "opcode": 0x99, "length": 0},
                    "fields": [
                        {"name": "preamble", "offset": 0, "length": 1, "type": "uint8"},
                        {"name": "opcode", "offset": 1, "length": 1, "type": "uint8"},
                        {"name": "length", "offset": 2, "length": 1, "type": "uint8"},
                    ],
                },
            },
        },
        "acknowledgement": {
            "mode": "echo_frame",
            "response_window_seconds": 900,
            "unacknowledgeable_commands": ["halt"],
        },
    }

    def test_it_validates(self):
        validate_driver(self.DRIVER)

    def test_it_encodes_its_own_header_and_endianness(self):
        # 12.5 / 0.1 = 125 = 0x007D, little-endian → 7d 00.
        assert encode_command(self.DRIVER, "set_setpoint", {"setpoint": 12.5}).hex() == (
            "aa31037d0000"
        )
        assert encode_command(self.DRIVER, "halt", {}).hex() == "aa9900"

    @pytest.mark.asyncio
    async def test_it_dispatches_on_its_declared_port_confirmed(self):
        device = _device(
            attributes={"chirpstack_server": "https://cs.test", "chirpstack_api_key": "k"}
        )
        device_type = DeviceType(driver=self.DRIVER, capabilities=["commands"])

        ok, err, _, posts = await _dispatch_capture(
            device, _command("set_setpoint", {"setpoint": 12.5}), self.DRIVER, device_type
        )

        assert (ok, err) == (True, "")
        item = posts[0][1]["json"]["queueItem"]
        assert item["fPort"] == 42 and item["confirmed"] is True
        assert base64.b64decode(item["data"]).hex() == "aa31037d0000"

    def test_its_timing_and_terminal_state_come_from_the_same_declaration(self):
        assert response_window_seconds(self.DRIVER, 60) == 900
        assert is_unacknowledgeable(self.DRIVER, "halt") is True
        assert is_unacknowledgeable(self.DRIVER, "set_setpoint") is False


# ── Validation refuses on write, not at 2am ──────────────────────────────────


class TestMalformedDriversAreRefusedWhenSaved:
    """Task 1.2 and 1.6."""

    @pytest.mark.parametrize(
        "driver,expected",
        [
            ({}, "transport"),
            ({"transport": {"protocol": "lorawan"}}, "transport.mode"),
            # Task 1.6: an unimplemented mode must be rejected, never silently
            # treated as "payload" — a register-map device has no message to
            # encode at all.
            (
                {"transport": {"mode": "register_map", "protocol": "mqtt"}},
                "not implemented",
            ),
            ({"transport": {"mode": "edge_gateway", "protocol": "mqtt"}}, "not implemented"),
            ({"transport": {"mode": "payload", "protocol": "modbus"}}, "transport.protocol"),
            (
                {
                    "transport": {"mode": "payload", "protocol": "lorawan"},
                    "commands": {"mode": "script", "definitions": {}},
                },
                "commands.mode",
            ),
            (
                {
                    "transport": {"mode": "payload", "protocol": "lorawan"},
                    "commands": {
                        "mode": "declarative",
                        "definitions": {
                            "x": {
                                "constants": {"nope": 1},
                                "fields": [{"name": "a", "offset": 0, "length": 1}],
                            }
                        },
                    },
                },
                "name no field",
            ),
            (
                {
                    "transport": {"mode": "payload", "protocol": "lorawan"},
                    "commands": {
                        "mode": "declarative",
                        "definitions": {
                            "x": {
                                "fields": [
                                    {"name": "a", "offset": 0, "length": 4, "type": "uint8"}
                                ]
                            }
                        },
                    },
                },
                "doesn't match type",
            ),
            (
                {
                    "transport": {"mode": "payload", "protocol": "lorawan"},
                    "acknowledgement": {"response_window_seconds": 0},
                },
                "response_window_seconds",
            ),
            (
                {
                    "transport": {"mode": "payload", "protocol": "lorawan"},
                    "lorawan_typo": {},
                    "acknowledgement": {"unacknowledgeable_commands": "reset"},
                },
                "list of strings",
            ),
        ],
    )
    def test_it_is_refused_with_a_reason(self, driver, expected):
        with pytest.raises(DriverError, match=expected):
            validate_driver(driver)

    def test_an_unacknowledgeable_name_that_matches_no_command_is_a_typo(self):
        """The one that would fail silently: a misspelt name here means the
        command that can never answer is still swept to timed_out."""
        driver = {
            "transport": {"mode": "payload", "protocol": "lorawan"},
            "commands": {
                "mode": "declarative",
                "definitions": {
                    "reset": {"fields": [{"name": "a", "offset": 0, "length": 1, "type": "uint8"}]}
                },
            },
            "acknowledgement": {"unacknowledgeable_commands": ["rest"]},
        }
        with pytest.raises(DriverError, match="not commands this driver defines"):
            validate_driver(driver)

    def test_an_absent_driver_is_valid(self):
        validate_driver(None)

    @pytest.mark.parametrize("schema", ["DeviceTypeCreate", "DeviceTypeUpdate"])
    def test_the_api_boundary_refuses_it_on_both_write_paths(self, schema):
        """Task 1.2 — the assertion that the validator is actually wired.

        `validate_driver` passing its own unit tests proves nothing about the
        write path: a driver that only one of create/update checks is a driver
        that arrives through the other one.
        """
        import pydantic

        from app.schemas import device_type as dt_schemas

        model = getattr(dt_schemas, schema)
        bad = {"transport": {"mode": "payload", "protocol": "modbus"}}
        with pytest.raises(pydantic.ValidationError, match="transport.protocol"):
            model(name="X", driver=bad)

        assert model(name="X", driver=IWM).driver == IWM
        assert model(name="X").driver is None


# ── The phase-2 boundary, asserted now rather than assumed later ─────────────


# ── 6. Phase 2: absorption, and reading a device's own dialect ───────────────

# A decoder in the shape live device types actually use — packed BCD read
# little-endian, a wM-Bus VIF exponent scaling another field, and a single alarm
# bit out of a status byte. A round trip through the simple half of the engine
# would prove nothing about the fields that are hard to move.
LIVE_DECODER = {
    "type": "declarative",
    "f_port": 2,
    "fields": [
        {"name": "vif", "offset": 0, "length": 1, "type": "uint8"},
        {
            "name": "total_volume",
            "offset": 1,
            "length": 4,
            "type": "bcd",
            "endian": "little",
            "scale_exponent_ref": "vif",
            "scale_exponent_base": 19,
        },
        {"name": "leak_alarm", "offset": 5, "length": 1, "type": "uint8", "bit": 3},
        {"name": "battery_mv", "offset": 6, "length": 2, "type": "uint16", "endian": "big"},
    ],
}

LIVE_VALUES = {"vif": 20, "total_volume": 8640, "leak_alarm": 1, "battery_mv": 3300}


class TestTheDecoderIsAbsorbedNotRewritten:
    """Tasks 5.1 and 5.2 — the gate the whole phase is held behind.

    Sixty-eight live meters decode through this path. `driver.telemetry` is
    deliberately the same spec in the same shape read by the same engine, so
    "absorbed" has to mean *identical output*, not *equivalent intent*.
    """

    def _fixture(self) -> str:
        return base64.b64encode(encode(LIVE_DECODER, LIVE_VALUES)).decode()

    def test_the_same_spec_carried_by_a_driver_decodes_identically(self):
        raw_b64 = self._fixture()
        driver = {
            "transport": {"mode": "payload", "protocol": "lorawan"},
            # The move: `type` becomes `mode`, `fields` is untouched.
            "telemetry": {"mode": "declarative", "f_port": 2, "fields": LIVE_DECODER["fields"]},
        }
        validate_driver(driver)

        from_column = decode(LIVE_DECODER, raw_b64, 2)
        from_driver = decode(telemetry_spec(driver), raw_b64, 2)

        assert from_driver == from_column
        assert from_column, "the fixture must actually decode, or this proves nothing"
        assert from_column["total_volume"] == LIVE_VALUES["total_volume"]
        assert from_column["leak_alarm"] == 1, "bit extraction survived the move"

        # And the VIF exponent is genuinely being applied, not coincidentally
        # cancelling out: the same bytes read without the cross-field reference
        # are a decalitre count, an order of magnitude out.
        plain = [
            {k: v for k, v in f.items() if not k.startswith("scale_exponent")}
            for f in LIVE_DECODER["fields"]
        ]
        unscaled = decode({"type": "declarative", "fields": plain}, raw_b64, 2)
        assert unscaled["total_volume"] == LIVE_VALUES["total_volume"] / 10

    def test_the_f_port_filter_moves_with_it(self):
        """A spec that decoded only on its own port must not start decoding on
        every port once it is carried by a driver."""
        driver = {
            "transport": {"mode": "payload", "protocol": "lorawan"},
            "telemetry": {"mode": "declarative", "f_port": 2, "fields": LIVE_DECODER["fields"]},
        }
        assert decode(telemetry_spec(driver), self._fixture(), 7) == {}
        assert decode(LIVE_DECODER, self._fixture(), 7) == {}

    def test_a_type_with_no_driver_still_has_no_telemetry_spec(self):
        """Which is why absorbing it is a no-op for the fleet: nothing live has
        a driver, so nothing live changes path."""
        assert telemetry_spec(None) is None
        assert telemetry_spec(IWM) is None, "the B METERS drivers carry no decoder yet"
        assert telemetry_spec(RFM) is None

    def test_an_unimplemented_codec_mode_yields_nothing_rather_than_guessing(self):
        """Belt and braces for a row written before validation tightened: a
        `script` telemetry codec must fall back to the column, not be handed to
        the declarative engine, which would silently decode zero fields."""
        assert telemetry_spec({"telemetry": {"mode": "script", "fields": [{"name": "x"}]}}) is None

    def test_a_malformed_telemetry_spec_is_refused_on_write(self):
        for bad in (
            {"mode": "script", "fields": [{"name": "x", "offset": 0, "length": 1}]},
            {"mode": "declarative", "fields": []},
            {"mode": "declarative", "fields": [{"name": "x", "offset": 0, "length": 9}]},
            {"mode": "declarative", "f_port": 999, "fields": [{"name": "x", "offset": 0}]},
        ):
            with pytest.raises(DriverError, match="telemetry"):
                validate_driver(
                    {"transport": {"mode": "payload", "protocol": "lorawan"}, "telemetry": bad}
                )


class TestTheCorrelationKey:
    """Task 5.3. No third-party device echoes `command_id`, so the key is the
    opcode — and it is only unambiguous with one command in flight per pair."""

    def test_each_family_names_its_own_opcode_field(self):
        assert command_opcode(IWM, "get_alarm_par") == 0x27
        assert command_opcode(IWM, "set_alarm_data") == 0x29
        assert command_opcode(RFM, "set_reporting_interval") == 0x22
        assert command_opcode(RFM, "query_back_flow_volume") == 0x27

    def test_a_set_and_its_query_share_an_opcode_on_purpose(self):
        """The RFM's Set and Query differ only in the Type byte, which its
        answer does not carry back — `01 22 05A0` could answer either. Sharing
        the opcode is what makes the in-flight index refuse to create that
        ambiguity in the first place."""
        assert command_opcode(RFM, "set_reporting_interval") == command_opcode(
            RFM, "query_reporting_interval"
        )

    def test_the_same_byte_means_different_commands_across_the_two_families(self):
        """0x27 is GET_ALARM_PAR on an IWM and Back flow volume on an RFM. The
        opcode is only a key *within* a device, which is why the index is on
        (device_id, opcode) and never on opcode alone."""
        assert command_opcode(IWM, "get_alarm_par") == command_opcode(
            RFM, "query_back_flow_volume"
        )

    def test_no_driver_reserves_no_opcode(self):
        """Reserving one that nothing will ever match would block the next
        identical command for the whole response window."""
        assert command_opcode(None, "reboot") is None
        assert (
            command_opcode(
                {
                    "transport": {"mode": "payload", "protocol": "lorawan"},
                    "commands": {"mode": "passthrough_json"},
                },
                "reboot",
            )
            is None
        )

    def test_a_driver_that_declares_no_correlation_reserves_nothing(self):
        no_ack = {k: v for k, v in RFM.items() if k != "acknowledgement"}
        validate_driver(no_ack)
        assert command_opcode(no_ack, "set_reporting_interval") is None

    def test_half_a_correlation_declaration_is_refused(self):
        """`opcode_field` without `response` reserves opcodes and matches
        nothing, so every command expires *and* blocks its successor."""
        half = {
            "transport": {"mode": "payload", "protocol": "lorawan"},
            "acknowledgement": {"mode": "echo_frame", "opcode_field": "index"},
        }
        with pytest.raises(DriverError, match="both 'opcode_field' and 'response'"):
            validate_driver(half)

    def test_a_command_with_no_opcode_constant_is_refused(self):
        driver = {
            "transport": {"mode": "payload", "protocol": "lorawan"},
            "commands": {
                "mode": "declarative",
                "definitions": {
                    "ping": {
                        "constants": {"type": 1},
                        "fields": [
                            {"name": "type", "offset": 0, "length": 1, "type": "uint8"},
                            {"name": "index", "offset": 1, "length": 1, "type": "uint8"},
                        ],
                    }
                },
            },
            "acknowledgement": {
                "mode": "echo_frame",
                "opcode_field": "index",
                "response": {"opcode_offset": 1, "kind_offset": 0, "ack_values": [1]},
            },
        }
        with pytest.raises(DriverError, match="no 'index' constant"):
            validate_driver(driver)


class TestBothConfirmationStylesAreDeclared:
    """Task 5.4, read off the drivers that actually ship in `drivers/`.

    The processor suite asserts the same behaviour against literal declarations;
    this asserts the shipped files still carry one.
    """

    def test_the_iwm_echoes_its_opcode_with_cra_one(self):
        ack = parse_acknowledgement(IWM, bytes([0x16, 0x01, 0x00, 0x00, 0x00]))
        assert ack is not None and ack.accepted and ack.opcode == 0x16

    def test_the_iwm_reports_failure_in_its_err_byte(self):
        ack = parse_acknowledgement(IWM, bytes([0x07, 0x01, 0x04, 0x00, 0x00]))
        assert ack is not None and not ack.accepted
        assert "Error length" in ack.reason

    def test_the_rfm_echoes_the_whole_frame(self):
        ack = parse_acknowledgement(RFM, bytes([0x01, 0x22, 0x05, 0xA0]))
        assert ack is not None and ack.accepted and ack.opcode == 0x22

    def test_the_rfm_has_a_real_nack(self):
        ack = parse_acknowledgement(RFM, bytes([0x02, 0x22]))
        assert ack is not None and not ack.accepted and ack.opcode == 0x22

    def test_a_driverless_device_correlates_nothing_this_way(self):
        assert parse_acknowledgement(None, bytes([0x01, 0x22])) is None

    def test_ack_and_nack_values_may_not_overlap(self):
        driver = {
            "transport": {"mode": "payload", "protocol": "lorawan"},
            "acknowledgement": {
                "mode": "echo_frame",
                "opcode_field": "index",
                "response": {
                    "opcode_offset": 1,
                    "kind_offset": 0,
                    "ack_values": [1],
                    "nack_values": [1],
                },
            },
        }
        with pytest.raises(DriverError, match="both"):
            validate_driver(driver)


class TestPhaseOneDoesNotTouchTelemetry:
    """Task 3b.3. `get_device`'s `metrics` come from the device type's
    `data_model`, not from `decoder` — so absorbing the decoder in phase 2 must
    not move them. Asserting the independence now means phase 2 has a baseline
    to break, rather than a belief to re-examine."""

    def test_a_driver_does_not_disturb_the_existing_decoder_column(self):
        device_type = DeviceType(
            data_model=[{"name": "flow_rate", "unit": "l/h"}],
            decoder={"type": "declarative", "fields": [{"name": "flow_rate", "offset": 0}]},
            driver=IWM,
        )
        assert device_type.decoder["fields"][0]["name"] == "flow_rate"
        assert device_type.data_model[0]["name"] == "flow_rate"

    def test_phase_one_reads_nothing_from_driver_telemetry(self):
        """A driver carrying a `telemetry` section must not change dispatch —
        that section is phase 2's, and phase 1 only has to not break it."""
        with_telemetry = {
            **IWM,
            "telemetry": {
                "mode": "declarative",
                "fields": [{"name": "volume", "offset": 0, "length": 4, "type": "uint32"}],
            },
        }
        validate_driver(with_telemetry)
        assert encode_command(with_telemetry, "reset", {}) == encode_command(IWM, "reset", {})


# ── The IWM alarm-data answer, decoded from real captures ────────────────────


def _frame(spaced_hex: str) -> bytes:
    """One captured frame, with its length checked rather than assumed.

    Transcribing these into unspaced hex by hand produced a 35-byte frame on the
    first attempt — the exact class of error this whole change exists to stop
    making — so the rows are kept verbatim and the `Len` byte is the check.
    """
    raw = bytes.fromhex(spaced_hex.replace(" ", ""))
    assert len(raw) == 5 + raw[4], f"frame length {len(raw)} disagrees with Len={raw[4]}"
    return raw


# Nine 0x28 GET_ALARM_DATA answers from live IWM-LR3/LR4 meters, posted to the
# ChirpStack forum in October 2024 (thread 22344). These are the evidence the
# alarm-date packing was recovered from — the manual types the dates Uint32_t
# "dd/mm/yy" and never says how that packs, and gives no worked example.
CAPTURED_0X28 = [
    _frame(f)
    for f in """
    28 01 00 00 1D 04 00 00 00 00 00 00 00 00 10 05 17 00 00 00 00 00 14 05 12 00 18 05 17 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 00 00 00 00 00 18 09 18 00 00 00 00 00 05 09 18 00 00 00 00 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 16 09 18 00 00 00 00 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 10 00 00 00 00 00 00 00 00 00 00 00 00 1A 09 18 00 19 07 17 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 12 00 00 00 00 04 05 12 00 00 00 00 00 07 09 18 00 02 06 17 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 08 00 00 00 00 18 09 18 00 00 00 00 00 1C 09 18 00 00 00 00 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 00 00 00 00 00 0F 05 17 00 00 00 00 00 1B 09 18 00 00 00 00 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 02 00 00 00 00 0F 05 17 00 00 00 00 00 1D 07 18 00 00 00 00 00 00 00 00 00
    28 01 00 00 1D 04 00 00 00 12 00 00 00 00 1A 02 18 00 00 00 00 00 17 07 18 00 03 04 18 00 00 00 00 00
    """.strip().splitlines()
]


class TestTheIWMAlarmDataAnswer:
    """The packing the manual does not document, verified where it was found.

    Nothing here asserts a value the vendor stated — the manual has no worked
    example for 0x28 at all. These assert that the recovered layout produces
    dates that are *possible*, and that the alarm flags agree with them, which
    is the only check available without the integrators' document.
    """

    ALARMS = ["magnetic", "removal", "blinding", "loss", "reverse_flow", "low_battery"]

    def _ack(self, frame: bytes):
        return parse_acknowledgement(IWM, frame)

    def test_every_captured_frame_is_read_as_a_clean_answer(self):
        for frame in CAPTURED_0X28:
            ack = self._ack(frame)
            assert ack is not None and ack.accepted
            assert ack.opcode == 0x28

    def test_every_decoded_date_is_a_possible_date(self):
        """54 date fields across nine frames. One impossible day or month would
        mean the layout is wrong, and there is no vendor example to fall back
        on — this is the whole verification."""
        checked = 0
        for frame in CAPTURED_0X28:
            p = self._ack(frame).payload
            for alarm in self.ALARMS:
                d = p[f"{alarm}_alarm_day"]
                m = p[f"{alarm}_alarm_month"]
                y = p[f"{alarm}_alarm_year"]
                checked += 1
                if (d, m, y) == (0, 0, 2000):
                    continue  # never fired
                assert 1 <= d <= 31, f"{alarm} day {d} in {frame}"
                assert 1 <= m <= 12, f"{alarm} month {m} in {frame}"
                assert 2018 <= y <= 2024, f"{alarm} year {y} in {frame}"
        assert checked == 54, f"expected 54 date fields, checked {checked}"

    def test_a_set_alarm_flag_always_has_a_date(self):
        """The independent corroboration. The flags are decoded from a different
        part of the frame than the dates, so their agreeing is evidence the
        offsets are right rather than merely plausible."""
        for frame in CAPTURED_0X28:
            p = self._ack(frame).payload
            for alarm in self.ALARMS:
                if p[f"{alarm}_alarm"]:
                    assert p[f"{alarm}_alarm_day"] > 0, f"{alarm} flagged with no date in {frame}"

    def test_a_known_frame_decodes_to_the_expected_dates(self):
        """Frame 6: flags 0x08 = Loss only, removal dated 24/09/2024, loss 28/09/2024."""
        p = self._ack(CAPTURED_0X28[5]).payload
        assert p["alarm_flags"] == 0x08
        assert (p["loss_alarm"], p["magnetic_alarm"]) == (1, 0)
        assert (p["removal_alarm_day"], p["removal_alarm_month"], p["removal_alarm_year"]) == (
            24, 9, 2024,
        )
        assert (p["loss_alarm_day"], p["loss_alarm_month"], p["loss_alarm_year"]) == (28, 9, 2024)

    def test_an_alarm_that_never_fired_reads_as_zero_not_as_a_date(self):
        p = self._ack(CAPTURED_0X28[2]).payload
        assert (p["magnetic_alarm_day"], p["magnetic_alarm_month"]) == (0, 0)
        assert p["magnetic_alarm"] == 0

    def test_an_opcode_with_no_declared_layout_yields_no_payload(self):
        """0x16's answer is header-only. Declaring nothing for it must leave the
        acknowledgement intact rather than inventing fields."""
        ack = parse_acknowledgement(IWM, bytes([0x16, 0x01, 0x00, 0x00, 0x00]))
        assert ack is not None and ack.accepted and ack.payload == {}

    def test_a_failure_answer_carries_no_payload(self):
        ack = parse_acknowledgement(IWM, bytes([0x28, 0x01, 0x04, 0x00, 0x00]))
        assert ack is not None and not ack.accepted and ack.payload == {}
