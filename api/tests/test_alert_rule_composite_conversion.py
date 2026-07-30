"""Self-check: THRESHOLD -> COMPOSITE conversion on PUT /alert-rules/{id}.

The canvas needs "add a second condition" to work on a THRESHOLD rule, which
means converting it. The three things most likely to silently regress:

1. The first condition is seeded from the rule's *stored* columns, with the
   operator resolved server-side — the column may hold API ('gt') or DB ('>')
   format and only the server can tell which (unified_alert_rule.py:61-75).
2. `device_id` survives the conversion. The processor selects rules by device
   irrespective of rule type (mqtt_processor.py:477-488), so clearing it would
   silently widen a device rule to the whole tenant.
3. Conversion and the conditions write happen in ONE request. Splitting them
   would persist a COMPOSITE rule with no conditions in between — a rule the
   engine treats as unevaluable, i.e. one that can never fire.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from uuid import uuid4

import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock, MagicMock

from app.database import RLSSession
from app.routers.alert_rules_unified import update_alert_rule
from app.schemas.alert_unified import AlertRuleUpdate


def _make_rule(rule_type="SIMPLE", operator="gt", metric="flow_rate", device_id=None):
    """A loaded rule: rule_type is whatever is in the column, not normalized."""
    rule = MagicMock()
    rule.id = uuid4()
    rule.name = "Flow high"
    rule.rule_type = rule_type
    rule.severity = "MAJOR"
    rule.metric = metric
    rule.operator = operator
    rule.threshold = 80.0
    rule.conditions = None
    rule.logic = None
    rule.device_id = device_id
    rule.to_response_dict.return_value = {}
    return rule


def _make_session(existing):
    session = MagicMock(spec=RLSSession)
    session.set_tenant_context = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = existing
    session.execute = AsyncMock(return_value=result)
    return session


async def _put(rule, **fields):
    tenant_id = uuid4()
    session = _make_session(rule)
    await update_alert_rule(
        tenant_id=tenant_id,
        rule_id=rule.id,
        rule_data=AlertRuleUpdate(**fields),
        session=session,
        current_tenant=tenant_id,
    )
    return rule


class TestThresholdToComposite:
    @pytest.mark.asyncio
    async def test_seeds_first_condition_and_applies_new_one_in_one_request(self):
        rule = _make_rule()
        await _put(
            rule,
            rule_type="COMPOSITE",
            conditions=[{"field": "battery", "operator": "lt", "threshold": 20, "weight": 2}],
            logic="AND",
        )

        assert rule.rule_type == "COMPOSITE"
        assert rule.logic == "AND"
        assert len(rule.conditions) == 2, "converted rule must never be persisted condition-less"
        assert rule.conditions[0] == {
            "field": "flow_rate",
            "operator": "gt",
            "threshold": 80.0,
            "weight": 1,
        }
        assert rule.conditions[1]["field"] == "battery"

    @pytest.mark.asyncio
    async def test_resolves_a_db_format_operator_rather_than_storing_it_raw(self):
        rule = _make_rule(operator=">=")
        await _put(
            rule,
            rule_type="COMPOSITE",
            conditions=[{"field": "battery", "operator": "lt", "threshold": 20, "weight": 1}],
        )

        assert (
            rule.conditions[0]["operator"] == "gte"
        ), "DB-format operator must map back to API format"

    @pytest.mark.asyncio
    async def test_preserves_device_scope(self):
        device_id = uuid4()
        rule = _make_rule(device_id=device_id)
        await _put(
            rule,
            rule_type="COMPOSITE",
            conditions=[{"field": "battery", "operator": "lt", "threshold": 20, "weight": 1}],
        )

        assert rule.device_id == device_id, "conversion must not widen a device rule to the tenant"

    @pytest.mark.asyncio
    async def test_converts_a_legacy_threshold_row(self):
        # Some rows store the API-format string directly rather than 'SIMPLE'.
        rule = _make_rule(rule_type="THRESHOLD")
        await _put(
            rule,
            rule_type="COMPOSITE",
            conditions=[{"field": "battery", "operator": "lt", "threshold": 20, "weight": 1}],
        )

        assert rule.rule_type == "COMPOSITE"
        assert len(rule.conditions) == 2

    @pytest.mark.asyncio
    async def test_defaults_logic_when_not_supplied(self):
        rule = _make_rule()
        await _put(
            rule,
            rule_type="COMPOSITE",
            conditions=[{"field": "battery", "operator": "lt", "threshold": 20, "weight": 1}],
        )

        assert rule.logic == "AND"

    @pytest.mark.asyncio
    async def test_rejects_conversion_when_there_is_no_metric_to_seed_from(self):
        rule = _make_rule(metric=None)
        with pytest.raises(HTTPException) as exc:
            await _put(
                rule,
                rule_type="COMPOSITE",
                conditions=[{"field": "battery", "operator": "lt", "threshold": 20, "weight": 1}],
            )
        assert exc.value.status_code == 400


class TestRejections:
    @pytest.mark.asyncio
    async def test_rejects_composite_to_threshold(self):
        rule = _make_rule(rule_type="COMPLEX")
        rule.conditions = [{"field": "a", "operator": "gt", "threshold": 1, "weight": 1}]

        with pytest.raises(HTTPException) as exc:
            await _put(rule, rule_type="THRESHOLD")
        assert exc.value.status_code == 400
        assert "COMPOSITE" in exc.value.detail

    @pytest.mark.asyncio
    async def test_rejects_emptying_a_composite_rules_conditions(self):
        rule = _make_rule(rule_type="COMPLEX")
        rule.conditions = [{"field": "a", "operator": "gt", "threshold": 1, "weight": 1}]

        with pytest.raises(HTTPException) as exc:
            await _put(rule, conditions=[])
        assert exc.value.status_code == 400


class TestNoConversionRequested:
    @pytest.mark.asyncio
    async def test_omitting_rule_type_leaves_the_rule_alone(self):
        rule = _make_rule()
        await _put(rule, threshold=95.0)

        assert rule.rule_type == "SIMPLE", "an omitted rule_type must not touch the column"
        assert rule.threshold == 95.0
        assert rule.conditions is None

    @pytest.mark.asyncio
    async def test_same_rule_type_is_a_no_op_not_a_conversion(self):
        rule = _make_rule(rule_type="COMPLEX")
        rule.conditions = [{"field": "a", "operator": "gt", "threshold": 1, "weight": 1}]

        await _put(
            rule,
            rule_type="COMPOSITE",
            conditions=[{"field": "b", "operator": "lt", "threshold": 2, "weight": 1}],
        )

        assert len(rule.conditions) == 1, "no seeding when the rule is already COMPOSITE"
        assert rule.conditions[0]["field"] == "b"
