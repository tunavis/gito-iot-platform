"""Unified Alert Rules router - supports both THRESHOLD and COMPOSITE alert types.

Industry best practice: Single endpoint with type discrimination.
Pattern follows AWS CloudWatch, Datadog, PagerDuty, and Prometheus.

Endpoints:
- GET    /tenants/{tenant_id}/alert-rules              - List all rules (with type filter)
- POST   /tenants/{tenant_id}/alert-rules              - Create rule (any type)
- GET    /tenants/{tenant_id}/alert-rules/{rule_id}   - Get rule details
- PUT    /tenants/{tenant_id}/alert-rules/{rule_id}   - Update rule
- DELETE /tenants/{tenant_id}/alert-rules/{rule_id}   - Delete rule
- POST   /tenants/{tenant_id}/alert-rules/{rule_id}/preview - Preview rule evaluation
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, and_, text

from alarm_core import Rule as AlarmRule, evaluate as evaluate_alarm_rules

from app.database import get_session, RLSSession
from app.models.unified_alert_rule import UnifiedAlertRule
from app.models.base import Device
from app.schemas.alert_unified import (
    AlertRuleCreate,
    AlertRuleUpdate,
    AlertRuleResponse,
    RuleType,
)
from app.schemas.common import SuccessResponse, PaginationMeta
from app.dependencies import get_current_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/alert-rules", tags=["alert-rules"])


# ============================================================================
# LIST ALERT RULES
# ============================================================================

@router.get("")
async def list_alert_rules(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    rule_type: Optional[str] = Query(None, description="Filter by rule type: THRESHOLD, COMPOSITE"),
    device_id: Optional[UUID] = Query(None, description="Filter by device (THRESHOLD rules only)"),
    severity: Optional[str] = Query(None, description="Filter by severity: info, warning, critical"),
    enabled: Optional[bool] = Query(None, description="Filter by enabled status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """
    List all alert rules for tenant with optional filters.
    
    Supports both THRESHOLD and COMPOSITE rule types in a single unified list.

    Filters:
    - rule_type: THRESHOLD or COMPOSITE
    - device_id: Filter by specific device (THRESHOLD rules)
    - severity: info, warning, critical
    - enabled: true or false
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    # Build query
    query = select(UnifiedAlertRule).where(UnifiedAlertRule.tenant_id == current_tenant)
    count_query = select(func.count(UnifiedAlertRule.id)).where(UnifiedAlertRule.tenant_id == current_tenant)
    
    # Apply filters
    if rule_type:
        query = query.where(UnifiedAlertRule.rule_type == rule_type.upper())
        count_query = count_query.where(UnifiedAlertRule.rule_type == rule_type.upper())
    
    if device_id:
        query = query.where(UnifiedAlertRule.device_id == device_id)
        count_query = count_query.where(UnifiedAlertRule.device_id == device_id)
    
    if severity:
        query = query.where(UnifiedAlertRule.severity == severity.lower())
        count_query = count_query.where(UnifiedAlertRule.severity == severity.lower())
    
    if enabled is not None:
        query = query.where(UnifiedAlertRule.enabled == enabled)
        count_query = count_query.where(UnifiedAlertRule.enabled == enabled)
    
    # Get total count
    count_result = await session.execute(count_query)
    total = count_result.scalar() or 0
    
    # Pagination
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page).order_by(UnifiedAlertRule.created_at.desc())
    
    result = await session.execute(query)
    rules = result.scalars().all()
    
    return {
        "data": [rule.to_response_dict() for rule in rules],
        "meta": {
            "page": page,
            "per_page": per_page,
            "total": total,
        }
    }


# ============================================================================
# CREATE ALERT RULE
# ============================================================================

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    tenant_id: UUID,
    rule_data: AlertRuleCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """
    Create a new alert rule.
    
    For THRESHOLD rules, provide:
    - metric, operator, threshold (required)
    - device_id (optional - null = global rule)
    
    For COMPOSITE rules, provide:
    - conditions (array), logic (AND/OR)
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    # Validate based on rule type
    if rule_data.rule_type == RuleType.THRESHOLD:
        # Validate required THRESHOLD fields (device_id is optional for global rules)
        if not rule_data.metric:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="metric is required for THRESHOLD rules",
            )
        if not rule_data.operator:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="operator is required for THRESHOLD rules",
            )
        if rule_data.threshold is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="threshold is required for THRESHOLD rules",
            )
        
        # If device_id provided, verify device exists and belongs to tenant
        if rule_data.device_id:
            device_result = await session.execute(
                select(Device).where(
                    Device.tenant_id == current_tenant,
                    Device.id == rule_data.device_id,
                )
            )
            device = device_result.scalar_one_or_none()
            if not device:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Device not found",
                )
        
        # Create THRESHOLD rule
        rule = UnifiedAlertRule(
            tenant_id=current_tenant,
            name=rule_data.name,
            description=rule_data.description,
            rule_type="THRESHOLD",
            severity=rule_data.severity.value,
            enabled=rule_data.enabled,
            device_id=rule_data.device_id,
            metric=rule_data.metric,
            operator=rule_data.operator,
            threshold=rule_data.threshold,
            cooldown_minutes=rule_data.cooldown_minutes,
        )
    
    elif rule_data.rule_type == RuleType.COMPOSITE:
        # Validate required COMPOSITE fields
        if not rule_data.conditions or len(rule_data.conditions) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="conditions are required for COMPOSITE rules (at least 1)",
            )
        
        # Convert conditions to JSON-serializable format
        conditions_json = [
            {
                "field": c.field,
                "operator": c.operator,
                "threshold": c.threshold,
                "weight": c.weight,
            }
            for c in rule_data.conditions
        ]
        
        # Create COMPOSITE rule
        rule = UnifiedAlertRule(
            tenant_id=current_tenant,
            name=rule_data.name,
            description=rule_data.description,
            rule_type="COMPOSITE",
            severity=rule_data.severity.value,
            enabled=rule_data.enabled,
            conditions=conditions_json,
            logic=rule_data.logic.value if rule_data.logic else "AND",
            cooldown_minutes=rule_data.cooldown_minutes,
        )
    
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown rule_type: {rule_data.rule_type}",
        )
    
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    
    logger.info(f"Created {rule.rule_type} alert rule: {rule.name} ({rule.id})")
    
    return {"data": rule.to_response_dict()}


# ============================================================================
# GET ALERT RULE
# ============================================================================

@router.get("/{rule_id}")
async def get_alert_rule(
    tenant_id: UUID,
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get alert rule details."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(UnifiedAlertRule).where(
            and_(
                UnifiedAlertRule.tenant_id == current_tenant,
                UnifiedAlertRule.id == rule_id,
            )
        )
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found",
        )
    
    return {"data": rule.to_response_dict()}


# ============================================================================
# UPDATE ALERT RULE
# ============================================================================

@router.put("/{rule_id}")
async def update_alert_rule(
    tenant_id: UUID,
    rule_id: UUID,
    rule_data: AlertRuleUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update an existing alert rule."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(UnifiedAlertRule).where(
            and_(
                UnifiedAlertRule.tenant_id == current_tenant,
                UnifiedAlertRule.id == rule_id,
            )
        )
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found",
        )
    
    # Update common fields
    if rule_data.name is not None:
        rule.name = rule_data.name
    if rule_data.description is not None:
        rule.description = rule_data.description
    if rule_data.severity is not None:
        rule.severity = rule_data.severity.value
    if rule_data.enabled is not None:
        rule.enabled = rule_data.enabled
    if rule_data.cooldown_minutes is not None:
        rule.cooldown_minutes = rule_data.cooldown_minutes
    
    # Update THRESHOLD-specific fields (only for THRESHOLD rules)
    if rule.rule_type == "THRESHOLD":
        if rule_data.metric is not None:
            rule.metric = rule_data.metric
        if rule_data.operator is not None:
            rule.operator = rule_data.operator
        if rule_data.threshold is not None:
            rule.threshold = rule_data.threshold
    
    # Update COMPOSITE-specific fields (only for COMPOSITE rules)
    if rule.rule_type == "COMPOSITE":
        if rule_data.conditions is not None:
            rule.conditions = [
                {
                    "field": c.field,
                    "operator": c.operator,
                    "threshold": c.threshold,
                    "weight": c.weight,
                }
                for c in rule_data.conditions
            ]
        if rule_data.logic is not None:
            rule.logic = rule_data.logic.value
    
    await session.commit()
    await session.refresh(rule)
    
    logger.info(f"Updated alert rule: {rule.name} ({rule.id})")
    
    return {"data": rule.to_response_dict()}


# ============================================================================
# DELETE ALERT RULE
# ============================================================================

@router.delete("/{rule_id}")
async def delete_alert_rule(
    tenant_id: UUID,
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete an alert rule."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(UnifiedAlertRule).where(
            and_(
                UnifiedAlertRule.tenant_id == current_tenant,
                UnifiedAlertRule.id == rule_id,
            )
        )
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found",
        )
    
    await session.delete(rule)
    await session.commit()
    
    logger.info(f"Deleted alert rule: {rule.name} ({rule.id})")
    
    return {"success": True, "message": "Alert rule deleted"}


# ============================================================================
# PREVIEW RULE EVALUATION
# ============================================================================

@router.post("/{rule_id}/preview")
async def preview_alert_rule(
    tenant_id: UUID,
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    hours: int = Query(24, ge=1, le=720, description="Hours of history to replay"),
):
    """Preview a rule against recent telemetry.

    Replays the last N hours of the device's telemetry through the SAME
    evaluation engine the processor uses (alarm_core), reconstructing one
    payload per timestamp, and reports how often the rule would have fired
    (cooldown honoured). Lets operators test a rule before enabling it.
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    await session.set_tenant_context(current_tenant)

    result = await session.execute(
        select(UnifiedAlertRule).where(
            and_(
                UnifiedAlertRule.tenant_id == current_tenant,
                UnifiedAlertRule.id == rule_id,
            )
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert rule not found")

    started = time.monotonic()
    rule_type = "COMPOSITE" if (rule.rule_type or "").upper() in ("COMPOSITE", "COMPLEX") else "THRESHOLD"

    # Determine which metrics this rule reads, so the replay query stays narrow
    if rule_type == "COMPOSITE":
        metrics = [c.get("field") for c in (rule.conditions or []) if c.get("field")]
    else:
        metrics = [rule.metric] if rule.metric else []
    if not metrics:
        return {
            "rule_id": str(rule.id), "rule_name": rule.name, "rule_type": rule.rule_type,
            "matching_alerts": 0, "sample_alerts": [], "preview_hours": hours,
            "evaluation_time_ms": 0, "message": "Rule has no metrics to evaluate",
        }

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    # Only global rules (device_id NULL) span devices; else scope to the rule's device.
    device_filter = "" if rule.device_id is None else "AND device_id = :device_id"
    params = {"cutoff": cutoff, "metrics": metrics}
    if rule.device_id is not None:
        params["device_id"] = str(rule.device_id)

    rows = (await session.execute(
        text(f"""
            SELECT device_id, ts, metric_key, metric_value
            FROM telemetry
            WHERE ts >= :cutoff AND metric_key = ANY(:metrics)
              AND metric_value IS NOT NULL {device_filter}
            ORDER BY device_id, ts
        """),
        params,
    )).fetchall()

    # Reconstruct payloads: group same-device rows within a 1s window into one
    # "reading" (telemetry is stored one row per metric at a shared timestamp).
    core_rule = AlarmRule(
        id=str(rule.id), rule_type=rule_type,
        metric=rule.metric, operator=rule.operator, threshold=rule.threshold,
        conditions=rule.conditions, logic=rule.logic,
        severity=rule.severity or "MAJOR",
        cooldown_minutes=rule.cooldown_minutes or 0,
        last_fired_at=None,
    )

    matching = 0
    samples: list[dict] = []
    last_fired: dict[str, datetime] = {}   # per-device cooldown tracking
    buckets: dict[tuple, dict] = {}
    order: list[tuple] = []
    for r in rows:
        key = (str(r.device_id), r.ts.replace(microsecond=0))
        if key not in buckets:
            buckets[key] = {}
            order.append(key)
        buckets[key][r.metric_key] = r.metric_value

    for key in order:
        device_id, ts = key
        payload = buckets[key]
        core_rule.last_fired_at = last_fired.get(device_id)
        firings = evaluate_alarm_rules([core_rule], payload, ts)
        if firings:
            matching += 1
            last_fired[device_id] = ts
            if len(samples) < 20:
                f = firings[0]
                samples.append({
                    "device_id": device_id,
                    "timestamp": ts.isoformat(),
                    "message": f.message,
                    "value": f.value,
                })

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return {
        "rule_id": str(rule.id),
        "rule_name": rule.name,
        "rule_type": rule.rule_type,
        "preview_hours": hours,
        "readings_evaluated": len(order),
        "matching_alerts": matching,
        "sample_alerts": samples,
        "evaluation_time_ms": elapsed_ms,
        "message": f"Rule would have fired {matching} time(s) in the last {hours}h",
    }
