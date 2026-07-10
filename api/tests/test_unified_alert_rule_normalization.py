"""Regression test for rule_type/severity format normalization (UnifiedAlertRule).

@validates('rule_type')/@validates('severity') convert API-format values
(THRESHOLD/COMPOSITE, info/warning/critical) to DB format (SIMPLE/COMPLEX,
MINOR/WARNING/CRITICAL) on Python-side assignment — but NOT when SQLAlchemy
loads a row from a query, and not for legacy rows stored before these hooks
existed. Comparing a loaded instance's raw attribute (or a DB column) against
an API-format literal silently matches nothing. See the comment above
RULE_TYPE_DB_VALUES in app/models/unified_alert_rule.py.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from app.models.unified_alert_rule import (
    RULE_TYPE_DB_VALUES,
    SEVERITY_DB_VALUES,
    normalize_rule_type,
)


class TestNormalizeRuleType:
    def test_db_format_values(self):
        assert normalize_rule_type("SIMPLE") == "THRESHOLD"
        assert normalize_rule_type("COMPLEX") == "COMPOSITE"

    def test_api_format_values_pass_through(self):
        # Legacy rows / raw-SQL inserts may store the API-format string directly.
        assert normalize_rule_type("THRESHOLD") == "THRESHOLD"
        assert normalize_rule_type("COMPOSITE") == "COMPOSITE"

    def test_case_insensitive(self):
        assert normalize_rule_type("complex") == "COMPOSITE"
        assert normalize_rule_type("simple") == "THRESHOLD"

    def test_missing_defaults_to_threshold(self):
        assert normalize_rule_type(None) == "THRESHOLD"
        assert normalize_rule_type("") == "THRESHOLD"


class TestFilterValueSets:
    """The list_alert_rules filter does
    UnifiedAlertRule.rule_type.in_(RULE_TYPE_DB_VALUES[...]) — every value
    normalize_rule_type() would recognize as a given type must also be a
    member of that type's filter set, or the filter and the normalizer
    would silently disagree with each other again.
    """

    def test_rule_type_db_values_agree_with_normalizer(self):
        for canonical, raw_values in RULE_TYPE_DB_VALUES.items():
            for raw in raw_values:
                assert normalize_rule_type(raw) == canonical

    def test_severity_db_values_cover_documented_legacy_synonym(self):
        # MAJOR is a legacy synonym for "warning" (see SEVERITY_DB_TO_API).
        assert "MAJOR" in SEVERITY_DB_VALUES["warning"]
        assert "WARNING" in SEVERITY_DB_VALUES["warning"]
