"""
Telemetry API - Query time-series data with aggregation support.

Uses key-value storage pattern (industry-standard like ThingsBoard/Cumulocity):
- One row per metric per timestamp
- Supports unlimited dynamic metrics per device
- Efficient queries for specific metrics or all metrics
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, and_, text, desc
from typing import Annotated, Literal, Optional, List, Any, Dict
from uuid import UUID
from datetime import datetime, timedelta, timezone
import logging
import json as _json

from app.database import get_session, RLSSession
from app.models.base import Device, Telemetry
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
            return "hour"  # Still hourly for week
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
    metrics: Optional[str] = Query(None, description="Comma-separated list of metrics (e.g., 'temperature,humidity')"),
    aggregation: Literal["raw", "avg", "min", "max", "sum"] = Query("raw", description="Aggregation type"),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=1000),
):
    """
    Query telemetry data for a device.

    Parameters:
    - start_time: Start timestamp (required, ISO 8601 format)
    - end_time: End timestamp (optional, defaults to now)
    - metrics: Comma-separated list of metric keys to filter (optional, defaults to all)
    - aggregation: Type of aggregation (raw, avg, min, max, sum)
    - page: Pagination page number
    - per_page: Results per page (max 1000)

    Returns telemetry data pivoted by timestamp with all metrics as columns.
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

    # Parse metrics filter
    metric_keys = None
    if metrics:
        metric_keys = [m.strip() for m in metrics.split(",") if m.strip()]

    if aggregation == "raw":
        return await _query_raw_telemetry(
            session, tenant_id, device_id, start_time, end_time, metric_keys, page, per_page
        )
    else:
        return await _query_aggregated_telemetry(
            session, tenant_id, device_id, start_time, end_time, metric_keys, aggregation, page, per_page
        )


async def _query_raw_telemetry(
    session: RLSSession,
    tenant_id: UUID,
    device_id: UUID,
    start_time: datetime,
    end_time: datetime,
    metric_keys: Optional[List[str]],
    page: int,
    per_page: int,
) -> SuccessResponse:
    """
    Query raw telemetry data.

    Returns data pivoted by timestamp - each row represents one point in time
    with all metrics as key-value pairs.
    """
    offset = (page - 1) * per_page

    try:
        logger.debug(
            f"Querying telemetry - Device: {device_id}, "
            f"Range: {start_time.isoformat()} to {end_time.isoformat()}, "
            f"Metrics: {metric_keys or 'all'}, Page: {page}"
        )

        # Build metric filter clause
        metric_filter = ""
        if metric_keys:
            # Safely parameterize metric keys
            metric_filter = "AND metric_key = ANY(:metric_keys)"

        # Query to pivot key-value rows back to object format
        # Groups by timestamp and aggregates all metrics for that timestamp
        query_sql = f"""
        WITH distinct_timestamps AS (
            SELECT DISTINCT ts
            FROM telemetry
            WHERE tenant_id = :tenant_id
              AND device_id = :device_id
              AND ts >= :start_time
              AND ts <= :end_time
            ORDER BY ts DESC
            LIMIT :limit OFFSET :offset
        )
        SELECT
            dt.ts as timestamp,
            jsonb_object_agg(
                t.metric_key,
                COALESCE(t.metric_value::text, t.metric_value_str, t.metric_value_json::text)
            ) as metrics
        FROM distinct_timestamps dt
        JOIN telemetry t ON t.ts = dt.ts
            AND t.tenant_id = :tenant_id
            AND t.device_id = :device_id
            {metric_filter}
        GROUP BY dt.ts
        ORDER BY dt.ts DESC
        """

        # Count distinct timestamps
        count_sql = f"""
        SELECT COUNT(DISTINCT ts)
        FROM telemetry
        WHERE tenant_id = :tenant_id
          AND device_id = :device_id
          AND ts >= :start_time
          AND ts <= :end_time
        """

        params = {
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "start_time": start_time,
            "end_time": end_time,
            "limit": per_page,
            "offset": offset,
        }
        if metric_keys:
            params["metric_keys"] = metric_keys

        # Execute count query
        count_result = await session.execute(text(count_sql), params)
        total = count_result.scalar() or 0

        # Execute data query
        result = await session.execute(text(query_sql), params)
        rows = result.fetchall()

        logger.debug(f"Retrieved {len(rows)} of {total} timestamps for device {device_id}")

        # Format response - convert JSONB to proper Python dict with typed values
        data = []
        for row in rows:
            timestamp = row[0]
            metrics_json = row[1] or {}

            # Parse numeric values from the aggregated JSON
            record = {
                "timestamp": timestamp.isoformat() if timestamp else None,
                "device_id": str(device_id),
            }

            # Add each metric with proper type conversion
            for key, value in metrics_json.items():
                if value is None:
                    record[key] = None
                else:
                    # Try to parse as number
                    try:
                        if "." in str(value):
                            record[key] = float(value)
                        else:
                            record[key] = int(value)
                    except (ValueError, TypeError):
                        record[key] = value

            data.append(record)

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
    metric_keys: Optional[List[str]],
    aggregation: str,
    page: int,
    per_page: int,
) -> SuccessResponse:
    """Query aggregated telemetry data with time bucketing."""

    try:
        # Calculate duration for time bucket selection
        duration = (end_time - start_time).total_seconds() / 3600  # hours
        bucket_size = TelemetryAggregator.get_time_bucket_size(duration)

        logger.debug(
            f"Aggregating telemetry - Device: {device_id}, Duration: {duration}h, "
            f"Bucket: {bucket_size}, Aggregation: {aggregation}, Metrics: {metric_keys or 'all'}"
        )

        # Validate aggregation function
        agg_func = aggregation.upper()
        if agg_func not in ["AVG", "MIN", "MAX", "SUM"]:
            agg_func = "AVG"

        # Build metric filter clause
        metric_filter = ""
        if metric_keys:
            metric_filter = "AND metric_key = ANY(:metric_keys)"

        # Query with time bucketing and metric aggregation
        query_sql = f"""
        SELECT
            DATE_TRUNC('{bucket_size}', ts) as time_bucket,
            metric_key,
            {agg_func}(metric_value) as value,
            COUNT(*) as sample_count
        FROM telemetry
        WHERE tenant_id = :tenant_id
          AND device_id = :device_id
          AND ts >= :start_time
          AND ts <= :end_time
          AND metric_value IS NOT NULL
          {metric_filter}
        GROUP BY DATE_TRUNC('{bucket_size}', ts), metric_key
        ORDER BY time_bucket DESC, metric_key
        """

        count_sql = f"""
        SELECT COUNT(DISTINCT DATE_TRUNC('{bucket_size}', ts))
        FROM telemetry
        WHERE tenant_id = :tenant_id
          AND device_id = :device_id
          AND ts >= :start_time
          AND ts <= :end_time
        """

        offset = (page - 1) * per_page

        params = {
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "start_time": start_time,
            "end_time": end_time,
        }
        if metric_keys:
            params["metric_keys"] = metric_keys

        # Execute count query
        count_result = await session.execute(text(count_sql), params)
        total = count_result.scalar() or 0

        # Execute data query
        result = await session.execute(text(query_sql), params)
        rows = result.fetchall()

        # Pivot the results: group by time_bucket, with metrics as keys
        buckets = {}
        for row in rows:
            time_bucket = row[0]
            metric_key = row[1]
            value = row[2]
            sample_count = row[3]

            bucket_key = time_bucket.isoformat() if time_bucket else None
            if bucket_key not in buckets:
                buckets[bucket_key] = {
                    "time_bucket": bucket_key,
                    "sample_count": 0,
                }

            buckets[bucket_key][metric_key] = float(value) if value is not None else None
            buckets[bucket_key]["sample_count"] += sample_count

        # Convert to list and apply pagination
        data = list(buckets.values())

        # Sort by time_bucket descending and apply pagination
        data.sort(key=lambda x: x["time_bucket"] or "", reverse=True)
        paginated_data = data[offset:offset + per_page]

        return SuccessResponse(
            data=paginated_data,
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
    minutes: int = Query(60, ge=1, le=43200, description="Look back N minutes (max 30 days)"),
    metrics: Optional[str] = Query(None, description="Comma-separated list of metrics"),
):
    """
    Get the latest telemetry values for a device.

    Parameters:
    - minutes: Look back period in minutes (1-1440, default 60)
    - metrics: Comma-separated list of metrics to return (optional, defaults to all)

    Returns the most recent value for each metric within the time window.
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
        start_time = datetime.now(timezone.utc) - timedelta(minutes=minutes)

        # Parse metrics filter
        metric_keys = None
        if metrics:
            metric_keys = [m.strip() for m in metrics.split(",") if m.strip()]

        # Build metric filter clause
        metric_filter = ""
        if metric_keys:
            metric_filter = "AND metric_key = ANY(:metric_keys)"

        # Query to get latest value for each metric using DISTINCT ON
        query_sql = f"""
        SELECT DISTINCT ON (metric_key)
            metric_key,
            metric_value,
            metric_value_str,
            metric_value_json,
            unit,
            ts
        FROM telemetry
        WHERE tenant_id = :tenant_id
          AND device_id = :device_id
          AND ts >= :start_time
          {metric_filter}
        ORDER BY metric_key, ts DESC
        """

        params = {
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
            "start_time": start_time,
        }
        if metric_keys:
            params["metric_keys"] = metric_keys

        result = await session.execute(text(query_sql), params)
        rows = result.fetchall()

        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No telemetry data found in the last {minutes} minutes",
            )

        # Build response with latest values for each metric
        data = {
            "device_id": str(device_id),
            "timestamp": None,  # Will be set to most recent
        }

        latest_ts = None
        for row in rows:
            metric_key = row[0]
            metric_value = row[1]
            metric_value_str = row[2]
            metric_value_json = row[3]
            unit = row[4]
            ts = row[5]

            # Use the value in priority: numeric > string > json
            if metric_value is not None:
                data[metric_key] = float(metric_value)
            elif metric_value_str is not None:
                data[metric_key] = metric_value_str
            elif metric_value_json is not None:
                data[metric_key] = metric_value_json
            else:
                data[metric_key] = None

            # Optionally include unit
            if unit:
                data[f"{metric_key}_unit"] = unit

            # Track most recent timestamp
            if latest_ts is None or ts > latest_ts:
                latest_ts = ts

        data["timestamp"] = latest_ts.isoformat() if latest_ts else None

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


@router.get("/metrics", response_model=SuccessResponse)
async def list_available_metrics(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    days: int = Query(7, ge=1, le=30, description="Look back N days"),
):
    """
    List all available metric keys for a device.

    Returns distinct metric keys that have been recorded for the device
    within the specified time period.
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
        start_time = datetime.now(timezone.utc) - timedelta(days=days)

        query_sql = """
        SELECT DISTINCT metric_key
        FROM telemetry
        WHERE tenant_id = :tenant_id
          AND device_id = :device_id
          AND ts >= :start_time
        ORDER BY metric_key
        """

        result = await session.execute(
            text(query_sql),
            {
                "tenant_id": str(tenant_id),
                "device_id": str(device_id),
                "start_time": start_time,
            }
        )
        rows = result.fetchall()

        metrics = [row[0] for row in rows]

        return SuccessResponse(data={"metrics": metrics, "count": len(metrics)})

    except Exception as e:
        logger.error(
            f"Failed to list metrics for device {device_id}: {type(e).__name__}: {str(e)}",
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query error: {type(e).__name__}: {str(e)}",
        )


@router.post("", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def ingest_telemetry(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
    payload: Dict[str, Any] = None,
):
    """
    Ingest telemetry data for a device.

    Accepts a flat JSON object where keys are metric names and values are
    numeric, string, or JSON values. Each metric is stored as a separate
    key-value row (industry-standard pattern).

    After storing, publishes to Redis pub/sub for real-time WebSocket delivery.

    Example body:
        {"temperature": 25.5, "humidity": 65.2, "status": "online"}
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty payload")

    await session.set_tenant_context(tenant_id)

    # Verify device exists and belongs to tenant
    device_result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == device_id)
    )
    device = device_result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    ts = datetime.now(timezone.utc)
    system_keys = {"timestamp", "ts", "device_id", "tenant_id", "id"}

    rows = []
    for key, value in payload.items():
        if key in system_keys:
            continue
        row = Telemetry(
            tenant_id=tenant_id,
            device_id=device_id,
            metric_key=key,
            ts=ts,
        )
        if isinstance(value, (int, float)):
            row.metric_value = float(value)
        elif isinstance(value, str):
            row.metric_value_str = value
        elif isinstance(value, (dict, list)):
            row.metric_value_json = value
        else:
            row.metric_value_str = str(value)
        rows.append(row)

    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid metrics in payload")

    session.add_all(rows)
    await session.commit()

    # Update device last_seen
    await session.execute(
        text("UPDATE devices SET last_seen_at = :ts WHERE id = :device_id AND tenant_id = :tenant_id"),
        {"ts": ts, "device_id": str(device_id), "tenant_id": str(tenant_id)},
    )
    await session.commit()

    # Publish to Redis for WebSocket real-time delivery
    try:
        from app.config import get_settings
        import redis.asyncio as aioredis
        settings = get_settings()
        redis_client = await aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
        channel = f"telemetry:{tenant_id}:{device_id}"
        message = _json.dumps({
            "device_id": str(device_id),
            "payload": {k: v for k, v in payload.items() if k not in system_keys},
            "timestamp": ts.isoformat(),
        })
        await redis_client.publish(channel, message)
        await redis_client.aclose()
    except Exception as e:
        # Redis publish failure is non-critical — data is already stored in DB
        logger.warning(f"Failed to publish telemetry to Redis: {e}")

    logger.info(f"Ingested {len(rows)} metrics for device {device_id}")
    return SuccessResponse(data={"ingested": len(rows), "timestamp": ts.isoformat()})
