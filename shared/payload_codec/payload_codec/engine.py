"""Declarative byte-layout payload decoder — no code execution, ever.

Spec shape:
{
  "type": "declarative",           # optional; default "declarative"
  "f_port": 2,                     # optional int or list[int] — restrict to this port
  "fields": [
    {"name": "flow_rate", "offset": 0, "length": 2, "type": "uint16",
     "endian": "big", "scale": 0.1, "value_offset": 0.0},
    ...
  ]
}

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
    except (KeyError, TypeError, ValueError):
        return None

    fmt_char = _STRUCT_FORMATS.get(ftype)
    if fmt_char is None:
        return None
    if length != struct.calcsize(fmt_char):
        return None
    if offset < 0 or offset + length > len(raw):
        return None

    endian_char = "<" if endian == "little" else ">"
    try:
        (value,) = struct.unpack(f"{endian_char}{fmt_char}", raw[offset : offset + length])
    except struct.error:
        return None

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
