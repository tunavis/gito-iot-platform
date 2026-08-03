"""The device driver: one declaration per device type of how to speak to it.

A driver is a JSONB document on `device_types.driver`. **Absent is the
compatibility guarantee** — every function here returns "today's behaviour" for a
`None` driver, so the live fleet is untouched until someone writes one.

It lives in `payload_codec` rather than in the API because the **processor**
reads it too: uplink decoding and acknowledgement correlation happen at ingest.
A second copy of this file would be two readers of one declaration format, free
to drift, and the first symptom would be a command whose answer nobody matched.
It depends on nothing but this package's own engine.

Shape (see `openspec/changes/add-device-driver-model/design.md`):

    {
      "transport": {
        "mode": "payload",              # payload | register_map | edge_gateway
        "protocol": "lorawan",          # authoritative; replaces guessing
        "lorawan": {"f_port": 1, "confirmed": false},
        "mqtt": {"topic": "..."}        # optional; default is today's channel
      },
      "commands": {
        "mode": "declarative",          # declarative | passthrough_json
        "definitions": {
          "reset": {
            "constants": {"fct": 10, "len": 1, "device_type": 4},
            "fields": [ ... payload_codec field specs ... ]
          }
        }
      },
      "telemetry": {                    # absorbs device_types.decoder verbatim
        "mode": "declarative",
        "f_port": 2,
        "fields": [ ... the same field specs, unchanged ... ]
      },
      "acknowledgement": {
        "mode": "echo_opcode",          # echo_opcode | echo_frame | none
        "opcode_field": "fct",          # which command field carries the opcode
        "response": {                   # how to read an answer off the wire
          "opcode_offset": 0,
          "kind_offset": 1,
          "ack_values": [1],
          "nack_values": [],
          "error_offset": 2,
          "error_names": {"4": "Error length"}
        },
        "response_window_seconds": 43200,
        "unacknowledgeable_commands": ["reset"]
      },
      "receive_window": {"class": "A", "post_join_seconds": 120}
    }

Encoding is `payload_codec.encode()` — the same declarative byte-layout engine
that already decodes uplinks — with the command's constants layered over the
caller's parameters. That is deliberate rather than economical: a header is not
a special kind of thing, it is fields at offsets 0..n whose values happen to be
fixed, so a 5-byte B METERS IWM header and a 2-byte RFM header are the same
mechanism with different declarations. A third vendor with a third header shape
therefore needs no code, which is this change's acceptance criterion.

`transport.mode` is an explicit discriminator from day one. Only `payload` is
implemented; the other two are **rejected on write** rather than silently
treated as `payload`, because register/address-space protocols (Modbus, BACnet,
OPC UA…) have no message to encode at all, and discovering that as a "special
case" later is the rewrite this discriminator exists to prevent.

`telemetry` is deliberately the existing `decoder` spec unchanged, so absorbing
it is a **move rather than a translation** — `telemetry_spec()` hands the same
dict to the same `decode()` that the standalone column always did.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from dataclasses import field as dc_field
from typing import Any, Optional

from .engine import decode as decode_fields
from .engine import encode as encode_fields

# The protocols this platform can actually put a command on the wire for. Used
# both to validate a declaration and to refuse an undispatchable one at dispatch
# time — a wrong answer delivered quietly (a `modbus` device whose command is
# published to an MQTT channel) is worse than a refusal.
DISPATCHABLE_PROTOCOLS = frozenset({"mqtt", "http", "lorawan"})

TRANSPORT_MODES = frozenset({"payload", "register_map", "edge_gateway"})
IMPLEMENTED_TRANSPORT_MODES = frozenset({"payload"})

COMMAND_MODES = frozenset({"declarative", "passthrough_json"})
CODEC_MODES = frozenset({"declarative"})
ACKNOWLEDGEMENT_MODES = frozenset({"echo_opcode", "echo_frame", "none"})

# Seven days: the longest reporting interval either examined device can be set
# to (RFM-LR1 `0x22`, max 10080 minutes). A window beyond that is a typo, and a
# command that sits pending for a month is indistinguishable from a leak.
MAX_RESPONSE_WINDOW_SECONDS = 7 * 24 * 3600

# ChirpStack downlink port used before drivers existed. Kept as the default so a
# device type with no driver keeps behaving exactly as it does today.
DEFAULT_LORAWAN_F_PORT = 201


class DriverError(ValueError):
    """A driver declaration is malformed, or declares something unimplemented.

    Raised on write, never at dispatch time: a byte offset transcribed wrongly
    from a vendor manual should fail when someone saves it, not at 2am when a
    command needs to go out.
    """


@dataclass(frozen=True)
class Acknowledgement:
    """What a device's uplink says about a command it was sent.

    `opcode` is the correlation key. No third-party device echoes the platform's
    `command_id` — the IWM answers with the same `Fct` byte, the RFM with the
    same `Index` — so the outstanding command is found by (device, opcode), and
    at most one may be in flight per pair for that to be unambiguous.

    `payload` is the answer's body decoded per the driver, empty when the driver
    declares no layout for this opcode. It is kept apart from telemetry
    deliberately: an answer is not a measurement. A `GET_ALARM_DATA` reply and a
    periodic meter reading arrive on the same port with different layouts and no
    discriminator between them, so feeding answers through the telemetry decoder
    would decode one of the two as garbage.
    """

    opcode: int
    accepted: bool
    reason: Optional[str] = None
    payload: dict[str, float] = dc_field(default_factory=dict)


# ── Validation ───────────────────────────────────────────────────────────────


def validate_driver(driver: Optional[dict]) -> None:
    """Raise `DriverError` if this declaration cannot be dispatched from.

    `None` is valid and means "no driver" — see the module docstring.
    """
    if driver is None:
        return
    if not isinstance(driver, dict):
        raise DriverError("driver must be a JSON object")

    _validate_transport(driver.get("transport"))
    definitions = _validate_commands(driver.get("commands"))
    _validate_telemetry(driver.get("telemetry"))
    _validate_acknowledgement(driver.get("acknowledgement"), definitions)


def _validate_transport(transport: Any) -> None:
    if not isinstance(transport, dict):
        raise DriverError("driver.transport is required and must be an object")

    mode = transport.get("mode")
    if mode not in TRANSPORT_MODES:
        raise DriverError(
            f"driver.transport.mode must be one of {sorted(TRANSPORT_MODES)}, got {mode!r}. "
            f"It is explicit rather than defaulted so that register-map and "
            f"edge-gateway protocols are additive rather than retrofitted."
        )
    if mode not in IMPLEMENTED_TRANSPORT_MODES:
        raise DriverError(
            f"driver.transport.mode {mode!r} is declared but not implemented. Only "
            f"{sorted(IMPLEMENTED_TRANSPORT_MODES)} is supported today — a "
            f"{mode!r} device needs a point map, a poll cadence and a connection "
            f"model, none of which this declaration can express."
        )

    protocol = transport.get("protocol")
    if protocol not in DISPATCHABLE_PROTOCOLS:
        raise DriverError(
            f"driver.transport.protocol must be one of {sorted(DISPATCHABLE_PROTOCOLS)}, "
            f"got {protocol!r}."
        )

    lorawan = transport.get("lorawan")
    if lorawan is not None:
        if not isinstance(lorawan, dict):
            raise DriverError("driver.transport.lorawan must be an object")
        f_port = lorawan.get("f_port", DEFAULT_LORAWAN_F_PORT)
        if not _is_int(f_port) or not 1 <= f_port <= 223:
            raise DriverError(
                f"driver.transport.lorawan.f_port must be an integer 1-223, got {f_port!r}"
            )
        if not isinstance(lorawan.get("confirmed", False), bool):
            raise DriverError("driver.transport.lorawan.confirmed must be a boolean")

    mqtt = transport.get("mqtt")
    if mqtt is not None:
        if not isinstance(mqtt, dict):
            raise DriverError("driver.transport.mqtt must be an object")
        topic = mqtt.get("topic")
        if topic is not None and (not isinstance(topic, str) or not topic.strip()):
            raise DriverError("driver.transport.mqtt.topic must be a non-empty string")


def _validate_commands(commands: Any) -> dict[str, dict]:
    """Validate the command codec and return its definitions (possibly empty)."""
    if commands is None:
        return {}
    if not isinstance(commands, dict):
        raise DriverError("driver.commands must be an object")

    mode = commands.get("mode", "declarative")
    if mode not in COMMAND_MODES:
        # "script" lands here on purpose. It is a real mode in the design and it
        # is not implemented, because executing a vendor's JavaScript beside
        # every tenant's data is a sandbox decision that has not been made yet.
        raise DriverError(
            f"driver.commands.mode must be one of {sorted(COMMAND_MODES)}, got {mode!r}."
        )

    if mode == "passthrough_json":
        return {}

    definitions = commands.get("definitions")
    if not isinstance(definitions, dict) or not definitions:
        raise DriverError("driver.commands.definitions must be a non-empty object")

    for name, definition in definitions.items():
        _validate_definition(name, definition)
    return definitions


def _validate_definition(name: str, definition: Any) -> None:
    if not isinstance(definition, dict):
        raise DriverError(f"command {name!r}: definition must be an object")

    field_names = _validate_fields(f"command {name!r}", definition.get("fields"))

    constants = definition.get("constants", {})
    if not isinstance(constants, dict):
        raise DriverError(f"command {name!r}: 'constants' must be an object")
    unknown = set(constants) - field_names
    if unknown:
        raise DriverError(
            f"command {name!r}: constants {sorted(unknown)} name no field in this "
            f"command. A constant that lands nowhere is a typo that would encode "
            f"a frame missing its opcode."
        )


def _validate_fields(where: str, fields: Any) -> set[str]:
    """Structurally check a field list, and return the names it defines."""
    if not isinstance(fields, list) or not fields:
        raise DriverError(f"{where}: 'fields' must be a non-empty list")

    names = set()
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get("name"), str):
            raise DriverError(f"{where}: every field needs a string 'name'")
        names.add(field["name"])

    # Encode the whole layout with every field supplied, so a bad offset, an
    # unknown type, a length that disagrees with its type or an out-of-range bit
    # index fails here rather than at dispatch.
    #
    # Each field is probed with its own `value_offset` rather than with 0, so
    # that the value written to the buffer is always raw 0 — which fits every
    # type this engine supports. Probing with a flat 0 rejected any field with a
    # positive offset (a year stored as 24 but reported as 2024 encodes to -2000
    # and does not fit a uint8), which is a valid spec the validator has no
    # business refusing.
    probe = {
        f["name"]: 0 if f.get("bit") is not None else _probe_value(f) for f in fields
    }
    try:
        encode_fields({"type": "declarative", "fields": fields}, probe)
    except ValueError as e:
        raise DriverError(f"{where}: {e}") from e
    return names


def _probe_value(field: dict) -> float:
    """The value that encodes to raw zero for this field. See `_validate_fields`."""
    try:
        return float(field.get("value_offset", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def _validate_telemetry(telemetry: Any) -> None:
    """Validate the uplink half — the absorbed `decoder`, in the same shape."""
    if telemetry is None:
        return
    if not isinstance(telemetry, dict):
        raise DriverError("driver.telemetry must be an object")

    mode = telemetry.get("mode", "declarative")
    if mode not in CODEC_MODES:
        raise DriverError(
            f"driver.telemetry.mode must be one of {sorted(CODEC_MODES)}, got {mode!r}."
        )

    f_port = telemetry.get("f_port")
    ports = f_port if isinstance(f_port, list) else [f_port]
    if f_port is not None and not all(_is_int(p) and 0 <= p <= 223 for p in ports):
        raise DriverError("driver.telemetry.f_port must be an integer 0-223, or a list of them")

    _validate_fields("driver.telemetry", telemetry.get("fields"))


def _validate_acknowledgement(ack: Any, definitions: dict[str, dict]) -> None:
    if ack is None:
        return
    if not isinstance(ack, dict):
        raise DriverError("driver.acknowledgement must be an object")

    mode = ack.get("mode", "none")
    if mode not in ACKNOWLEDGEMENT_MODES:
        raise DriverError(
            f"driver.acknowledgement.mode must be one of {sorted(ACKNOWLEDGEMENT_MODES)}, "
            f"got {mode!r}."
        )

    window = ack.get("response_window_seconds")
    if window is not None and (not _is_int(window) or not 1 <= window <= MAX_RESPONSE_WINDOW_SECONDS):
        raise DriverError(
            f"driver.acknowledgement.response_window_seconds must be an integer "
            f"1-{MAX_RESPONSE_WINDOW_SECONDS}, got {window!r}"
        )

    unacknowledgeable = ack.get("unacknowledgeable_commands", [])
    if not isinstance(unacknowledgeable, list) or not all(
        isinstance(n, str) for n in unacknowledgeable
    ):
        raise DriverError(
            "driver.acknowledgement.unacknowledgeable_commands must be a list of strings"
        )
    if definitions:
        unknown = set(unacknowledgeable) - set(definitions)
        if unknown:
            raise DriverError(
                f"unacknowledgeable_commands names {sorted(unknown)}, which are not "
                f"commands this driver defines. A typo here means a command that "
                f"can never answer is still swept to timed_out."
            )

    _validate_correlation(ack, definitions)


def _validate_correlation(ack: dict, definitions: dict[str, dict]) -> None:
    """`opcode_field` and `response` are both-or-neither.

    Half of a correlation declaration is worse than none: the platform would
    reserve an opcode per command and then never match an answer to it, so every
    command would still expire, and the reserved opcode would refuse the next
    identical command for the whole response window.
    """
    opcode_field = ack.get("opcode_field")
    response = ack.get("response")

    if (opcode_field is None) != (response is None):
        raise DriverError(
            "driver.acknowledgement needs both 'opcode_field' and 'response', or "
            "neither. One without the other correlates nothing while still "
            "reserving opcodes."
        )
    if opcode_field is None:
        return

    if not isinstance(opcode_field, str):
        raise DriverError("driver.acknowledgement.opcode_field must be a string")
    for name, definition in definitions.items():
        if opcode_field not in (definition.get("constants") or {}):
            raise DriverError(
                f"command {name!r} has no {opcode_field!r} constant, so it has no "
                f"opcode to correlate its answer by. Every command needs one once "
                f"the driver declares correlation."
            )

    if not isinstance(response, dict):
        raise DriverError("driver.acknowledgement.response must be an object")

    for key in ("opcode_offset", "kind_offset"):
        if not _is_int(response.get(key)) or response[key] < 0:
            raise DriverError(f"driver.acknowledgement.response.{key} must be a byte offset >= 0")

    ack_values = _byte_list(response, "ack_values", required=True)
    nack_values = _byte_list(response, "nack_values", required=False)
    overlap = set(ack_values) & set(nack_values)
    if overlap:
        raise DriverError(
            f"driver.acknowledgement.response: {sorted(overlap)} appears in both "
            f"ack_values and nack_values, so an answer would mean both accepted "
            f"and refused."
        )

    error_offset = response.get("error_offset")
    if error_offset is not None and (not _is_int(error_offset) or error_offset < 0):
        raise DriverError(
            "driver.acknowledgement.response.error_offset must be a byte offset >= 0"
        )

    # Per-opcode layouts for the answer's body. Optional: a driver can correlate
    # commands without being able to read what came back, which is where the IWM
    # sat until its alarm-date packing was recovered from real captures.
    payloads = response.get("payloads")
    if payloads is not None:
        if not isinstance(payloads, dict):
            raise DriverError(
                "driver.acknowledgement.response.payloads must map an opcode to a field spec"
            )
        for key, spec in payloads.items():
            if _parse_byte_key(key) is None:
                raise DriverError(
                    f"driver.acknowledgement.response.payloads key {key!r} is not a byte value"
                )
            if not isinstance(spec, dict):
                raise DriverError(f"payload spec for opcode {key} must be an object")
            _validate_fields(f"driver.acknowledgement.response.payloads[{key}]", spec.get("fields"))

    error_names = response.get("error_names")
    if error_names is not None:
        if not isinstance(error_names, dict) or not all(
            isinstance(v, str) for v in error_names.values()
        ):
            raise DriverError(
                "driver.acknowledgement.response.error_names must map an error byte "
                "to a human-readable reason"
            )
        for key in error_names:
            try:
                int(str(key), 0)
            except (TypeError, ValueError) as e:
                raise DriverError(
                    f"driver.acknowledgement.response.error_names key {key!r} is not a "
                    f"byte value"
                ) from e


def _byte_list(response: dict, key: str, *, required: bool) -> list[int]:
    values = response.get(key)
    if values is None:
        if required:
            raise DriverError(f"driver.acknowledgement.response.{key} is required")
        return []
    if not isinstance(values, list) or (required and not values):
        raise DriverError(f"driver.acknowledgement.response.{key} must be a non-empty list")
    if not all(_is_int(v) and 0 <= v <= 255 for v in values):
        raise DriverError(f"driver.acknowledgement.response.{key} must contain byte values 0-255")
    return values


def _is_int(value: Any) -> bool:
    """`bool` is an `int` in Python, and `True` is not a byte offset."""
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_byte_key(key: Any) -> Optional[int]:
    """A JSON object key naming a byte — `"0x28"` or `"40"` — or None."""
    try:
        value = int(str(key), 0)
    except (TypeError, ValueError):
        return None
    return value if 0 <= value <= 255 else None


# ── Resolution ───────────────────────────────────────────────────────────────


def driver_for(device_type: Any) -> Optional[dict]:
    """The driver for a device's type, or None when it declares none."""
    driver = getattr(device_type, "driver", None)
    return driver if isinstance(driver, dict) and driver else None


def declared_protocol(driver: Optional[dict], device_type: Any = None) -> Optional[str]:
    """The protocol this device type *states*, driver first, or None.

    The driver wins over the device type's `connectivity.protocol`, which wins
    over nothing — the caller falls back to field heuristics. Returned lowercase
    and unvalidated; `_detect_protocol` decides whether it can be dispatched.
    """
    if driver:
        protocol = (driver.get("transport") or {}).get("protocol")
        if isinstance(protocol, str) and protocol.strip():
            return protocol.strip().lower()

    connectivity = getattr(device_type, "connectivity", None)
    if isinstance(connectivity, dict):
        protocol = connectivity.get("protocol")
        if isinstance(protocol, str) and protocol.strip():
            return protocol.strip().lower()

    return None


def lorawan_params(driver: Optional[dict]) -> tuple[int, bool]:
    """(f_port, confirmed) for a LoRaWAN downlink. Defaults to today's fPort 201."""
    lorawan = ((driver or {}).get("transport") or {}).get("lorawan") or {}
    return int(lorawan.get("f_port", DEFAULT_LORAWAN_F_PORT)), bool(lorawan.get("confirmed", False))


def mqtt_topic(driver: Optional[dict], device: Any) -> str:
    """The channel a command is published on. Today's topic unless declared."""
    default = f"{device.tenant_id}/devices/{device.id}/commands"
    topic = ((driver or {}).get("transport") or {}).get("mqtt", {}).get("topic")
    if not isinstance(topic, str) or not topic.strip():
        return default
    return topic.format(tenant_id=device.tenant_id, device_id=device.id)


def response_window_seconds(driver: Optional[dict], default: int) -> int:
    """How long this device type may take to answer, or the platform default.

    `default` stays the answer for a type with no driver — 60 seconds is wrong
    for a meter that reports every twelve hours, but it is what every device
    without a declaration is running under today, and changing that silently
    would be a behaviour change nobody asked for.
    """
    window = ((driver or {}).get("acknowledgement") or {}).get("response_window_seconds")
    if _is_int(window) and window > 0:
        return min(window, MAX_RESPONSE_WINDOW_SECONDS)
    return default


def is_unacknowledgeable(driver: Optional[dict], command_name: str) -> bool:
    """Whether this device can never confirm this command.

    IWM `RESET` resets the microcontroller and answers nothing; RFM `0x03 0x05`
    re-joins with factory defaults. Both are delivered correctly and neither will
    ever reply, so waiting for one and then recording a failure is the system
    lying about work it did.
    """
    ack = (driver or {}).get("acknowledgement") or {}
    return command_name in (ack.get("unacknowledgeable_commands") or [])


def telemetry_spec(driver: Optional[dict]) -> Optional[dict]:
    """The uplink decoder this driver carries, or None.

    Returned as-is for `decode()`, which is what makes absorbing the standalone
    `decoder` column a move rather than a translation: same keys, same engine,
    same output. A caller falls back to the column when this is None.
    """
    telemetry = (driver or {}).get("telemetry")
    if not isinstance(telemetry, dict):
        return None
    if telemetry.get("mode", "declarative") not in CODEC_MODES:
        return None
    return telemetry if telemetry.get("fields") else None


# `receive_window` deliberately has no accessor. It is recorded and surfaced —
# the whole driver is returned by the device-type endpoint — but nothing here
# reads it, because the platform does not model the LoRaWAN MAC and should not
# pretend to schedule around a Class A device's RX slots. It exists so the
# platform can *say* "this device only listens shortly after it speaks".


# ── Encoding ─────────────────────────────────────────────────────────────────


def encode_command(
    driver: Optional[dict], command_name: str, parameters: Optional[dict]
) -> Optional[bytes]:
    """Encode a command to wire bytes, or None to use the platform's JSON payload.

    None is returned for a device type with no driver and for an explicit
    `passthrough_json` codec — both mean "exactly what this platform sent before
    drivers existed", which is what keeps the live fleet working.

    Raises `DriverError` for a command the driver does not define. Falling back
    to the JSON envelope there would send a third-party meter a payload it
    cannot parse and report it as sent.
    """
    definition = _definition(driver, command_name)
    if definition is None:
        return None

    constants = definition.get("constants") or {}
    parameters = parameters or {}

    # Constants last, and a collision is an error rather than a silent override:
    # `parameters` is caller-supplied, and letting it reach the opcode byte would
    # turn "set the reporting interval" into any frame the caller can name.
    collisions = set(parameters) & set(constants)
    if collisions:
        raise DriverError(
            f"command {command_name!r}: parameters {sorted(collisions)} are fixed by "
            f"the driver and cannot be supplied by the caller."
        )

    try:
        return encode_fields(
            {"type": "declarative", "fields": definition["fields"]},
            {**parameters, **constants},
        )
    except ValueError as e:
        raise DriverError(f"command {command_name!r}: {e}") from e


def _definition(driver: Optional[dict], command_name: str) -> Optional[dict]:
    """This command's declaration, or None when the driver encodes nothing."""
    commands = (driver or {}).get("commands")
    if not commands:
        return None

    mode = commands.get("mode", "declarative")
    if mode == "passthrough_json":
        return None
    if mode not in COMMAND_MODES:
        raise DriverError(f"driver.commands.mode {mode!r} is not implemented")

    definitions = commands.get("definitions") or {}
    definition = definitions.get(command_name)
    if definition is None:
        raise DriverError(
            f"command {command_name!r} is not defined by this device type's driver "
            f"(defines: {sorted(definitions)})"
        )
    return definition


# ── Acknowledgement correlation ──────────────────────────────────────────────


def command_opcode(driver: Optional[dict], command_name: str) -> Optional[int]:
    """The byte a device will echo when it answers this command, or None.

    None means this command cannot be correlated — no driver, no declared
    correlation, or a passthrough codec — and the caller must not reserve an
    opcode for it. Reserving one that nothing will ever match would block the
    next identical command for the whole response window.
    """
    ack = (driver or {}).get("acknowledgement") or {}
    opcode_field = ack.get("opcode_field")
    if not opcode_field:
        return None

    definition = _definition(driver, command_name)
    if definition is None:
        return None

    opcode = (definition.get("constants") or {}).get(opcode_field)
    return opcode if _is_int(opcode) else None


def parse_acknowledgement(driver: Optional[dict], raw: bytes) -> Optional[Acknowledgement]:
    """Read an uplink as an answer to a command, or None if it is not one.

    Both observed confirmation styles are the same shape read at different
    offsets, which is why this is declared rather than branched on:

    - **IWM** answers `<Fct> 0x01 <Err> …` — the opcode is byte 0, `C/R/A` at
      byte 1 is `0x01` for an answer, and byte 2 carries the outcome.
    - **RFM** answers `0x01 <Index> <data>` and refuses with `0x02 <Index>` —
      the opcode is byte 1, and byte 0 is the discriminator with a real NACK.

    None is returned for anything that is not recognisably an answer, including
    an ordinary measurement uplink. That matters: this runs on **every** uplink,
    and a periodic meter reading whose first byte happens to equal an ack value
    must not close a command.
    """
    ack = (driver or {}).get("acknowledgement") or {}
    if ack.get("mode", "none") == "none":
        return None
    response = ack.get("response")
    if not isinstance(response, dict) or not raw:
        return None

    opcode_offset = response.get("opcode_offset")
    kind_offset = response.get("kind_offset")
    if not _is_int(opcode_offset) or not _is_int(kind_offset):
        return None
    if max(opcode_offset, kind_offset) >= len(raw):
        return None

    opcode = raw[opcode_offset]
    kind = raw[kind_offset]

    if kind in (response.get("nack_values") or []):
        return Acknowledgement(opcode, accepted=False, reason="the device refused the command")
    if kind not in (response.get("ack_values") or []):
        return None

    error_offset = response.get("error_offset")
    if _is_int(error_offset) and error_offset < len(raw):
        code = raw[error_offset]
        if code != 0:
            # A failure answer carries no body worth reading — the IWM's error
            # frames set Len to 0 — so the payload spec is not applied.
            return Acknowledgement(opcode, accepted=False, reason=_error_reason(response, code))

    return Acknowledgement(opcode, accepted=True, payload=_decode_payload(response, opcode, raw))


def _decode_payload(response: dict, opcode: int, raw: bytes) -> dict[str, float]:
    """Read the answer's body per the driver's layout for this opcode.

    Offsets are absolute within the whole frame, not relative to the header, so
    a layout reads the same way a command definition does — one convention,
    because two would be a transcription error waiting to happen.
    """
    payloads = response.get("payloads")
    if not isinstance(payloads, dict):
        return {}
    for key, spec in payloads.items():
        if _parse_byte_key(key) == opcode:
            # `decode()` never raises and drops fields that do not fit, so a
            # short or unexpected frame yields whatever was readable rather than
            # losing the acknowledgement itself.
            return decode_fields(
                {"type": "declarative", "fields": (spec or {}).get("fields")},
                base64.b64encode(raw).decode(),
            )
    return {}


def _error_reason(response: dict, code: int) -> str:
    """The device's own words for a failure, when the driver transcribed them."""
    names = response.get("error_names") or {}
    for key, text in names.items():
        try:
            if int(str(key), 0) == code:
                return f"{text} (0x{code:02x})"
        except (TypeError, ValueError):
            continue
    return f"the device reported error 0x{code:02x}"
