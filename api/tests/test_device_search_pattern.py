"""Unit tests for device_search_pattern — the LIKE escaping on device search.

The device list caps `per_page` at 100, so `?search=` is the only way a client
reaches device 101+ on a large fleet. The escaping matters: an unescaped `%`
matches every row and an unescaped `_` matches any single character, so a
serial-number search would silently return neighbours.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from app.routers.devices import device_search_pattern


class TestDeviceSearchPattern:
    def test_plain_term_is_wrapped_for_substring_match(self):
        assert device_search_pattern("Flow Meter") == "%Flow Meter%"

    def test_surrounding_whitespace_is_trimmed(self):
        # Otherwise "  pump " would only match names that literally contain
        # the spaces, which is never what a typed search means.
        assert device_search_pattern("  pump  ") == "%pump%"

    def test_percent_is_escaped_so_it_does_not_match_everything(self):
        assert device_search_pattern("100%") == "%100\\%%"

    def test_underscore_is_escaped_so_it_does_not_match_any_char(self):
        # `WM_0042` must not also match `WM-0042` / `WMx0042`.
        assert device_search_pattern("WM_0042") == "%WM\\_0042%"

    def test_backslash_is_escaped_first(self):
        # If the backslash were escaped after % and _, it would double-escape
        # the escapes just added and break the pattern.
        assert device_search_pattern("a\\b") == "%a\\\\b%"

    def test_backslash_before_wildcard_stays_unambiguous(self):
        # Literal `\` then literal `_` -> escaped backslash, then escaped underscore.
        assert device_search_pattern("a\\_b") == "%a\\\\\\_b%"
