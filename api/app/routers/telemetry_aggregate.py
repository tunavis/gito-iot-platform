"""
Tenant-level telemetry aggregation for dashboard charts.

Uses key-value storage pattern - queries any metric dynamically.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from sqlalchemy import text
from uuid import UUID
import logging

from app.database import get_session, RLSSession
from app.schemas.common import SuccessResponse
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/telemetry", tags=["telemetry-aggregate"])
logger = logging.getLogger(__name__)


async def get_current_tenant(authorization: str = Header(None)) -> UUID:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth")
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return UUID(tenant_id)


@router.get("/hourly", response_model=SuccessResponse)
async def get_hourly_aggregate(
    tenant_id: UUID,
    session: RLSSession = Depends(get_session),
    current_tenant: UUID = Depends(get_current_tenant),
    metric: str = Query("temperature", description="Metric key to aggregate"),
    hours: int = Query(24, ge=1, le=168),
):
    """
    Get hourly aggregated telemetry across all tenant devices.

    Now supports any metric key dynamically (not limited to fixed columns).
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Sanitize metric key to prevent SQL injection (alphanumeric + underscore only)
    if not metric.replace("_", "").isalnum():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid metric key format"
        )

    if metric == "messages":
        # Count all telemetry messages
        query = text("""
            SELECT
                to_char(date_trunc('hour', ts), 'HH24"h"') as hour,
                COUNT(*)::numeric as value
            FROM telemetry
            WHERE tenant_id = :tenant_id
              AND ts >= NOW() - INTERVAL '1 hour' * :hours
            GROUP BY date_trunc('hour', ts)
            ORDER BY date_trunc('hour', ts) ASC
        """)
    else:
        # Aggregate specific metric
        query = text("""
            SELECT
                to_char(date_trunc('hour', ts), 'HH24"h"') as hour,
                ROUND(COALESCE(AVG(metric_value), 0)::numeric, 2) as value
            FROM telemetry
            WHERE tenant_id = :tenant_id
              AND metric_key = :metric_key
              AND metric_value IS NOT NULL
              AND ts >= NOW() - INTERVAL '1 hour' * :hours
            GROUP BY date_trunc('hour', ts)
            ORDER BY date_trunc('hour', ts) ASC
        """)

    try:
        params = {"tenant_id": str(tenant_id), "hours": hours}
        if metric != "messages":
            params["metric_key"] = metric

        result = await session.execute(query, params)
        rows = result.fetchall()

        return SuccessResponse(
            data=[{"time": row[0], "value": float(row[1] or 0)} for row in rows]
        )
    except Exception as e:
        logger.error(f"Telemetry aggregate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary", response_model=SuccessResponse)
async def get_telemetry_summary(
    tenant_id: UUID,
    session: RLSSession = Depends(get_session),
    current_tenant: UUID = Depends(get_current_tenant),
    hours: int = Query(24, ge=1, le=168),
):
    """
    Get summary statistics for all metrics across all tenant devices.

    Returns min, max, avg, and count for each metric.
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    query = text("""
        SELECT
            metric_key,
            ROUND(MIN(metric_value)::numeric, 2) as min_value,
            ROUND(MAX(metric_value)::numeric, 2) as max_value,
            ROUND(AVG(metric_value)::numeric, 2) as avg_value,
            COUNT(*) as sample_count
        FROM telemetry
        WHERE tenant_id = :tenant_id
          AND metric_value IS NOT NULL
          AND ts >= NOW() - INTERVAL '1 hour' * :hours
        GROUP BY metric_key
        ORDER BY metric_key
    """)

    try:
        result = await session.execute(query, {"tenant_id": str(tenant_id), "hours": hours})
        rows = result.fetchall()

        return SuccessResponse(
            data=[
                {
                    "metric": row[0],
                    "min": float(row[1]) if row[1] is not None else None,
                    "max": float(row[2]) if row[2] is not None else None,
                    "avg": float(row[3]) if row[3] is not None else None,
                    "count": int(row[4]) if row[4] else 0,
                }
                for row in rows
            ]
        )
    except Exception as e:
        logger.error(f"Telemetry summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/device-comparison", response_model=SuccessResponse)
async def get_device_comparison(
    tenant_id: UUID,
    session: RLSSession = Depends(get_session),
    current_tenant: UUID = Depends(get_current_tenant),
    metric: str = Query("temperature", description="Metric to compare across devices"),
    hours: int = Query(24, ge=1, le=168),
):
    """
    Compare a metric across all devices in the tenant.

    Returns the latest value and average for each device.
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Sanitize metric key
    if not metric.replace("_", "").isalnum():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid metric key format"
        )

    query = text("""
        WITH device_stats AS (
            SELECT
                t.device_id,
                d.name as device_name,
                ROUND(AVG(t.metric_value)::numeric, 2) as avg_value,
                ROUND(MAX(t.metric_value)::numeric, 2) as max_value,
                ROUND(MIN(t.metric_value)::numeric, 2) as min_value,
                COUNT(*) as sample_count
            FROM telemetry t
            JOIN devices d ON d.id = t.device_id
            WHERE t.tenant_id = :tenant_id
              AND t.metric_key = :metric_key
              AND t.metric_value IS NOT NULL
              AND t.ts >= NOW() - INTERVAL '1 hour' * :hours
            GROUP BY t.device_id, d.name
        ),
        latest_values AS (
            SELECT DISTINCT ON (device_id)
                device_id,
                metric_value as latest_value,
                ts as latest_ts
            FROM telemetry
            WHERE tenant_id = :tenant_id
              AND metric_key = :metric_key
              AND metric_value IS NOT NULL
              AND ts >= NOW() - INTERVAL '1 hour' * :hours
            ORDER BY device_id, ts DESC
        )
        SELECT
            ds.device_id,
            ds.device_name,
            lv.latest_value,
            lv.latest_ts,
            ds.avg_value,
            ds.min_value,
            ds.max_value,
            ds.sample_count
        FROM device_stats ds
        LEFT JOIN latest_values lv ON lv.device_id = ds.device_id
        ORDER BY ds.device_name
    """)

    try:
        result = await session.execute(
            query,
            {"tenant_id": str(tenant_id), "metric_key": metric, "hours": hours}
        )
        rows = result.fetchall()

        return SuccessResponse(
            data=[
                {
                    "device_id": str(row[0]),
                    "device_name": row[1],
                    "latest_value": float(row[2]) if row[2] is not None else None,
                    "latest_ts": row[3].isoformat() if row[3] else None,
                    "avg_value": float(row[4]) if row[4] is not None else None,
                    "min_value": float(row[5]) if row[5] is not None else None,
                    "max_value": float(row[6]) if row[6] is not None else None,
                    "sample_count": int(row[7]) if row[7] else 0,
                }
                for row in rows
            ]
        )
    except Exception as e:
        logger.error(f"Device comparison error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
