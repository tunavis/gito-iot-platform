"""payload_codec.decode() — behavior spec.

Declarative byte-layout decoder: no code execution, ever. A malformed spec
or an individual bad field never raises and never blocks other fields —
same contract as alarm_core's "a malformed rule must never block the others".
"""

import base64
import struct

import pytest

from payload_codec import decode


def b64(fmt: str, *values) -> str:
    """Pack values with struct format, base64-encode (test helper)."""
    return base64.b64encode(struct.pack(fmt, *values)).decode()


def field(name, offset, length, type="uint8", **overrides):
    f = {"name": name, "offset": offset, "length": length, "type": type}
    f.update(overrides)
    return f


# ── Spec-level safety ────────────────────────────────────────────────────────

def test_none_spec_returns_empty():
    assert decode(None, b64(">B", 1), 2) == {}


def test_empty_dict_spec_returns_empty():
    assert decode({}, b64(">B", 1), 2) == {}


def test_non_dict_spec_returns_empty():
    assert decode("not a dict", b64(">B", 1), 2) == {}


def test_missing_type_defaults_to_declarative():
    spec = {"fields": [field("x", 0, 1)]}
    assert decode(spec, b64(">B", 42), 2) == {"x": 42.0}


def test_non_declarative_type_returns_empty():
    spec = {"type": "js", "fields": [field("x", 0, 1)]}
    assert decode(spec, b64(">B", 42), 2) == {}


def test_missing_fields_returns_empty():
    assert decode({"type": "declarative"}, b64(">B", 1), 2) == {}


def test_fields_not_a_list_returns_empty():
    spec = {"type": "declarative", "fields": "nope"}
    assert decode(spec, b64(">B", 1), 2) == {}


def test_no_raw_payload_returns_empty():
    spec = {"type": "declarative", "fields": [field("x", 0, 1)]}
    assert decode(spec, None, 2) == {}
    assert decode(spec, "", 2) == {}


def test_invalid_base64_returns_empty():
    spec = {"type": "declarative", "fields": [field("x", 0, 1)]}
    assert decode(spec, "not-valid-base64!!!", 2) == {}


# ── Numeric types + endianness ───────────────────────────────────────────────

def test_decode_uint8():
    spec = {"type": "declarative", "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 200), 1) == {"v": 200.0}


def test_decode_uint16_big_endian():
    spec = {"type": "declarative", "fields": [field("v", 0, 2, "uint16", endian="big")]}
    assert decode(spec, b64(">H", 1000), 1) == {"v": 1000.0}


def test_decode_uint16_little_endian():
    spec = {"type": "declarative", "fields": [field("v", 0, 2, "uint16", endian="little")]}
    assert decode(spec, b64("<H", 1000), 1) == {"v": 1000.0}


def test_default_endian_is_big():
    spec = {"type": "declarative", "fields": [field("v", 0, 2, "uint16")]}
    assert decode(spec, b64(">H", 500), 1) == {"v": 500.0}


def test_decode_int16_negative():
    spec = {"type": "declarative", "fields": [field("v", 0, 2, "int16")]}
    assert decode(spec, b64(">h", -273), 1) == {"v": -273.0}


def test_decode_int8():
    spec = {"type": "declarative", "fields": [field("v", 0, 1, "int8")]}
    assert decode(spec, b64(">b", -5), 1) == {"v": -5.0}


def test_decode_uint32():
    spec = {"type": "declarative", "fields": [field("v", 0, 4, "uint32")]}
    assert decode(spec, b64(">I", 4_000_000_000), 1) == {"v": 4_000_000_000.0}


def test_decode_int32():
    spec = {"type": "declarative", "fields": [field("v", 0, 4, "int32")]}
    assert decode(spec, b64(">i", -123456), 1) == {"v": -123456.0}


def test_decode_float32():
    spec = {"type": "declarative", "fields": [field("v", 0, 4, "float32")]}
    result = decode(spec, b64(">f", 3.5), 1)
    assert result["v"] == pytest.approx(3.5)


def test_unknown_type_field_skipped():
    spec = {"type": "declarative", "fields": [field("v", 0, 1, "nonsense")]}
    assert decode(spec, b64(">B", 1), 1) == {}


# ── Scale / value_offset transforms ──────────────────────────────────────────

def test_scale_applied():
    spec = {"type": "declarative", "fields": [field("flow", 0, 2, "uint16", scale=0.1)]}
    assert decode(spec, b64(">H", 425), 1) == {"flow": pytest.approx(42.5)}


def test_value_offset_applied():
    spec = {"type": "declarative", "fields": [field("temp", 0, 2, "int16", value_offset=-40.0)]}
    assert decode(spec, b64(">h", 60), 1) == {"temp": 20.0}


def test_scale_and_value_offset_combined():
    spec = {"type": "declarative", "fields": [
        field("temp", 0, 2, "uint16", scale=0.01, value_offset=-40.0)
    ]}
    assert decode(spec, b64(">H", 6000), 1) == {"temp": pytest.approx(20.0)}


def test_default_scale_is_one_offset_is_zero():
    spec = {"type": "declarative", "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 7), 1) == {"v": 7.0}


# ── Multi-field payloads (the real water-meter shape) ────────────────────────

def test_multiple_fields_at_different_offsets():
    raw = struct.pack(">Hh H", 425, -55, 15420)  # flow, temp, volume
    raw_b64 = base64.b64encode(raw).decode()
    spec = {"type": "declarative", "fields": [
        field("flow_rate", 0, 2, "uint16", scale=0.1),
        field("temperature", 2, 2, "int16", scale=0.1),
        field("cumulative_volume", 4, 2, "uint16"),
    ]}
    result = decode(spec, raw_b64, 2)
    assert result["flow_rate"] == pytest.approx(42.5)
    assert result["temperature"] == pytest.approx(-5.5)
    assert result["cumulative_volume"] == 15420.0


# ── Partial-failure safety (never raise, never block other fields) ──────────

def test_field_out_of_bounds_is_skipped_others_still_decoded():
    spec = {"type": "declarative", "fields": [
        field("ok", 0, 1, "uint8"),
        field("oob", 10, 2, "uint16"),  # payload is only 1 byte
    ]}
    assert decode(spec, b64(">B", 9), 1) == {"ok": 9.0}


def test_length_mismatch_for_type_is_skipped():
    spec = {"type": "declarative", "fields": [field("v", 0, 3, "uint16")]}  # uint16 needs length=2
    assert decode(spec, b64(">H", 1), 1) == {}


def test_negative_offset_is_skipped():
    spec = {"type": "declarative", "fields": [field("v", -1, 1, "uint8")]}
    assert decode(spec, b64(">B", 1), 1) == {}


def test_field_missing_required_key_is_skipped():
    spec = {"type": "declarative", "fields": [{"name": "v", "type": "uint8"}]}  # no offset/length
    assert decode(spec, b64(">B", 1), 1) == {}


def test_field_without_name_is_skipped():
    spec = {"type": "declarative", "fields": [{"offset": 0, "length": 1, "type": "uint8"}]}
    assert decode(spec, b64(">B", 1), 1) == {}


def test_non_dict_field_is_skipped():
    spec = {"type": "declarative", "fields": ["not-a-dict", field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 5), 1) == {"v": 5.0}


def test_one_bad_field_does_not_block_others():
    spec = {"type": "declarative", "fields": [
        field("bad", 0, 99, "uint8"),
        field("good", 0, 1, "uint8"),
    ]}
    assert decode(spec, b64(">B", 3), 1) == {"good": 3.0}


# ── fPort filtering ───────────────────────────────────────────────────────────

def test_f_port_match_decodes():
    spec = {"type": "declarative", "f_port": 2, "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 1), 2) == {"v": 1.0}


def test_f_port_mismatch_returns_empty():
    spec = {"type": "declarative", "f_port": 2, "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 1), 5) == {}


def test_f_port_list_match():
    spec = {"type": "declarative", "f_port": [1, 2, 3], "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 1), 3) == {"v": 1.0}


def test_f_port_list_mismatch():
    spec = {"type": "declarative", "f_port": [1, 2, 3], "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 1), 9) == {}


def test_no_f_port_key_decodes_regardless_of_port():
    spec = {"type": "declarative", "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 1), None) == {"v": 1.0}
    assert decode(spec, b64(">B", 1), 99) == {"v": 1.0}


def test_f_port_required_but_none_passed_mismatches():
    spec = {"type": "declarative", "f_port": 2, "fields": [field("v", 0, 1, "uint8")]}
    assert decode(spec, b64(">B", 1), None) == {}


# ── Result shape ──────────────────────────────────────────────────────────────

def test_all_values_are_floats():
    spec = {"type": "declarative", "fields": [field("v", 0, 1, "uint8")]}
    result = decode(spec, b64(">B", 5), 1)
    assert isinstance(result["v"], float)
