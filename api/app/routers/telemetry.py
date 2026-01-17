"""Telemetry query routes - retrieve historical time-series data with aggregation."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_, text
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Literal
from uuid import UUID
from datetime import datetime, timedelta, timezone

from app.database import get_session, RLSSession
from app.models.base import Device
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

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
    """Query raw telemetry data."""
    from app.models.base import BaseModel
    
    # Import telemetry table dynamically to avoid circular imports
    # For now, we'll query the raw data from the telemetry_hot table
    # This requires direct SQL access
    
    query_sql = """
    SELECT id, device_id, temperature, humidity, pressure, battery, rssi, 
           payload, timestamp, created_at
    FROM telemetry_hot
    WHERE tenant_id = :tenant_id
      AND device_id = :device_id
      AND timestamp >= :start_time
      AND timestamp <= :end_time
    ORDER BY timestamp DESC
    LIMIT :limit OFFSET :offset
    """
    
    count_sql = """
    SELECT COUNT(*) as count
    FROM telemetry_hot
    WHERE tenant_id = :tenant_id
      AND device_id = :device_id
      AND timestamp >= :start_time
      AND timestamp <= :end_time
    """
    
    offset = (page - 1) * per_page
    
    try:
        # Execute count query
        count_result = await session.execute(
            text(count_sql),
            {"tenant_id": str(tenant_id), "device_id": str(device_id), 
             "start_time": start_time, "end_time": end_time}
        )
        total = count_result.scalar() or 0
        
        # Execute data query
        result = await session.execute(
            text(query_sql),
            {"tenant_id": str(tenant_id), "device_id": str(device_id), 
             "start_time": start_time, "end_time": end_time,
             "limit": per_page, "offset": offset}
        )
        
        rows = result.fetchall()
        
        # Format response
        data = [
            {
                "id": row[0],
                "device_id": str(row[1]),
                "temperature": row[2],
                "humidity": row[3],
                "pressure": row[4],
                "battery": row[5],
                "rssi": row[6],
                "payload": row[7],
                "timestamp": row[8].isoformat() if row[8] else None,
                "created_at": row[9].isoformat() if row[9] else None,
            }
            for row in rows
        ]
        
        return SuccessResponse(
            data=data,
            meta=PaginationMeta(page=page, per_page=per_page, total=total),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query error: {str(e)}",
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
    """Query aggregated telemetry data."""
    
    # Calculate duration for time bucket selection
    duration = (end_time - start_time).total_seconds() / 3600  # hours
    bucket_size = TelemetryAggregator.get_time_bucket_size(duration)
    
    # Build aggregation SQL
    agg_func = aggregation.upper()  # AVG, MIN, MAX, SUM
    
    if agg_func not in ["AVG", "MIN", "MAX", "SUM"]:
        agg_func = "AVG"
    
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
    
    try:
        # Execute count query
        count_result = await session.execute(
            text(count_sql),
            {"tenant_id": str(tenant_id), "device_id": str(device_id), 
             "start_time": start_time, "end_time": end_time}
        )
        total = count_result.scalar() or 0
        
        # Execute data query
        result = await session.execute(
            text(query_sql),
            {"tenant_id": str(tenant_id), "device_id": str(device_id), 
             "start_time": start_time, "end_time": end_time,
             "limit": per_page, "offset": offset}
        )
        
        rows = result.fetchall()
        
        # Format response
        data = [
            {
                "time_bucket": row[0].isoformat() if row[0] else None,
                "temperature": float(row[1]) if row[1] else None,
                "humidity": float(row[2]) if row[2] else None,
                "pressure": float(row[3]) if row[3] else None,
                "battery": float(row[4]) if row[4] else None,
                "rssi": float(row[5]) if row[5] else None,
                "sample_count": int(row[6]) if row[6] else 0,
            }
            for row in rows
        ]
        
        return SuccessResponse(
            data=data,
            meta=PaginationMeta(page=page, per_page=per_page, total=total),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Aggregation query error: {str(e)}",
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
    Get the latest telemetry record for a device.
    
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
    
    start_time = datetime.utcnow() - timedelta(minutes=minutes)
    end_time = datetime.utcnow()
    
    query_sql = """
    SELECT id, device_id, temperature, humidity, pressure, battery, rssi, 
           payload, timestamp, created_at
    FROM telemetry_hot
    WHERE tenant_id = :tenant_id
      AND device_id = :device_id
      AND timestamp >= :start_time
      AND timestamp <= :end_time
    ORDER BY timestamp DESC
    LIMIT 1
    """
    
    try:
        result = await session.execute(
            text(query_sql),
            {"tenant_id": str(tenant_id), "device_id": str(device_id), 
             "start_time": start_time, "end_time": end_time}
        )
        row = result.fetchone()
        
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No telemetry data found in the specified time range",
            )
        
        data = {
            "id": row[0],
            "device_id": str(row[1]),
            "temperature": row[2],
            "humidity": row[3],
            "pressure": row[4],
            "battery": row[5],
            "rssi": row[6],
            "payload": row[7],
            "timestamp": row[8].isoformat() if row[8] else None,
            "created_at": row[9].isoformat() if row[9] else None,
        }
        
        return SuccessResponse(data=data)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query error: {str(e)}",
        )
