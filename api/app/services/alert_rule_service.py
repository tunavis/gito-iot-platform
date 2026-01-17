"""Service for managing advanced composite alert rules."""

import logging
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.models import AlertRule, AlertRuleCondition
from app.schemas.advanced_alerts import (
    CreateCompositeAlertRuleSchema,
    UpdateCompositeAlertRuleSchema,
    CompositeAlertRuleResponseSchema,
    AlertRuleConditionResponseSchema,
)

logger = logging.getLogger(__name__)


class AlertRuleService:
    """Service for alert rule CRUD and management."""

    def __init__(self, session: Session, tenant_id: UUID):
        """Initialize service."""
        self.session = session
        self.tenant_id = tenant_id

    def create_composite_rule(
        self,
        create_schema: CreateCompositeAlertRuleSchema,
    ) -> CompositeAlertRuleResponseSchema:
        """Create a new composite alert rule with conditions.
        
        Args:
            create_schema: Rule creation data
            
        Returns:
            Created rule with conditions
        """
        # Create the rule itself
        rule = AlertRule(
            tenant_id=self.tenant_id,
            device_id=create_schema.device_id,
            metric=create_schema.name,  # Store rule name in metric field for now
            operator="composite",  # Indicates multi-condition rule
            threshold=0,  # Not used for composite rules
            cooldown_minutes=create_schema.cooldown_minutes,
            active="1" if create_schema.active else "0",
        )
        
        self.session.add(rule)
        self.session.flush()  # Get ID without committing
        
        # Create conditions
        conditions = []
        for cond_schema in create_schema.conditions:
            condition = AlertRuleCondition(
                rule_id=rule.id,
                field=cond_schema.field,
                operator=cond_schema.operator.value,  # Store the operator value (>, <, etc.)
                threshold=cond_schema.threshold,
                weight=cond_schema.weight,
                sequence=cond_schema.sequence,
            )
            self.session.add(condition)
            conditions.append(condition)
        
        self.session.commit()
        self.session.refresh(rule)
        
        logger.info(
            "composite_alert_rule_created",
            extra={
                "tenant_id": str(self.tenant_id),
                "rule_id": str(rule.id),
                "device_id": str(create_schema.device_id) if create_schema.device_id else "all_devices",
                "condition_count": len(conditions),
            },
        )
        
        return self._to_response(rule, conditions)

    def update_composite_rule(
        self,
        rule_id: UUID,
        update_schema: UpdateCompositeAlertRuleSchema,
    ) -> CompositeAlertRuleResponseSchema:
        """Update a composite alert rule.
        
        Args:
            rule_id: Rule UUID
            update_schema: Update data
            
        Returns:
            Updated rule
        """
        rule = self.session.exec(
            select(AlertRule).where(
                and_(
                    AlertRule.id == rule_id,
                    AlertRule.tenant_id == self.tenant_id,
                )
            )
        ).first()
        
        if not rule:
            raise ValueError(f"Rule {rule_id} not found")
        
        # Update fields
        if update_schema.name:
            rule.metric = update_schema.name
        if update_schema.cooldown_minutes is not None:
            rule.cooldown_minutes = update_schema.cooldown_minutes
        if update_schema.active is not None:
            rule.active = "1" if update_schema.active else "0"
        
        # Update conditions if provided
        conditions = []
        if update_schema.conditions is not None:
            # Delete existing conditions
            self.session.exec(
                select(AlertRuleCondition).where(
                    AlertRuleCondition.rule_id == rule_id
                )
            ).all()
            
            # Bulk delete
            for cond in self.session.exec(
                select(AlertRuleCondition).where(
                    AlertRuleCondition.rule_id == rule_id
                )
            ):
                self.session.delete(cond)
            
            # Create new conditions
            for cond_schema in update_schema.conditions:
                condition = AlertRuleCondition(
                    rule_id=rule.id,
                    field=cond_schema.field,
                    operator=cond_schema.operator.value,
                    threshold=cond_schema.threshold,
                    weight=cond_schema.weight,
                    sequence=cond_schema.sequence,
                )
                self.session.add(condition)
                conditions.append(condition)
        else:
            # Fetch existing conditions
            conditions = self.session.exec(
                select(AlertRuleCondition).where(
                    AlertRuleCondition.rule_id == rule_id
                )
            ).all()
        
        rule.updated_at = datetime.utcnow()
        self.session.commit()
        self.session.refresh(rule)
        
        logger.info(
            "composite_alert_rule_updated",
            extra={"rule_id": str(rule_id), "tenant_id": str(self.tenant_id)},
        )
        
        return self._to_response(rule, conditions)

    def get_rule(self, rule_id: UUID) -> Optional[CompositeAlertRuleResponseSchema]:
        """Get a specific rule."""
        rule = self.session.exec(
            select(AlertRule).where(
                and_(
                    AlertRule.id == rule_id,
                    AlertRule.tenant_id == self.tenant_id,
                )
            )
        ).first()
        
        if not rule:
            return None
        
        conditions = self.session.exec(
            select(AlertRuleCondition).where(
                AlertRuleCondition.rule_id == rule_id
            )
        ).all()
        
        return self._to_response(rule, conditions)

    def list_rules(
        self,
        device_id: Optional[UUID] = None,
        active_only: bool = False,
    ) -> List[CompositeAlertRuleResponseSchema]:
        """List alert rules."""
        query = select(AlertRule).where(
            AlertRule.tenant_id == self.tenant_id
        )
        
        if device_id:
            query = query.where(AlertRule.device_id == device_id)
        
        if active_only:
            query = query.where(AlertRule.active == "1")
        
        rules = self.session.exec(query).all()
        
        results = []
        for rule in rules:
            conditions = self.session.exec(
                select(AlertRuleCondition).where(
                    AlertRuleCondition.rule_id == rule.id
                )
            ).all()
            results.append(self._to_response(rule, conditions))
        
        return results

    def delete_rule(self, rule_id: UUID) -> bool:
        """Delete a rule and its conditions."""
        rule = self.session.exec(
            select(AlertRule).where(
                and_(
                    AlertRule.id == rule_id,
                    AlertRule.tenant_id == self.tenant_id,
                )
            )
        ).first()
        
        if not rule:
            return False
        
        self.session.delete(rule)
        self.session.commit()
        
        logger.info(
            "composite_alert_rule_deleted",
            extra={"rule_id": str(rule_id), "tenant_id": str(self.tenant_id)},
        )
        
        return True

    def mark_rule_fired(self, rule_id: UUID) -> None:
        """Mark rule as fired (update last_fired_at timestamp)."""
        rule = self.session.exec(
            select(AlertRule).where(AlertRule.id == rule_id)
        ).first()
        
        if rule:
            rule.last_fired_at = datetime.utcnow()
            self.session.commit()

    @staticmethod
    def _to_response(
        rule: AlertRule,
        conditions: List[AlertRuleCondition],
    ) -> CompositeAlertRuleResponseSchema:
        """Convert ORM models to response schema."""
        condition_schemas = [
            AlertRuleConditionResponseSchema(
                id=c.id,
                rule_id=c.rule_id,
                field=c.field,
                operator=c.operator,
                threshold=c.threshold,
                weight=c.weight,
                sequence=c.sequence,
                created_at=c.created_at,
            )
            for c in conditions
        ]
        
        return CompositeAlertRuleResponseSchema(
            id=rule.id,
            tenant_id=rule.tenant_id,
            device_id=rule.device_id,
            name=rule.metric,  # Retrieve rule name from metric field
            description=None,  # Would need to add to DB
            rule_type="COMPOSITE",
            condition_logic="AND",  # Would need to store in DB
            cooldown_minutes=rule.cooldown_minutes,
            active=rule.active == "1",
            last_fired_at=rule.last_fired_at,
            conditions=condition_schemas,
            created_at=rule.created_at,
            updated_at=rule.updated_at,
        )
