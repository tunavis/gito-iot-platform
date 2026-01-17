"""API routes for advanced composite alert rules."""

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_session
from app.models import User
from app.schemas.advanced_alerts import (
    CreateCompositeAlertRuleSchema,
    UpdateCompositeAlertRuleSchema,
    CompositeAlertRuleResponseSchema,
    RulePreviewRequestSchema,
    RulePreviewResponseSchema,
    BulkRuleEvaluationSchema,
    RuleEvaluationResultSchema,
)
from app.services.alert_rule_service import AlertRuleService
from app.services.alert_rule_engine import AlertRuleEvaluationEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/alert-rules", tags=["alert-rules"])


@router.post("/composite", response_model=CompositeAlertRuleResponseSchema)
async def create_composite_rule(
    rule_data: CreateCompositeAlertRuleSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Create a new composite alert rule.
    
    Composite rules support:
    - Multiple conditions (temp > 30 AND humidity > 80)
    - AND/OR logic
    - Weighted scoring
    - Cooldown periods
    """
    try:
        service = AlertRuleService(session, current_user.tenant_id)
        result = service.create_composite_rule(rule_data)
        return result
    except Exception as e:
        logger.error(f"Failed to create composite rule: {e}")
        raise HTTPException(status_code=500, detail="Failed to create rule")


@router.get("/composite/{rule_id}", response_model=CompositeAlertRuleResponseSchema)
async def get_composite_rule(
    rule_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Get a specific composite alert rule."""
    service = AlertRuleService(session, current_user.tenant_id)
    rule = service.get_rule(rule_id)
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    return rule


@router.get("/composite", response_model=List[CompositeAlertRuleResponseSchema])
async def list_composite_rules(
    device_id: Optional[UUID] = Query(None),
    active_only: bool = Query(False),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List composite alert rules for tenant."""
    service = AlertRuleService(session, current_user.tenant_id)
    rules = service.list_rules(device_id=device_id, active_only=active_only)
    return rules


@router.put("/composite/{rule_id}", response_model=CompositeAlertRuleResponseSchema)
async def update_composite_rule(
    rule_id: UUID,
    update_data: UpdateCompositeAlertRuleSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Update a composite alert rule."""
    try:
        service = AlertRuleService(session, current_user.tenant_id)
        result = service.update_composite_rule(rule_id, update_data)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to update composite rule: {e}")
        raise HTTPException(status_code=500, detail="Failed to update rule")


@router.delete("/composite/{rule_id}")
async def delete_composite_rule(
    rule_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Delete a composite alert rule."""
    service = AlertRuleService(session, current_user.tenant_id)
    success = service.delete_rule(rule_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    return {"success": True, "message": "Rule deleted"}


@router.post("/composite/{rule_id}/preview", response_model=RulePreviewResponseSchema)
async def preview_rule(
    rule_id: UUID,
    preview_data: RulePreviewRequestSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Preview rule evaluation against historical telemetry.
    
    Shows how many times the rule would have triggered in the
    last N hours of historical data.
    """
    service = AlertRuleService(session, current_user.tenant_id)
    rule = service.get_rule(rule_id)
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    # Create evaluation engine
    engine = AlertRuleEvaluationEngine(session, current_user.tenant_id)
    
    # Build rule dict for engine
    rule_dict = {
        "id": rule.id,
        "rule_type": "COMPOSITE",
        "conditions": [
            {
                "field": c.field,
                "operator": c.operator,
                "threshold": c.threshold,
                "weight": c.weight,
            }
            for c in rule.conditions
        ],
    }
    
    preview = engine.evaluate_rule_preview(
        rule.device_id or UUID("00000000-0000-0000-0000-000000000000"),
        rule_dict,
        hours=preview_data.hours,
    )
    
    return preview


@router.post("/evaluate", response_model=List[RuleEvaluationResultSchema])
async def evaluate_rules(
    eval_data: BulkRuleEvaluationSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Evaluate rules against current telemetry data.
    
    Returns which rules would trigger with the provided telemetry values.
    Useful for testing rules before deployment.
    """
    service = AlertRuleService(session, current_user.tenant_id)
    
    # Get active rules for device
    if eval_data.rule_ids:
        # Evaluate specific rules
        rules = []
        for rule_id in eval_data.rule_ids:
            rule = service.get_rule(rule_id)
            if rule:
                rules.append(rule)
    else:
        # Evaluate all active rules for device
        rules = service.list_rules(
            device_id=eval_data.device_id,
            active_only=True,
        )
    
    # Evaluate each rule
    engine = AlertRuleEvaluationEngine(session, current_user.tenant_id)
    
    results = []
    for rule in rules:
        # Build rule dict
        rule_dict = {
            "id": rule.id,
            "rule_type": "COMPOSITE",
            "conditions": [
                {
                    "field": c.field,
                    "operator": c.operator,
                    "threshold": c.threshold,
                    "weight": c.weight,
                }
                for c in rule.conditions
            ],
            "condition_logic": rule.condition_logic.value,
        }
        
        # Evaluate
        fired = engine.evaluate_telemetry(
            eval_data.device_id,
            eval_data.telemetry_data,
            [rule_dict],
        )
        
        if fired:
            result = fired[0]
            results.append(
                RuleEvaluationResultSchema(
                    rule_id=rule.id,
                    triggered=True,
                    timestamp=None,
                    score=result.get("score"),
                    details=result.get("details"),
                    reason=f"Rule {rule.name} triggered",
                )
            )
        else:
            results.append(
                RuleEvaluationResultSchema(
                    rule_id=rule.id,
                    triggered=False,
                    timestamp=None,
                    reason="Conditions not met",
                )
            )
    
    return results
