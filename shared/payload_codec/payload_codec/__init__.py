"""payload_codec — declarative byte-layout codec for the Gito platform.

Pure Python, no code execution. Used by both the API and the ingest processor
when a device's network server hasn't decoded the uplink itself (no NS
`object`). Phase 1 of the platform-side decoding plan — see
docs/superpowers/plans/2026-07-07-payload-decoding.md.

`engine` is the byte layer: bytes ⇄ values against a field spec.
`driver` is the declaration layer on top of it — one document per device type
saying which transport, which command encodings, which uplink decoder, and how
that device acknowledges. It lives here rather than in the API because the
processor reads it too; see `drivers/README.md`.
"""

from .driver import (
    Acknowledgement,
    DriverError,
    command_opcode,
    declared_protocol,
    driver_for,
    encode_command,
    is_unacknowledgeable,
    lorawan_params,
    mqtt_topic,
    parse_acknowledgement,
    response_window_seconds,
    telemetry_spec,
    validate_driver,
)
from .engine import decode, encode

__all__ = [
    "Acknowledgement",
    "DriverError",
    "command_opcode",
    "decode",
    "declared_protocol",
    "driver_for",
    "encode",
    "encode_command",
    "is_unacknowledgeable",
    "lorawan_params",
    "mqtt_topic",
    "parse_acknowledgement",
    "response_window_seconds",
    "telemetry_spec",
    "validate_driver",
]
