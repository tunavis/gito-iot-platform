"""Analytics API - Fleet health metrics and dashboard statistics."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, and_, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime, timedelta, timezone
import logging

# Matches DeviceResponse.compute_effective_status — single source of truth for threshold
OFFLINE_THRESHOLD_SECONDS = 900

logger = logging.getLogger(__name__)

from app.database import get_session, RLSSession
from app.services.tenant_access import validate_tenant_access
from app.models.base import Device, AuditLog
from app.models.alarm import Alarm
from app.schemas.common import SuccessResponse
from app.dependencies import get_current_tenant

router = APIRouter(prefix="/tenants/{tenant_id}/analytics", tags=["analytics"])


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
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    # Total devices
    total_query = select(func.count(Device.id)).where(Device.tenant_id == tenant_id)
    total = (await session.execute(total_query)).scalar()

    # Status distribution — apply per-type offline threshold (falls back to 900s default).
    status_result = await session.execute(text("""
        SELECT
            CASE
                WHEN d.status = 'online'
                     AND (d.last_seen IS NULL
                          OR d.last_seen < NOW() - make_interval(
                              secs => COALESCE(
                                  (dt.default_settings->>'offline_threshold')::int,
                                  :default_threshold
                              )))
                THEN 'offline'
                ELSE d.status
            END AS effective_status,
            COUNT(*)::integer AS cnt
        FROM devices d
        LEFT JOIN device_types dt ON d.device_type_id = dt.id
        WHERE d.tenant_id = :tenant_id
        GROUP BY effective_status
    """), {"tenant_id": str(tenant_id), "default_threshold": OFFLINE_THRESHOLD_SECONDS})
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
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

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
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    # Get all devices
    devices_query = select(Device).where(Device.tenant_id == tenant_id)
    devices_result = await session.execute(devices_query)
    devices = devices_result.scalars().all()

    # Batch-load per-type thresholds
    type_ids = list({str(d.device_type_id) for d in devices if d.device_type_id})
    type_thresholds: dict[str, int] = {}
    if type_ids:
        placeholders = ", ".join(f":id{i}" for i in range(len(type_ids)))
        params = {f"id{i}": uid for i, uid in enumerate(type_ids)}
        thresh_result = await session.execute(text(
            f"SELECT id::text, (default_settings->>'offline_threshold')::int "
            f"FROM device_types WHERE id::text IN ({placeholders}) "
            f"AND default_settings->>'offline_threshold' IS NOT NULL"
        ), params)
        type_thresholds = {row[0]: row[1] for row in thresh_result}

    # Calculate uptime — apply per-type offline threshold so a device
    # that stopped reporting is not counted as online.
    total_devices = len(devices)
    now = datetime.now(timezone.utc)

    def _is_effectively_online(d) -> bool:
        if d.status != 'online':
            return False
        if d.last_seen is None:
            return True  # never reported; trust provisioned status
        threshold = type_thresholds.get(str(d.device_type_id), OFFLINE_THRESHOLD_SECONDS) if d.device_type_id else OFFLINE_THRESHOLD_SECONDS
        last = d.last_seen if d.last_seen.tzinfo else d.last_seen.replace(tzinfo=timezone.utc)
        return (now - last).total_seconds() <= threshold

    online_devices = len([d for d in devices if _is_effectively_online(d)])

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
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    try:
        # Count total messages and unique active devices
        count_query = text("""
            SELECT
                COUNT(*)::integer AS message_count,
                COUNT(DISTINCT device_id)::integer AS active_devices
            FROM telemetry
            WHERE tenant_id = :tenant_id
              AND ts >= NOW() - make_interval(hours => :hours)
        """)
        count_row = (await session.execute(count_query, {
            "tenant_id": str(tenant_id),
            "hours": hours,
        })).fetchone()

        # Get top numeric metrics with their fleet-wide averages
        metrics_query = text("""
            SELECT
                metric_key,
                ROUND(AVG(metric_value)::numeric, 2) AS avg_value,
                COUNT(*)::integer AS sample_count
            FROM telemetry
            WHERE tenant_id = :tenant_id
              AND ts >= NOW() - make_interval(hours => :hours)
              AND metric_value IS NOT NULL
            GROUP BY metric_key
            ORDER BY sample_count DESC
            LIMIT 8
        """)
        metrics_rows = (await session.execute(metrics_query, {
            "tenant_id": str(tenant_id),
            "hours": hours,
        })).fetchall()

        top_metrics = [
            {"key": row[0], "avg": float(row[1]) if row[1] is not None else 0.0, "count": row[2]}
            for row in metrics_rows
        ]

        return SuccessResponse(data={
            "period_hours": hours,
            "message_count": count_row[0] if count_row else 0,
            "active_devices": count_row[1] if count_row else 0,
            "top_metrics": top_metrics,
        })
    except Exception as e:
        logger.error(f"Telemetry summary failed: {e}", exc_info=True)
        return SuccessResponse(data={
            "period_hours": hours,
            "message_count": 0,
            "active_devices": 0,
            "top_metrics": [],
        })
