"""
Tests for TelemetryValidator in mqtt_processor.py.

Covers:
  - flatten_payload: nested dict flattening (the new feature)
  - validate_payload: accepts / rejects various payload shapes
  - is_valid_uuid: UUID format validation

Threshold/cooldown alert evaluation logic used to live here as a local
AlertEvaluator class; it was migrated to the shared alarm_core package (see
shared/alarm_core/tests/test_engine.py) and this file's copy went stale
(imported a class that no longer exists in mqtt_processor.py at all).
"""

import sys
import os
from datetime import datetime

import pytest

# Add the processor directory to the path so we can import mqtt_processor
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mqtt_processor import TelemetryValidator  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# flatten_payload
# ─────────────────────────────────────────────────────────────────────────────

class TestFlattenPayload:

    # ── unchanged inputs ──────────────────────────────────────────────────────

    def test_flat_numeric_unchanged(self):
        payload = {"temperature": 24.5, "humidity": 61.2}
        assert TelemetryValidator.flatten_payload(payload) == payload

    def test_flat_string_unchanged(self):
        payload = {"status": "online", "firmware": "v1.2.3"}
        assert TelemetryValidator.flatten_payload(payload) == payload

    def test_flat_mixed_types_unchanged(self):
        payload = {"temp": 24.5, "active": True, "label": "sensor-A"}
        assert TelemetryValidator.flatten_payload(payload) == payload

    def test_array_value_kept_as_is(self):
        """Arrays are not flattened — stored as JSON blob under their key."""
        payload = {"readings": [1, 2, 3]}
        assert TelemetryValidator.flatten_payload(payload) == {"readings": [1, 2, 3]}

    def test_empty_dict_value_kept_as_is(self):
        """Empty nested dicts are not recursed into — kept as-is."""
        payload = {"meta": {}}
        assert TelemetryValidator.flatten_payload(payload) == {"meta": {}}

    # ── one level of nesting ─────────────────────────────────────────────────

    def test_tasmota_si7021(self):
        """Real-world Tasmota SI7021 sensor payload."""
        payload = {"SI7021": {"Temperature": 24.5, "Humidity": 61.2}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {"SI7021__Temperature": 24.5, "SI7021__Humidity": 61.2}

    def test_shelly_temperature(self):
        """Shelly-style nested temperature."""
        payload = {"temperature": {"tC": 24.5, "tF": 76.1}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {"temperature__tC": 24.5, "temperature__tF": 76.1}

    def test_mixed_flat_and_nested(self):
        """Top-level flat keys survive alongside flattened nested keys."""
        payload = {
            "uptime": 3600,
            "wifi": {"rssi": -65, "channel": 6},
        }
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {
            "uptime": 3600,
            "wifi__rssi": -65,
            "wifi__channel": 6,
        }

    def test_single_nested_key(self):
        payload = {"energy": {"power": 120.5}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {"energy__power": 120.5}

    # ── multiple levels of nesting ────────────────────────────────────────────

    def test_two_levels_deep(self):
        payload = {"energy": {"power": 120.5, "today": {"kwh": 1.2}}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {
            "energy__power": 120.5,
            "energy__today__kwh": 1.2,
        }

    def test_three_levels_deep(self):
        payload = {"a": {"b": {"c": {"d": 42}}}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {"a__b__c__d": 42}

    def test_max_depth_stops_recursion(self):
        """At max_depth=1, nested dicts at depth 2 are stored as blobs."""
        payload = {"level1": {"level2": {"level3": 99}}}
        result = TelemetryValidator.flatten_payload(payload, max_depth=1)
        # level1__level2 gets stored as the whole dict {"level3": 99}
        assert result == {"level1__level2": {"level3": 99}}

    # ── edge cases ────────────────────────────────────────────────────────────

    def test_empty_payload(self):
        assert TelemetryValidator.flatten_payload({}) == {}

    def test_nested_with_array_leaf(self):
        """Arrays inside nested dicts are kept as-is."""
        payload = {"sensor": {"readings": [1.0, 2.0, 3.0], "count": 3}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {
            "sensor__readings": [1.0, 2.0, 3.0],
            "sensor__count": 3,
        }

    def test_nested_null_value(self):
        payload = {"sensor": {"value": None}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {"sensor__value": None}

    def test_nested_boolean(self):
        payload = {"relay": {"state": True}}
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {"relay__state": True}

    def test_key_naming_uses_double_underscore(self):
        """Separator is __ not . or / — important for metric key storage."""
        payload = {"a": {"b": 1}}
        result = TelemetryValidator.flatten_payload(payload)
        assert "a__b" in result
        assert "a.b" not in result
        assert "a/b" not in result

    def test_real_world_tasmota_full(self):
        """
        Full Tasmota MQTT JSON payload (after SYSTEM_KEYS stripped):
        Tasmota publishes something like:
          {"Time":"2024-01-01T12:00:00","SI7021":{"Temperature":24.5,"Humidity":61.2},"TempUnit":"C"}
        After stripping 'Time' (caught by SYSTEM_KEYS 'time'), we get:
          {"SI7021":{"Temperature":24.5,"Humidity":61.2},"TempUnit":"C"}
        """
        payload = {
            "SI7021": {"Temperature": 24.5, "Humidity": 61.2},
            "TempUnit": "C",
        }
        result = TelemetryValidator.flatten_payload(payload)
        assert result == {
            "SI7021__Temperature": 24.5,
            "SI7021__Humidity": 61.2,
            "TempUnit": "C",
        }


# ─────────────────────────────────────────────────────────────────────────────
# validate_payload
# ─────────────────────────────────────────────────────────────────────────────

class TestValidatePayload:

    # ── valid payloads ────────────────────────────────────────────────────────

    def test_flat_numeric(self):
        assert TelemetryValidator.validate_payload({"temperature": 24.5}) is True

    def test_flat_string_value(self):
        assert TelemetryValidator.validate_payload({"status": "online"}) is True

    def test_flat_boolean(self):
        assert TelemetryValidator.validate_payload({"active": True}) is True

    def test_multiple_metrics(self):
        payload = {"temperature": 24.5, "humidity": 61.2, "battery": 85}
        assert TelemetryValidator.validate_payload(payload) is True

    def test_nested_dict_value_accepted(self):
        """After flattening, nested dicts shouldn't reach validate_payload.
        But if they do (e.g. array-leaf), validate still accepts them."""
        payload = {"data": {"nested": 42}}
        assert TelemetryValidator.validate_payload(payload) is True

    def test_array_value_accepted(self):
        assert TelemetryValidator.validate_payload({"readings": [1, 2, 3]}) is True

    def test_numeric_at_max_boundary(self):
        assert TelemetryValidator.validate_payload({"v": 1e10}) is True

    def test_numeric_at_min_boundary(self):
        assert TelemetryValidator.validate_payload({"v": -1e10}) is True

    # ── invalid payloads ──────────────────────────────────────────────────────

    def test_plain_number_rejected(self):
        assert TelemetryValidator.validate_payload(24.5) is False

    def test_plain_string_rejected(self):
        assert TelemetryValidator.validate_payload("online") is False

    def test_plain_list_rejected(self):
        assert TelemetryValidator.validate_payload([1, 2, 3]) is False

    def test_none_rejected(self):
        assert TelemetryValidator.validate_payload(None) is False

    def test_empty_dict_rejected(self):
        assert TelemetryValidator.validate_payload({}) is False

    def test_value_too_large_rejected(self):
        assert TelemetryValidator.validate_payload({"v": 2e10}) is False

    def test_value_too_small_rejected(self):
        assert TelemetryValidator.validate_payload({"v": -2e10}) is False

    def test_empty_string_key_rejected(self):
        assert TelemetryValidator.validate_payload({"": 24.5}) is False

    def test_non_string_key_rejected(self):
        # Python dicts can't have non-string keys normally, but test the guard
        assert TelemetryValidator.validate_payload({1: 24.5}) is False


# ─────────────────────────────────────────────────────────────────────────────
# is_valid_uuid
# ─────────────────────────────────────────────────────────────────────────────

class TestIsValidUUID:

    def test_valid_uuid4(self):
        assert TelemetryValidator.is_valid_uuid("550e8400-e29b-41d4-a716-446655440000") is True

    def test_valid_uuid_uppercase(self):
        assert TelemetryValidator.is_valid_uuid("550E8400-E29B-41D4-A716-446655440000") is True

    def test_invalid_too_short(self):
        assert TelemetryValidator.is_valid_uuid("550e8400-e29b-41d4") is False

    def test_invalid_random_string(self):
        assert TelemetryValidator.is_valid_uuid("not-a-uuid") is False

    def test_invalid_empty(self):
        assert TelemetryValidator.is_valid_uuid("") is False

    def test_invalid_none(self):
        assert TelemetryValidator.is_valid_uuid(None) is False

