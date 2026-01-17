"""API endpoints for Grafana dashboard integration."""

import logging
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.database import get_session
from app.models import User, Tenant, Device, AlertRule

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/grafana", tags=["grafana"])


@router.get("/tenants")
async def list_tenants_for_grafana(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List all tenants for Grafana variable dropdown."""
    tenants = session.exec(select(Tenant)).all()
    
    return {
        "status": "ok",
        "data": [
            {
                "id": str(tenant.id),
                "text": tenant.name,
                "value": str(tenant.id),
            }
            for tenant in tenants
        ]
    }


@router.get("/devices")
async def list_devices_for_grafana(
    tenant_id: UUID = Query(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List devices for a tenant for Grafana variable dropdown."""
    devices = session.exec(
        select(Device).where(Device.tenant_id == tenant_id)
    ).all()
    
    return {
        "status": "ok",
        "data": [
            {
                "id": str(device.id),
                "text": device.name,
                "value": str(device.id),
            }
            for device in devices
        ]
    }


@router.get("/alert-rules")
async def list_alert_rules_for_grafana(
    tenant_id: UUID = Query(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """List alert rules for a tenant for Grafana variable dropdown."""
    rules = session.exec(
        select(AlertRule).where(AlertRule.tenant_id == tenant_id)
    ).all()
    
    return {
        "status": "ok",
        "data": [
            {
                "id": str(rule.id),
                "text": f"{rule.metric} {rule.operator} {rule.threshold}",
                "value": str(rule.id),
            }
            for rule in rules
        ]
    }


@router.get("/metrics")
async def get_latest_device_metrics(
    device_id: UUID = Query(...),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Get latest metrics for a device for Grafana display."""
    device = session.exec(
        select(Device).where(Device.id == device_id)
    ).first()
    
    if not device:
        return {"status": "error", "message": "Device not found"}
    
    return {
        "status": "ok",
        "data": {
            "device_id": str(device.id),
            "device_name": device.name,
            "status": device.status,
            "battery_level": device.battery_level,
            "signal_strength": device.signal_strength,
            "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        }
    }
