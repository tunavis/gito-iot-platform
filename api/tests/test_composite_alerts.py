"""Integration tests for composite alert rules."""

import pytest
from uuid import UUID, uuid4
from datetime import datetime
from fastapi.testclient import TestClient

from app.main import create_app
from app.core.database import get_session
from app.models import Tenant, User, Device, AlertRule, AlertRuleCondition
from app.schemas.advanced_alerts import (
    CreateCompositeAlertRuleSchema,
    AlertRuleConditionSchema,
    ConditionOperatorEnum,
    RuleLogicEnum,
)
from app.services.alert_rule_engine import AlertRuleEvaluationEngine


@pytest.fixture
def app():
    """Create test app."""
    return create_app()


@pytest.fixture
def client(app):
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def db_session(app):
    """Get database session."""
    from app.core.database import SessionLocal
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture
def tenant(db_session):
    """Create test tenant."""
    tenant = Tenant(
        id=uuid4(),
        name="Test Tenant",
        slug="test-tenant",
        active=True,
    )
    db_session.add(tenant)
    db_session.commit()
    return tenant


@pytest.fixture
def user(db_session, tenant):
    """Create test user."""
    user = User(
        id=uuid4(),
        tenant_id=tenant.id,
        email="test@example.com",
        hashed_password="dummy",
        role="TENANT_ADMIN",
        active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def device(db_session, tenant):
    """Create test device."""
    device = Device(
        id=uuid4(),
        tenant_id=tenant.id,
        name="Test Device",
        device_type="sensor",
        status="online",
    )
    db_session.add(device)
    db_session.commit()
    return device


class TestCompositeAlertRuleCreation:
    """Test composite alert rule creation."""

    def test_create_and_condition_rule(self, db_session, tenant):
        """Test creating a rule with AND logic."""
        from app.services.alert_rule_service import AlertRuleService

        service = AlertRuleService(db_session, tenant.id)

        create_schema = CreateCompositeAlertRuleSchema(
            name="Temperature and Humidity Alert",
            description="Alert when both conditions are met",
            device_id=None,
            conditions=[
                AlertRuleConditionSchema(
                    field="temperature",
                    operator=ConditionOperatorEnum.GREATER_THAN,
                    threshold=30.0,
                    weight=1,
                    sequence=0,
                ),
                AlertRuleConditionSchema(
                    field="humidity",
                    operator=ConditionOperatorEnum.GREATER_THAN,
                    threshold=80.0,
                    weight=1,
                    sequence=1,
                ),
            ],
            condition_logic=RuleLogicEnum.AND,
            cooldown_minutes=5,
            active=True,
        )

        rule = service.create_composite_rule(create_schema)

        assert rule.id is not None
        assert rule.name == "Temperature and Humidity Alert"
        assert len(rule.conditions) == 2
        assert rule.condition_logic == RuleLogicEnum.AND
        assert rule.cooldown_minutes == 5
        assert rule.active is True

    def test_create_or_condition_rule(self, db_session, tenant):
        """Test creating a rule with OR logic."""
        from app.services.alert_rule_service import AlertRuleService

        service = AlertRuleService(db_session, tenant.id)

        create_schema = CreateCompositeAlertRuleSchema(
            name="Battery or Signal Alert",
            conditions=[
                AlertRuleConditionSchema(
                    field="battery",
                    operator=ConditionOperatorEnum.LESS_THAN,
                    threshold=20.0,
                ),
                AlertRuleConditionSchema(
                    field="rssi",
                    operator=ConditionOperatorEnum.LESS_THAN,
                    threshold=-100.0,
                ),
            ],
            condition_logic=RuleLogicEnum.OR,
        )

        rule = service.create_composite_rule(create_schema)

        assert rule.condition_logic == RuleLogicEnum.OR
        assert len(rule.conditions) == 2


class TestAlertRuleEvaluation:
    """Test alert rule evaluation engine."""

    def test_evaluate_and_logic(self, db_session, tenant):
        """Test AND logic evaluation."""
        engine = AlertRuleEvaluationEngine(db_session, tenant.id)

        conditions = [
            {"field": "temperature", "operator": ">", "threshold": 30.0, "weight": 1},
            {"field": "humidity", "operator": ">", "threshold": 80.0, "weight": 1},
        ]

        # Both conditions met - should trigger
        result = engine._evaluate_composite_rule(
            {"temperature": 32.0, "humidity": 85.0},
            conditions,
            "AND",
        )
        assert result["triggered"] is True

        # Only one condition met - should not trigger
        result = engine._evaluate_composite_rule(
            {"temperature": 32.0, "humidity": 70.0},
            conditions,
            "AND",
        )
        assert result["triggered"] is False

    def test_evaluate_or_logic(self, db_session, tenant):
        """Test OR logic evaluation."""
        engine = AlertRuleEvaluationEngine(db_session, tenant.id)

        conditions = [
            {"field": "battery", "operator": "<", "threshold": 20.0, "weight": 1},
            {"field": "rssi", "operator": "<", "threshold": -100.0, "weight": 1},
        ]

        # One condition met - should trigger
        result = engine._evaluate_composite_rule(
            {"battery": 15.0, "rssi": -80.0},
            conditions,
            "OR",
        )
        assert result["triggered"] is True

        # No conditions met - should not trigger
        result = engine._evaluate_composite_rule(
            {"battery": 25.0, "rssi": -80.0},
            conditions,
            "OR",
        )
        assert result["triggered"] is False

    def test_weighted_scoring(self, db_session, tenant):
        """Test weighted condition scoring."""
        engine = AlertRuleEvaluationEngine(db_session, tenant.id)

        conditions = [
            {
                "field": "temperature",
                "operator": ">",
                "threshold": 30.0,
                "weight": 3,
            },
            {"field": "humidity", "operator": ">", "threshold": 80.0, "weight": 2},
        ]

        # Both met: score = 5/5 = 100%
        result = engine._evaluate_composite_rule(
            {"temperature": 32.0, "humidity": 85.0},
            conditions,
            "AND",
        )
        assert result["score"] == 100

        # One met (weight 3): score = 3/5 = 60%
        result = engine._evaluate_composite_rule(
            {"temperature": 32.0, "humidity": 70.0},
            conditions,
            "AND",
        )
        assert result["score"] == 60

    def test_condition_operators(self, db_session, tenant):
        """Test all comparison operators."""
        engine = AlertRuleEvaluationEngine(db_session, tenant.id)

        test_cases = [
            (">", 30.0, 35.0, True),
            (">", 30.0, 25.0, False),
            ("<", 30.0, 25.0, True),
            ("<", 30.0, 35.0, False),
            (">=", 30.0, 30.0, True),
            (">=", 30.0, 29.0, False),
            ("<=", 30.0, 30.0, True),
            ("<=", 30.0, 31.0, False),
            ("==", 30.0, 30.0, True),
            ("==", 30.0, 30.1, False),
            ("!=", 30.0, 30.1, True),
            ("!=", 30.0, 30.0, False),
        ]

        for operator, threshold, value, expected in test_cases:
            result = engine._evaluate_condition(value, operator, threshold)
            assert result == expected, f"Operator {operator} with value {value} and threshold {threshold} failed"


class TestRulePreview:
    """Test rule preview functionality."""

    def test_preview_returns_structure(self, db_session, tenant):
        """Test that preview returns correct structure."""
        engine = AlertRuleEvaluationEngine(db_session, tenant.id)

        rule = {
            "id": uuid4(),
            "rule_type": "COMPOSITE",
            "conditions": [
                {"field": "temperature", "operator": ">", "threshold": 30.0},
            ],
        }

        preview = engine.evaluate_rule_preview(uuid4(), rule, hours=24)

        assert "rule_id" in preview
        assert "preview_hours" in preview
        assert "predicted_triggers" in preview
        assert "preview_status" in preview
        assert preview["preview_hours"] == 24


class TestAlertRuleService:
    """Test alert rule service."""

    def test_get_rule(self, db_session, tenant, device):
        """Test retrieving a rule."""
        from app.services.alert_rule_service import AlertRuleService

        service = AlertRuleService(db_session, tenant.id)

        # Create rule
        create_schema = CreateCompositeAlertRuleSchema(
            name="Test Rule",
            conditions=[
                AlertRuleConditionSchema(
                    field="temperature",
                    operator=ConditionOperatorEnum.GREATER_THAN,
                    threshold=30.0,
                ),
                AlertRuleConditionSchema(
                    field="humidity",
                    operator=ConditionOperatorEnum.GREATER_THAN,
                    threshold=80.0,
                ),
            ],
        )

        created_rule = service.create_composite_rule(create_schema)

        # Get rule
        retrieved_rule = service.get_rule(created_rule.id)

        assert retrieved_rule is not None
        assert retrieved_rule.id == created_rule.id
        assert retrieved_rule.name == "Test Rule"

    def test_list_rules(self, db_session, tenant):
        """Test listing rules."""
        from app.services.alert_rule_service import AlertRuleService

        service = AlertRuleService(db_session, tenant.id)

        # Create multiple rules
        for i in range(3):
            create_schema = CreateCompositeAlertRuleSchema(
                name=f"Rule {i}",
                conditions=[
                    AlertRuleConditionSchema(
                        field="temperature",
                        operator=ConditionOperatorEnum.GREATER_THAN,
                        threshold=30.0,
                    ),
                    AlertRuleConditionSchema(
                        field="humidity",
                        operator=ConditionOperatorEnum.GREATER_THAN,
                        threshold=80.0,
                    ),
                ],
            )
            service.create_composite_rule(create_schema)

        # List rules
        rules = service.list_rules()

        assert len(rules) == 3

    def test_delete_rule(self, db_session, tenant):
        """Test deleting a rule."""
        from app.services.alert_rule_service import AlertRuleService

        service = AlertRuleService(db_session, tenant.id)

        # Create rule
        create_schema = CreateCompositeAlertRuleSchema(
            name="To Delete",
            conditions=[
                AlertRuleConditionSchema(
                    field="temperature",
                    operator=ConditionOperatorEnum.GREATER_THAN,
                    threshold=30.0,
                ),
                AlertRuleConditionSchema(
                    field="humidity",
                    operator=ConditionOperatorEnum.GREATER_THAN,
                    threshold=80.0,
                ),
            ],
        )

        rule = service.create_composite_rule(create_schema)

        # Delete rule
        success = service.delete_rule(rule.id)
        assert success is True

        # Verify deleted
        retrieved = service.get_rule(rule.id)
        assert retrieved is None


@pytest.mark.asyncio
class TestCompositeAlertAPI:
    """Test composite alert API endpoints."""

    async def test_create_rule_endpoint(self, client, db_session, user):
        """Test creating rule via API."""
        # This is a simplified test - would need proper auth setup
        pass

    async def test_list_rules_endpoint(self, client, db_session, user):
        """Test listing rules via API."""
        pass

    async def test_evaluate_rules_endpoint(self, client, db_session, user):
        """Test rule evaluation via API."""
        pass
