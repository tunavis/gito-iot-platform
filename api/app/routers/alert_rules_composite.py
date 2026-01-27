"""Composite alert rules routes - multi-condition alerts with AND/OR logic."""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header, status, Query
from sqlalchemy import select, and_, func

from app.database import get_session, RLSSession
from app.models import CompositeAlertRule
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/alert-rules/composite", tags=["composite-alerts"])


async def get_current_tenant(
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )
    
    return UUID(tenant_id)


@router.get("")
async def list_composite_rules(
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    """List all composite alert rules for tenant."""
    await session.set_tenant_context(current_tenant)
    
    offset = (page - 1) * per_page
    
    result = await session.execute(
        select(CompositeAlertRule)
        .where(CompositeAlertRule.tenant_id == current_tenant)
        .order_by(CompositeAlertRule.created_at.desc())
        .offset(offset)
        .limit(per_page)
    )
    rules = result.scalars().all()
    
    return {"data": [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id),
            "name": r.name,
            "description": r.description,
            "enabled": r.enabled,
            "conditions": r.conditions or [],
            "logic": r.logic,
            "severity": r.severity,
            "weight_score": r.weight_score,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rules
    ]}


@router.post("")
async def create_composite_rule(
    rule_data: dict,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Create a new composite alert rule."""
    await session.set_tenant_context(current_tenant)
    
    rule = CompositeAlertRule(
        tenant_id=current_tenant,
        name=rule_data.get("name"),
        description=rule_data.get("description"),
        conditions=rule_data.get("conditions", []),
        logic=rule_data.get("logic", "AND"),
        severity=rule_data.get("severity", "warning"),
        weight_score=rule_data.get("weight_score"),
        enabled=rule_data.get("enabled", True),
    )
    
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    
    return {
        "id": str(rule.id),
        "name": rule.name,
        "description": rule.description,
        "enabled": rule.enabled,
        "conditions": rule.conditions,
        "logic": rule.logic,
        "severity": rule.severity,
        "weight_score": rule.weight_score,
    }


@router.get("/{rule_id}")
async def get_composite_rule(
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific composite alert rule."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(CompositeAlertRule).where(
            and_(
                CompositeAlertRule.id == rule_id,
                CompositeAlertRule.tenant_id == current_tenant
            )
        )
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    return {
        "id": str(rule.id),
        "name": rule.name,
        "description": rule.description,
        "enabled": rule.enabled,
        "conditions": rule.conditions,
        "logic": rule.logic,
        "severity": rule.severity,
        "weight_score": rule.weight_score,
    }


@router.put("/{rule_id}")
async def update_composite_rule(
    rule_id: UUID,
    rule_data: dict,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update a composite alert rule."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(CompositeAlertRule).where(
            and_(
                CompositeAlertRule.id == rule_id,
                CompositeAlertRule.tenant_id == current_tenant
            )
        )
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    # Update fields
    if "name" in rule_data:
        rule.name = rule_data["name"]
    if "description" in rule_data:
        rule.description = rule_data["description"]
    if "conditions" in rule_data:
        rule.conditions = rule_data["conditions"]
    if "logic" in rule_data:
        rule.logic = rule_data["logic"]
    if "severity" in rule_data:
        rule.severity = rule_data["severity"]
    if "weight_score" in rule_data:
        rule.weight_score = rule_data["weight_score"]
    if "enabled" in rule_data:
        rule.enabled = rule_data["enabled"]
    
    await session.commit()
    await session.refresh(rule)
    
    return {
        "id": str(rule.id),
        "name": rule.name,
        "description": rule.description,
        "enabled": rule.enabled,
        "conditions": rule.conditions,
        "logic": rule.logic,
        "severity": rule.severity,
        "weight_score": rule.weight_score,
    }


@router.delete("/{rule_id}")
async def delete_composite_rule(
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Delete a composite alert rule."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(CompositeAlertRule).where(
            and_(
                CompositeAlertRule.id == rule_id,
                CompositeAlertRule.tenant_id == current_tenant
            )
        )
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    await session.delete(rule)
    await session.commit()
    
    return {"success": True}


@router.post("/{rule_id}/preview")
async def preview_composite_rule(
    rule_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Preview what alerts would match this rule."""
    await session.set_tenant_context(current_tenant)
    
    result = await session.execute(
        select(CompositeAlertRule).where(
            and_(
                CompositeAlertRule.id == rule_id,
                CompositeAlertRule.tenant_id == current_tenant
            )
        )
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    # For now, return a simple preview response
    # In a real implementation, this would evaluate the rule against recent alerts
    return {
        "matching_alerts": 0,
        "sample_alerts": [],
        "evaluation_time_ms": 0,
    }
