"""Telemetry query routes - retrieve historical time-series data with aggregation."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_, text, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Literal
from uuid import UUID
from datetime import datetime, timedelta, timezone
import logging

from app.database import get_session, RLSSession
from app.models.base import Device, TelemetryHot
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenants/{tenant_id}/devices/{device_id}/telemetry", tags=["telemetry"])


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


class TelemetryAggregator:
    """Aggregates telemetry data over time periods."""

    @staticmethod
    def get_time_bucket_size(duration_hours: float) -> str:
        """Determine appropriate time bucket size based on query duration."""
        if duration_hours <= 1:
            return "minute"  # 1-minute buckets for last hour
        elif duration_hours <= 24:
            return "hour"  # 1-hour buckets for last 24 hours
        elif duration_hours <= 168:  # 1 week
            return "hour"  # Still hourly for week (6 hours not supported)
        else:
            return "day"  # 1-day buckets for longer periods


@router.get("", response_model=SuccessResponse)
async def query_telemetry(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    start_time: datetime = Query(..., description="Start time for query (ISO format)"),
    end_time: datetime = Query(None, description="End time for query (defaults to now)"),
    aggregation: Literal["raw", "avg", "min", "max", "sum"] = Query("raw", description="Aggregation type"),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=1000),
):
    """
    Query telemetry data for a device.
    
    Parameters:
    - start_time: Start timestamp (required, ISO 8601 format)
    - end_time: End timestamp (optional, defaults to now)
    - aggregation: Type of aggregation (raw, avg, min, max, sum)
    - page: Pagination page number
    - per_page: Results per page (max 1000)
    
    Returns paginated telemetry records with optionally aggregated values.
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )
    
    await session.set_tenant_context(tenant_id)
    
    # Verify device exists
    device_query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id == device_id,
    )
    device_result = await session.execute(device_query)
    device = device_result.scalar_one_or_none()
    
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )
    
    # Set default end_time to now if not provided
    if end_time is None:
        end_time = datetime.now(timezone.utc)
    
    # Validate time range
    if start_time >= end_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_time must be before end_time",
        )
    
    # For raw data, query directly from telemetry_hot table
    if aggregation == "raw":
        return await _query_raw_telemetry(
            session, tenant_id, device_id, start_time, end_time, page, per_page
        )
    else:
        return await _query_aggregated_telemetry(
            session, tenant_id, device_id, start_time, end_time, aggregation, page, per_page
        )


async def _query_raw_telemetry(
    session: RLSSession,
    tenant_id: UUID,
    device_id: UUID,
    start_time: datetime,
    end_time: datetime,
    page: int,
    per_page: int,
) -> SuccessResponse:
    """Query raw telemetry data using SQLAlchemy ORM."""
    offset = (page - 1) * per_page

    try:
        logger.debug(
            f"Querying telemetry - Device: {device_id}, "
            f"Range: {start_time.isoformat()} to {end_time.isoformat()}, "
            f"Page: {page}, Per page: {per_page}"
        )

        # Build base query with filters
        base_filters = and_(
            TelemetryHot.tenant_id == tenant_id,
            TelemetryHot.device_id == device_id,
            TelemetryHot.timestamp >= start_time,
            TelemetryHot.timestamp <= end_time
        )

        # Count query
        count_query = select(func.count(TelemetryHot.id)).where(base_filters)
        count_result = await session.execute(count_query)
        total = count_result.scalar() or 0

        # Data query with pagination
        data_query = (
            select(TelemetryHot)
            .where(base_filters)
            .order_by(desc(TelemetryHot.timestamp))
            .limit(per_page)
            .offset(offset)
        )

        result = await session.execute(data_query)
        telemetry_records = result.scalars().all()

        logger.debug(f"Retrieved {len(telemetry_records)} of {total} records for device {device_id}")

        # Format response
        data = [
            {
                "id": str(record.id),
                "device_id": str(record.device_id),
                "temperature": float(record.temperature) if record.temperature is not None else None,
                "humidity": float(record.humidity) if record.humidity is not None else None,
                "pressure": float(record.pressure) if record.pressure is not None else None,
                "battery": float(record.battery) if record.battery is not None else None,
                "rssi": int(record.rssi) if record.rssi is not None else None,
                "payload": record.payload if record.payload else {},
                "timestamp": record.timestamp.isoformat() if record.timestamp else None,
                "created_at": record.created_at.isoformat() if record.created_at else None,
            }
            for record in telemetry_records
        ]

        return SuccessResponse(
            data=data,
            meta=PaginationMeta(page=page, per_page=per_page, total=total),
        )

    except Exception as e:
        logger.error(
            f"Telemetry query failed - Device: {device_id}, Error: {type(e).__name__}: {str(e)}",
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query error: {type(e).__name__}: {str(e)}",
        )


async def _query_aggregated_telemetry(
    session: RLSSession,
    tenant_id: UUID,
    device_id: UUID,
    start_time: datetime,
    end_time: datetime,
    aggregation: str,
    page: int,
    per_page: int,
) -> SuccessResponse:
    """Query aggregated telemetry data using SQLAlchemy ORM with time bucketing."""

    try:
        # Calculate duration for time bucket selection
        duration = (end_time - start_time).total_seconds() / 3600  # hours
        bucket_size = TelemetryAggregator.get_time_bucket_size(duration)

        logger.debug(
            f"Aggregating telemetry - Device: {device_id}, Duration: {duration}h, "
            f"Bucket: {bucket_size}, Aggregation: {aggregation}"
        )

        # Validate aggregation function
        agg_func = aggregation.upper()
        if agg_func not in ["AVG", "MIN", "MAX", "SUM"]:
            agg_func = "AVG"

        # Use raw SQL for time bucketing (PostgreSQL-specific feature)
        # SQLAlchemy doesn't have good support for DATE_TRUNC in ORM
        query_sql = f"""
        SELECT
            DATE_TRUNC('{bucket_size}', timestamp) as time_bucket,
            {agg_func}(temperature) as temperature,
            {agg_func}(humidity) as humidity,
            {agg_func}(pressure) as pressure,
            {agg_func}(battery) as battery,
            {agg_func}(rssi) as rssi,
            COUNT(*) as sample_count
        FROM telemetry_hot
        WHERE tenant_id = :tenant_id
          AND device_id = :device_id
          AND timestamp >= :start_time
          AND timestamp <= :end_time
        GROUP BY DATE_TRUNC('{bucket_size}', timestamp)
        ORDER BY time_bucket DESC
        LIMIT :limit OFFSET :offset
        """

        count_sql = f"""
        SELECT COUNT(DISTINCT DATE_TRUNC('{bucket_size}', timestamp))
        FROM telemetry_hot
        WHERE tenant_id = :tenant_id
          AND device_id = :device_id
          AND timestamp >= :start_time
          AND timestamp <= :end_time
        """

        offset = (page - 1) * per_page

        # Execute count query
        count_result = await session.execute(
            text(count_sql),
            {
                "tenant_id": str(tenant_id),
                "device_id": str(device_id),
                "start_time": start_time,
                "end_time": end_time
            }
        )
        total = count_result.scalar() or 0

        # Execute data query
        result = await session.execute(
            text(query_sql),
            {
                "tenant_id": str(tenant_id),
                "device_id": str(device_id),
                "start_time": start_time,
                "end_time": end_time,
                "limit": per_page,
                "offset": offset
            }
        )

        rows = result.fetchall()

        # Format response
        data = [
            {
                "time_bucket": row[0].isoformat() if row[0] else None,
                "temperature": float(row[1]) if row[1] is not None else None,
                "humidity": float(row[2]) if row[2] is not None else None,
                "pressure": float(row[3]) if row[3] is not None else None,
                "battery": float(row[4]) if row[4] is not None else None,
                "rssi": float(row[5]) if row[5] is not None else None,
                "sample_count": int(row[6]) if row[6] else 0,
            }
            for row in rows
        ]

        return SuccessResponse(
            data=data,
            meta=PaginationMeta(page=page, per_page=per_page, total=total),
        )

    except Exception as e:
        logger.error(
            f"Aggregation query failed - Device: {device_id}, Error: {type(e).__name__}: {str(e)}",
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Aggregation query error: {type(e).__name__}: {str(e)}",
        )


@router.get("/latest", response_model=SuccessResponse)
async def get_latest_telemetry(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    minutes: int = Query(60, ge=1, le=1440, description="Look back N minutes"),
):
    """
    Get the latest telemetry record for a device using SQLAlchemy ORM.

    Parameters:
    - minutes: Look back period in minutes (1-1440, default 60)

    Returns the most recent telemetry reading within the time window.
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch",
        )

    await session.set_tenant_context(tenant_id)

    # Verify device exists
    device_query = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.id == device_id,
    )
    device_result = await session.execute(device_query)
    device = device_result.scalar_one_or_none()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    try:
        # Use timezone-aware datetime
        start_time = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        end_time = datetime.now(timezone.utc)

        # Query latest telemetry using ORM
        query = (
            select(TelemetryHot)
            .where(
                and_(
                    TelemetryHot.tenant_id == tenant_id,
                    TelemetryHot.device_id == device_id,
                    TelemetryHot.timestamp >= start_time,
                    TelemetryHot.timestamp <= end_time
                )
            )
            .order_by(desc(TelemetryHot.timestamp))
            .limit(1)
        )

        result = await session.execute(query)
        record = result.scalar_one_or_none()

        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No telemetry data found in the last {minutes} minutes",
            )

        data = {
            "id": str(record.id),
            "device_id": str(record.device_id),
            "temperature": float(record.temperature) if record.temperature is not None else None,
            "humidity": float(record.humidity) if record.humidity is not None else None,
            "pressure": float(record.pressure) if record.pressure is not None else None,
            "battery": float(record.battery) if record.battery is not None else None,
            "rssi": int(record.rssi) if record.rssi is not None else None,
            "payload": record.payload if record.payload else {},
            "timestamp": record.timestamp.isoformat() if record.timestamp else None,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }

        return SuccessResponse(data=data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to fetch latest telemetry for device {device_id}: {type(e).__name__}: {str(e)}",
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query error: {type(e).__name__}: {str(e)}",
        )
