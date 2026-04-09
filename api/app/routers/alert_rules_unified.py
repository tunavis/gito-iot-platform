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
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_, text

from app.database import get_session, RLSSession
from app.models.unified_alert_rule import UnifiedAlertRule, OPERATOR_DB_TO_API
from app.models.base import Device, Telemetry
from app.schemas.alert_unified import (
    AlertRuleCreate,
    AlertRuleUpdate,
    AlertRuleResponse,
    RuleType,
)
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/alert-rules", tags=["alert-rules"])


async def get_current_tenant(
    tenant_id: UUID,
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token and verify against path."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    token_tenant_id = payload.get("tenant_id")
    
    if not token_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )
    
    # Verify path tenant matches token tenant
    if str(tenant_id) != str(token_tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    return UUID(token_tenant_id)


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
):
    """
    Preview rule evaluation against recent telemetry.
    
    Shows how many alerts would have been triggered in recent history.
    Useful for testing rules before enabling them.
    """
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
    
    start_ms = time.monotonic()

    preview_hours = 24
    cutoff = datetime.now(timezone.utc) - timedelta(hours=preview_hours)

    matching_alerts: list[dict] = []

    operator_map = {
        ">":  lambda v, t: v > t,
        ">=": lambda v, t: v >= t,
        "<":  lambda v, t: v < t,
        "<=": lambda v, t: v <= t,
        "==": lambda v, t: v == t,
        "!=": lambda v, t: v != t,
    }

    if rule.rule_type == "THRESHOLD" and rule.device_id and rule.metric and rule.operator and rule.threshold is not None:
        # Evaluate THRESHOLD rule against recent telemetry rows
        op_fn = operator_map.get(rule.operator)

        telemetry_rows = await session.execute(
            select(Telemetry.ts, Telemetry.metric_value)
            .where(
                and_(
                    Telemetry.tenant_id == current_tenant,
                    Telemetry.device_id == rule.device_id,
                    Telemetry.metric_key == rule.metric,
                    Telemetry.metric_value.isnot(None),
                    Telemetry.ts >= cutoff,
                )
            )
            .order_by(Telemetry.ts.desc())
            .limit(500)
        )
        rows = telemetry_rows.all()

        operator_api = OPERATOR_DB_TO_API.get(rule.operator, rule.operator)

        for row in rows:
            if op_fn and op_fn(row.metric_value, rule.threshold):
                matching_alerts.append({
                    "timestamp": row.ts.isoformat(),
                    "metric": rule.metric,
                    "value": row.metric_value,
                    "operator": operator_api,
                    "threshold": rule.threshold,
                })

    elif rule.rule_type in ("COMPOSITE", "COMPLEX") and rule.device_id and rule.conditions:
        # For COMPOSITE rules, fetch telemetry for all referenced metrics and evaluate each row
        metrics = list({c.get("field") for c in rule.conditions if c.get("field")})
        logic = (rule.logic or "AND").upper()

        if metrics:
            # Pivot rows by timestamp (1-minute buckets) to evaluate multi-metric conditions
            telemetry_rows = await session.execute(
                select(
                    func.date_trunc("minute", Telemetry.ts).label("bucket"),
                    Telemetry.metric_key,
                    func.avg(Telemetry.metric_value).label("avg_val"),
                )
                .where(
                    and_(
                        Telemetry.tenant_id == current_tenant,
                        Telemetry.device_id == rule.device_id,
                        Telemetry.metric_key.in_(metrics),
                        Telemetry.metric_value.isnot(None),
                        Telemetry.ts >= cutoff,
                    )
                )
                .group_by(text("bucket"), Telemetry.metric_key)
                .order_by(text("bucket DESC"))
                .limit(500)
            )
            rows = telemetry_rows.all()

            # Build bucket → {metric: value} mapping
            buckets: dict = defaultdict(dict)
            for row in rows:
                buckets[row.bucket][row.metric_key] = row.avg_val

            for bucket_ts, metric_values in sorted(buckets.items(), reverse=True):
                condition_results = []
                for cond in rule.conditions:
                    field = cond.get("field")
                    op = cond.get("operator", ">")
                    threshold = cond.get("threshold")
                    if field and threshold is not None and field in metric_values:
                        op_fn = operator_map.get(op)
                        if op_fn:
                            condition_results.append(op_fn(metric_values[field], threshold))

                if not condition_results:
                    continue

                triggered = all(condition_results) if logic == "AND" else any(condition_results)
                if triggered:
                    matching_alerts.append({
                        "timestamp": bucket_ts.isoformat(),
                        "metric_values": metric_values,
                        "conditions_met": sum(condition_results),
                        "conditions_total": len(condition_results),
                        "logic": logic,
                    })

    elapsed_ms = int((time.monotonic() - start_ms) * 1000)

    return {
        "rule_id": str(rule.id),
        "rule_name": rule.name or f"{rule.metric} Alert" if rule.metric else "Alert Rule",
        "rule_type": rule.rule_type,
        "preview_hours": preview_hours,
        "matching_alerts": len(matching_alerts),
        "sample_alerts": matching_alerts[:10],
        "evaluation_time_ms": elapsed_ms,
        "message": f"Found {len(matching_alerts)} matching events in the last {preview_hours} hours.",
    }
