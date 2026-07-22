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

"scale_exponent_ref" (optional) names another field in this same spec whose
decoded value is a wM-Bus-style VIF exponent byte — a companion field that
says what power-of-ten unit THIS field's count is actually in (common in
metering protocols where a counter that overflows its range steps up a unit
instead of resetting, e.g. B METERS: litres -> decalitres -> hectolitres ->
m³). After every field decodes normally, this field's value is additionally
multiplied by 10 ** (ref_field_value - scale_exponent_base) — e.g. B METERS'
VIF byte is 0x13/19=litres, 0x14/20=decalitres, ... so scale_exponent_base=19
turns a raw count already expressed in whatever unit VIF currently says into
a value always expressed in the base (litres) unit. Silently skipped (no
extra scaling) if the ref field didn't decode.

Contract (mirrors alarm_core): decode() never raises. A malformed spec returns
{}; a malformed individual field is skipped, the rest still decode.

encode() is the inverse — given the same spec and a dict of target metric
values, produces the raw bytes. It exists for test/simulation tooling (proving
a decoder against synthetic fixtures instead of only real captured hex), not
the ingest path, so its contract is deliberately the opposite of decode()'s:
it RAISES ValueError on a malformed spec or a value that doesn't fit its field
(wrong number of BCD digits, integer overflow, non-0/1 bit) rather than
silently truncating or wrapping — a bad fixture generator should fail loudly,
not produce bytes that quietly decode to the wrong thing. A field present in
the spec but absent from `values` is left zero-filled; that is normal partial-
fixture usage, not an error. `scale_exponent_ref` fields use whatever value
the caller put in `values[ref_name]`, defaulting to "no extra scaling" (as if
the ref field decoded to `scale_exponent_base`) when the caller didn't supply
one — mirroring decode()'s own "skipped if the ref field didn't decode".
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


def _int_to_bcd(value: int, length: int) -> bytes:
    """Inverse of _bcd_to_int: pack a non-negative int into `length` bytes of
    packed BCD (2 digits/byte, high nibble first). Raises ValueError if it
    doesn't fit in the field's digit count."""
    digits = length * 2
    max_value = 10**digits - 1
    if value < 0 or value > max_value:
        raise ValueError(
            f"{value} does not fit in a {length}-byte BCD field (0-{max_value})"
        )
    out = bytearray(length)
    for i in range(length - 1, -1, -1):
        low, value = value % 10, value // 10
        high, value = value % 10, value // 10
        out[i] = (high << 4) | low
    return bytes(out)


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

    # Second pass: apply cross-field VIF-style exponent scaling now that every
    # field (including whatever the ref points at) has decoded once.
    for field in fields:
        if not isinstance(field, dict):
            continue
        ref_name = field.get("scale_exponent_ref")
        name = field.get("name")
        if not ref_name or name not in result or ref_name not in result:
            continue
        try:
            base = int(field.get("scale_exponent_base", 0))
            exponent = int(result[ref_name]) - base
        except (TypeError, ValueError):
            continue
        result[name] *= 10 ** exponent

    return result


def _pack_field(buf: bytearray, field: dict, value: Any) -> None:
    """Write `value` into `buf` at this field's offset — the inverse of
    _unpack_field. A `bit` field does read-modify-write against whatever is
    already in the buffer, so multiple bit fields sharing one offset (a packed
    status byte) accumulate correctly regardless of processing order. Raises
    ValueError on a malformed field spec or a value that doesn't fit."""
    if not isinstance(field, dict) or "name" not in field:
        raise ValueError(f"malformed field spec: {field!r}")
    name = field["name"]
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
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"malformed field spec for '{name}': {e}") from e

    if offset < 0 or offset + length > len(buf):
        raise ValueError(f"field '{name}' offset/length is outside the payload")

    if bit is not None:
        if bit < 0 or bit > 7 or ftype in ("float32", "bcd"):
            raise ValueError(f"field '{name}' has an invalid bit index for its type")
        fmt_char = _STRUCT_FORMATS.get(ftype)
        if fmt_char is None or length != struct.calcsize(fmt_char):
            raise ValueError(f"field '{name}' has an unsupported type/length for a bit field")
        endian_char = "<" if endian == "little" else ">"
        (current,) = struct.unpack(f"{endian_char}{fmt_char}", bytes(buf[offset : offset + length]))
        current = (int(current) | (1 << bit)) if value else (int(current) & ~(1 << bit))
        buf[offset : offset + length] = struct.pack(f"{endian_char}{fmt_char}", current)
        return

    if scale == 0:
        raise ValueError(f"field '{name}' has scale=0, can't be encoded")
    raw = (float(value) - value_offset) / scale

    if ftype == "bcd":
        packed = _int_to_bcd(round(raw), length)
        buf[offset : offset + length] = packed if endian == "big" else packed[::-1]
        return

    fmt_char = _STRUCT_FORMATS.get(ftype)
    if fmt_char is None:
        raise ValueError(f"field '{name}' has unknown type '{ftype}'")
    if length != struct.calcsize(fmt_char):
        raise ValueError(f"field '{name}' length {length} doesn't match type '{ftype}'")

    endian_char = "<" if endian == "little" else ">"
    packed_value = raw if fmt_char == "f" else round(raw)
    try:
        buf[offset : offset + length] = struct.pack(f"{endian_char}{fmt_char}", packed_value)
    except struct.error as e:
        raise ValueError(f"value {value} for field '{name}' doesn't fit as {ftype}") from e


def encode(spec: Optional[dict], values: dict[str, Any]) -> bytes:
    """Encode a dict of metric values into raw payload bytes per a declarative
    spec — the inverse of decode(). See the module docstring: unlike decode(),
    this RAISES ValueError on a malformed spec or a value that doesn't fit."""
    if not spec or not isinstance(spec, dict):
        raise ValueError("spec must be a non-empty dict")
    if spec.get("type", "declarative") != "declarative":
        raise ValueError(f"unsupported spec type: {spec.get('type')!r}")

    fields = spec.get("fields")
    if not fields or not isinstance(fields, list):
        raise ValueError("spec has no 'fields' list")

    size = 0
    for field in fields:
        if not isinstance(field, dict):
            raise ValueError(f"malformed field spec: {field!r}")
        try:
            size = max(size, int(field["offset"]) + int(field["length"]))
        except (KeyError, TypeError, ValueError) as e:
            raise ValueError(f"malformed field spec: {field!r}") from e

    # A scale_exponent_ref field left out of `values` still gets bytes written
    # (zero-filled) and will DECODE to something — so leaving it un-encoded
    # would round-trip through a spurious real value (0) instead of a no-op.
    # Default it to scale_exponent_base so decoding it back yields
    # exponent = base - base = 0, matching decode()'s own "ref didn't decode
    # -> no extra scaling" behavior.
    effective_values = dict(values)
    for field in fields:
        ref_name = field.get("scale_exponent_ref")
        if ref_name and ref_name not in effective_values:
            try:
                effective_values[ref_name] = int(field.get("scale_exponent_base", 0))
            except (TypeError, ValueError):
                pass

    buf = bytearray(size)

    for field in fields:
        name = field.get("name")
        if not name or name not in effective_values:
            continue

        is_bit = field.get("bit") is not None
        ref_name = field.get("scale_exponent_ref")
        value = effective_values[name] if is_bit else float(effective_values[name])

        if ref_name is not None and not is_bit:
            try:
                base = int(field.get("scale_exponent_base", 0))
                exponent = int(effective_values[ref_name]) - base
            except (TypeError, ValueError) as e:
                raise ValueError(f"malformed scale_exponent_base for '{name}'") from e
            value = value / (10 ** exponent)

        _pack_field(buf, field, value)

    return bytes(buf)
