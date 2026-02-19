"""Analytics API - Fleet health metrics and dashboard statistics."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime, timedelta

from app.database import get_session, RLSSession
from app.models.base import Device, AuditLog
from app.models.alarm import Alarm
from app.schemas.common import SuccessResponse
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/analytics", tags=["analytics"])


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


@router.get("/fleet-overview", response_model=SuccessResponse)
async def get_fleet_overview(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get fleet-wide overview statistics.

    Returns:
        Device counts, status distribution, connectivity stats
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Total devices
    total_query = select(func.count(Device.id)).where(Device.tenant_id == tenant_id)
    total = (await session.execute(total_query)).scalar()

    # Status distribution
    status_query = select(
        Device.status,
        func.count(Device.id).label('count')
    ).where(Device.tenant_id == tenant_id).group_by(Device.status)
    status_result = await session.execute(status_query)
    status_dist = {row[0]: row[1] for row in status_result.fetchall()}

    # Device type distribution
    type_query = select(
        Device.device_type,
        func.count(Device.id).label('count')
    ).where(Device.tenant_id == tenant_id).group_by(Device.device_type)
    type_result = await session.execute(type_query)
    type_dist = {row[0]: row[1] for row in type_result.fetchall()}

    # Average battery level
    battery_query = select(func.avg(Device.battery_level)).where(
        Device.tenant_id == tenant_id,
        Device.battery_level.isnot(None)
    )
    avg_battery = (await session.execute(battery_query)).scalar() or 0

    # Devices with low battery (<20%)
    low_battery_query = select(func.count(Device.id)).where(
        Device.tenant_id == tenant_id,
        Device.battery_level < 20
    )
    low_battery_count = (await session.execute(low_battery_query)).scalar()

    return SuccessResponse(data={
        "total_devices": total,
        "status_distribution": status_dist,
        "device_type_distribution": type_dist,
        "average_battery_level": round(float(avg_battery), 1),
        "low_battery_devices": low_battery_count,
    })


@router.get("/alert-trends", response_model=SuccessResponse)
async def get_alert_trends(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    days: int = Query(30, ge=1, le=90, description="Number of days to analyze"),
):
    """Get alert/alarm trends over time.

    Args:
        days: Number of days to analyze (default: 30)

    Returns:
        Alert counts by severity, status, and time period
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    # Total alarms
    total_query = select(func.count(Alarm.id)).where(
        Alarm.tenant_id == tenant_id,
        Alarm.fired_at >= start_date
    )
    total_alarms = (await session.execute(total_query)).scalar()

    # Severity distribution
    severity_query = select(
        Alarm.severity,
        func.count(Alarm.id).label('count')
    ).where(
        Alarm.tenant_id == tenant_id,
        Alarm.fired_at >= start_date
    ).group_by(Alarm.severity)
    severity_result = await session.execute(severity_query)
    severity_dist = {row[0]: row[1] for row in severity_result.fetchall()}

    # Status distribution
    status_query = select(
        Alarm.status,
        func.count(Alarm.id).label('count')
    ).where(
        Alarm.tenant_id == tenant_id,
        Alarm.fired_at >= start_date
    ).group_by(Alarm.status)
    status_result = await session.execute(status_query)
    status_dist = {row[0]: row[1] for row in status_result.fetchall()}

    # Top alerting devices (with device name via join)
    top_devices_query = select(
        Alarm.device_id,
        Device.name,
        func.count(Alarm.id).label('count')
    ).join(
        Device, Device.id == Alarm.device_id, isouter=True
    ).where(
        Alarm.tenant_id == tenant_id,
        Alarm.fired_at >= start_date
    ).group_by(Alarm.device_id, Device.name).order_by(func.count(Alarm.id).desc()).limit(10)
    top_devices_result = await session.execute(top_devices_query)
    top_devices = [
        {"device_id": str(row[0]), "device_name": row[1] or str(row[0]), "alarm_count": row[2]}
        for row in top_devices_result.fetchall()
    ]

    # Daily alarm trend (last 30 days)
    daily_query = text("""
        SELECT
            DATE(fired_at) as date,
            COUNT(*)::integer as count
        FROM alarms
        WHERE tenant_id = :tenant_id
          AND fired_at >= :start_date
        GROUP BY DATE(fired_at)
        ORDER BY DATE(fired_at) ASC
    """)
    daily_result = await session.execute(daily_query, {
        "tenant_id": str(tenant_id),
        "start_date": start_date
    })
    daily_trend = [{"date": row[0].isoformat(), "count": row[1]} for row in daily_result.fetchall()]

    return SuccessResponse(data={
        "period": {
            "days": days,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
        "total_alarms": total_alarms,
        "severity_distribution": severity_dist,
        "status_distribution": status_dist,
        "top_alerting_devices": top_devices,
        "daily_trend": daily_trend,
    })


@router.get("/device-uptime", response_model=SuccessResponse)
async def get_device_uptime(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    days: int = Query(7, ge=1, le=30, description="Number of days to calculate uptime"),
):
    """Calculate device uptime statistics.

    Args:
        days: Number of days to analyze (default: 7)

    Returns:
        Uptime percentages and availability metrics
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Get all devices
    devices_query = select(Device).where(Device.tenant_id == tenant_id)
    devices_result = await session.execute(devices_query)
    devices = devices_result.scalars().all()

    # Calculate uptime (simplified: based on current status and last_seen)
    total_devices = len(devices)
    online_devices = len([d for d in devices if d.status == 'online'])

    # Calculate how many devices were seen in the last N days
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    active_devices = len([
        d for d in devices
        if d.last_seen and d.last_seen >= cutoff_date
    ])

    uptime_percentage = (online_devices / total_devices * 100) if total_devices > 0 else 0
    availability_percentage = (active_devices / total_devices * 100) if total_devices > 0 else 0

    return SuccessResponse(data={
        "period_days": days,
        "total_devices": total_devices,
        "online_now": online_devices,
        "active_in_period": active_devices,
        "uptime_percentage": round(uptime_percentage, 1),
        "availability_percentage": round(availability_percentage, 1),
    })


@router.get("/telemetry-summary", response_model=SuccessResponse)
async def get_telemetry_summary(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    hours: int = Query(24, ge=1, le=168, description="Number of hours to analyze"),
):
    """Get aggregated telemetry summary statistics.

    Args:
        hours: Number of hours to analyze (default: 24)

    Returns:
        Aggregated metrics across all devices
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Query telemetry stats
    query = text("""
        SELECT
            COUNT(*)::integer as message_count,
            ROUND(AVG(temperature)::numeric, 1) as avg_temperature,
            ROUND(AVG(humidity)::numeric, 1) as avg_humidity,
            ROUND(AVG(battery)::numeric, 1) as avg_battery,
            ROUND(AVG(rssi)::numeric, 0) as avg_rssi,
            COUNT(DISTINCT device_id)::integer as active_devices
        FROM telemetry_hot
        WHERE tenant_id = :tenant_id
          AND timestamp >= NOW() - INTERVAL ':hours hours'
    """)

    try:
        result = await session.execute(query, {
            "tenant_id": str(tenant_id),
            "hours": hours
        })
        row = result.fetchone()

        return SuccessResponse(data={
            "period_hours": hours,
            "message_count": row[0] if row else 0,
            "avg_temperature": float(row[1]) if row and row[1] else None,
            "avg_humidity": float(row[2]) if row and row[2] else None,
            "avg_battery": float(row[3]) if row and row[3] else None,
            "avg_signal_strength": int(row[4]) if row and row[4] else None,
            "active_devices": row[5] if row else 0,
        })
    except Exception as e:
        # If telemetry table doesn't exist or query fails, return zeros
        return SuccessResponse(data={
            "period_hours": hours,
            "message_count": 0,
            "avg_temperature": None,
            "avg_humidity": None,
            "avg_battery": None,
            "avg_signal_strength": None,
            "active_devices": 0,
        })
