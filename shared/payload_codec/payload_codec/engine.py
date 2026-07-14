"""Declarative byte-layout payload decoder — no code execution, ever.

Spec shape:
{
  "type": "declarative",           # optional; default "declarative"
  "f_port": 2,                     # optional int or list[int] — restrict to this port
  "fields": [
    {"name": "flow_rate", "offset": 0, "length": 2, "type": "uint16",
     "endian": "big", "scale": 0.1, "value_offset": 0.0},
    {"name": "total_volume", "offset": 1, "length": 4, "type": "bcd", "endian": "little"},
    {"name": "leak_alarm", "offset": 12, "length": 1, "type": "uint8", "bit": 3},
    ...
  ]
}

"bcd" fields decode N bytes of packed decimal (2 digits per byte, high nibble
first) — common in metering protocols (water/gas/heat) descended from wM-Bus,
e.g. B METERS IWM-LR3/LR4. "endian" controls byte order: "little" means the
last transmitted byte holds the most-significant digit pair (that vendor's
convention); "big" means the first byte is most significant.

"bit" (0-7, optional, non-bcd/non-float32 types only) extracts a single bit
from an already-unpacked integer field — for reading individual flags out of
a packed status/alarm byte. The raw value becomes 0 or 1 before scale/
value_offset are applied.

Contract (mirrors alarm_core): decode() never raises. A malformed spec returns
{}; a malformed individual field is skipped, the rest still decode.
"""

from __future__ import annotations

import base64
import struct
from typing import Any, Optional

_STRUCT_FORMATS = {
    "uint8": "B",
    "int8": "b",
    "uint16": "H",
    "int16": "h",
    "uint32": "I",
    "int32": "i",
    "float32": "f",
}


def _bcd_to_int(data: bytes) -> Optional[int]:
    """Packed BCD, 2 decimal digits per byte (high nibble first). None if any nibble > 9."""
    value = 0
    for byte in data:
        high, low = byte >> 4, byte & 0x0F
        if high > 9 or low > 9:
            return None
        value = value * 100 + high * 10 + low
    return value


def _unpack_field(raw: bytes, field: dict) -> Optional[float]:
    if not isinstance(field, dict) or "name" not in field:
        return None
    try:
        offset = int(field["offset"])
        length = int(field["length"])
        ftype = field.get("type", "uint8")
        endian = field.get("endian", "big")
        scale = float(field.get("scale", 1.0))
        value_offset = float(field.get("value_offset", 0.0))
        bit = field.get("bit")
        if bit is not None:
            bit = int(bit)
    except (KeyError, TypeError, ValueError):
        return None

    if offset < 0 or offset + length > len(raw):
        return None
    field_bytes = raw[offset : offset + length]

    if ftype == "bcd":
        ordered = field_bytes if endian == "big" else field_bytes[::-1]
        value = _bcd_to_int(ordered)
        if value is None:
            return None
        return value * scale + value_offset

    fmt_char = _STRUCT_FORMATS.get(ftype)
    if fmt_char is None:
        return None
    if length != struct.calcsize(fmt_char):
        return None

    endian_char = "<" if endian == "little" else ">"
    try:
        (value,) = struct.unpack(f"{endian_char}{fmt_char}", field_bytes)
    except struct.error:
        return None

    if bit is not None:
        if bit < 0 or bit > 7 or ftype == "float32":
            return None
        value = (int(value) >> bit) & 1

    return value * scale + value_offset


def decode(
    spec: Optional[dict],
    raw_b64: Optional[str],
    f_port: Optional[int] = None,
) -> dict[str, float]:
    """Decode a base64 raw uplink payload per a declarative spec. Never raises."""
    if not spec or not isinstance(spec, dict):
        return {}

    if spec.get("type", "declarative") != "declarative":
        return {}

    port_filter = spec.get("f_port")
    if port_filter is not None:
        allowed = port_filter if isinstance(port_filter, list) else [port_filter]
        if f_port not in allowed:
            return {}

    fields = spec.get("fields")
    if not fields or not isinstance(fields, list):
        return {}

    if not raw_b64:
        return {}
    try:
        raw = base64.b64decode(raw_b64, validate=False)
    except Exception:
        return {}

    result: dict[str, float] = {}
    for field in fields:
        value = _unpack_field(raw, field)
        if value is not None:
            result[field["name"]] = value
    return result
