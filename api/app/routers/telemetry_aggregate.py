"""
Tenant-level telemetry aggregation for dashboard charts.

Uses TimescaleDB continuous aggregates (telemetry_hourly / telemetry_daily)
for efficient pre-computed rollups. Falls back to raw telemetry for the most
recent data that hasn't been materialized yet (within the refresh lag).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from sqlalchemy import text
from uuid import UUID
import logging

from app.database import get_session, RLSSession
from app.services.tenant_access import validate_tenant_access
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

    For queries > 2 hours: uses the telemetry_hourly continuous aggregate
    (pre-computed, instant).  The last 2 hours use raw telemetry to fill
    the continuous aggregate refresh lag, then the two result sets are
    merged and de-duplicated by hour bucket.
    """
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    if not metric.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid metric key format")

    try:
        if metric == "messages":
            # Message count — always from raw telemetry (not in continuous aggregate)
            query = text("""
                SELECT
                    to_char(date_trunc('hour', ts), 'HH24"h"') AS hour,
                    COUNT(*)::numeric AS value
                FROM telemetry
                WHERE tenant_id = :tenant_id
                  AND ts >= NOW() - INTERVAL '1 hour' * :hours
                GROUP BY date_trunc('hour', ts)
                ORDER BY date_trunc('hour', ts) ASC
            """)
            result = await session.execute(query, {"tenant_id": str(tenant_id), "hours": hours})
            rows = result.fetchall()
            return SuccessResponse(
                data=[{"time": row[0], "value": float(row[1] or 0)} for row in rows]
            )

        # ── Continuous aggregate (pre-computed hourly rollup) ─────────────
        # Covers everything older than 1 hour (within the refresh lag).
        agg_query = text("""
            SELECT
                to_char(bucket, 'HH24"h"')          AS hour,
                bucket,
                ROUND(AVG(avg_value)::numeric, 2)   AS value
            FROM telemetry_hourly
            WHERE tenant_id  = :tenant_id
              AND metric_key = :metric_key
              AND bucket >= NOW() - INTERVAL '1 hour' * :hours
              AND bucket <  NOW() - INTERVAL '1 hour'
            GROUP BY bucket
            ORDER BY bucket ASC
        """)

        # ── Raw telemetry for the most recent 2 hours (fills refresh lag) ─
        raw_query = text("""
            SELECT
                to_char(date_trunc('hour', ts), 'HH24"h"')  AS hour,
                date_trunc('hour', ts)                       AS bucket,
                ROUND(AVG(metric_value)::numeric, 2)         AS value
            FROM telemetry
            WHERE tenant_id  = :tenant_id
              AND metric_key = :metric_key
              AND metric_value IS NOT NULL
              AND ts >= NOW() - INTERVAL '2 hours'
            GROUP BY date_trunc('hour', ts)
            ORDER BY date_trunc('hour', ts) ASC
        """)

        params = {"tenant_id": str(tenant_id), "metric_key": metric, "hours": hours}

        agg_result = await session.execute(agg_query, params)
        raw_result = await session.execute(raw_query, params)

        agg_rows = agg_result.fetchall()
        raw_rows = raw_result.fetchall()

        # Merge: raw takes priority for recent buckets (overrides agg if present)
        merged: dict[str, float] = {}
        for row in agg_rows:
            merged[row[0]] = float(row[2] or 0)
        for row in raw_rows:
            merged[row[0]] = float(row[2] or 0)

        # Sort by hour label is unreliable; return in insertion order (already ASC)
        data = [{"time": hour, "value": value} for hour, value in merged.items()]

        return SuccessResponse(data=data)

    except Exception as e:
        logger.error(f"Telemetry aggregate error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daily", response_model=SuccessResponse)
async def get_daily_aggregate(
    tenant_id: UUID,
    session: RLSSession = Depends(get_session),
    current_tenant: UUID = Depends(get_current_tenant),
    metric: str = Query("temperature", description="Metric key to aggregate"),
    days: int = Query(30, ge=1, le=90),
):
    """
    Get daily aggregated telemetry across all tenant devices.
    Uses the telemetry_daily continuous aggregate (pre-computed, instant).
    """
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    if not metric.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid metric key format")

    try:
        query = text("""
            SELECT
                to_char(bucket, 'YYYY-MM-DD')           AS day,
                ROUND(AVG(avg_value)::numeric, 2)       AS avg_value,
                ROUND(MIN(min_value)::numeric, 2)       AS min_value,
                ROUND(MAX(max_value)::numeric, 2)       AS max_value,
                SUM(sample_count)                       AS sample_count
            FROM telemetry_daily
            WHERE tenant_id  = :tenant_id
              AND metric_key = :metric_key
              AND bucket >= NOW() - INTERVAL '1 day' * :days
            GROUP BY bucket
            ORDER BY bucket ASC
        """)

        result = await session.execute(
            query,
            {"tenant_id": str(tenant_id), "metric_key": metric, "days": days},
        )
        rows = result.fetchall()

        return SuccessResponse(data=[
            {
                "day":          row[0],
                "avg":          float(row[1]) if row[1] is not None else None,
                "min":          float(row[2]) if row[2] is not None else None,
                "max":          float(row[3]) if row[3] is not None else None,
                "sample_count": int(row[4]) if row[4] else 0,
            }
            for row in rows
        ])

    except Exception as e:
        logger.error(f"Daily aggregate error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary", response_model=SuccessResponse)
async def get_telemetry_summary(
    tenant_id: UUID,
    session: RLSSession = Depends(get_session),
    current_tenant: UUID = Depends(get_current_tenant),
    hours: int = Query(24, ge=1, le=168),
):
    """
    Get summary statistics (min/max/avg/count) for all metrics across all
    tenant devices.  Uses telemetry_hourly for efficiency when hours > 2,
    raw telemetry for short windows.
    """
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    try:
        if hours <= 2:
            # Short window — raw telemetry is fine
            query = text("""
                SELECT
                    metric_key,
                    ROUND(MIN(metric_value)::numeric, 2) AS min_value,
                    ROUND(MAX(metric_value)::numeric, 2) AS max_value,
                    ROUND(AVG(metric_value)::numeric, 2) AS avg_value,
                    COUNT(*) AS sample_count
                FROM telemetry
                WHERE tenant_id = :tenant_id
                  AND metric_value IS NOT NULL
                  AND ts >= NOW() - INTERVAL '1 hour' * :hours
                GROUP BY metric_key
                ORDER BY metric_key
            """)
        else:
            # Longer window — use continuous aggregate
            query = text("""
                SELECT
                    metric_key,
                    ROUND(MIN(min_value)::numeric, 2)  AS min_value,
                    ROUND(MAX(max_value)::numeric, 2)  AS max_value,
                    ROUND(AVG(avg_value)::numeric, 2)  AS avg_value,
                    SUM(sample_count)                  AS sample_count
                FROM telemetry_hourly
                WHERE tenant_id = :tenant_id
                  AND bucket >= NOW() - INTERVAL '1 hour' * :hours
                GROUP BY metric_key
                ORDER BY metric_key
            """)

        result = await session.execute(query, {"tenant_id": str(tenant_id), "hours": hours})
        rows = result.fetchall()

        return SuccessResponse(data=[
            {
                "metric":  row[0],
                "min":     float(row[1]) if row[1] is not None else None,
                "max":     float(row[2]) if row[2] is not None else None,
                "avg":     float(row[3]) if row[3] is not None else None,
                "count":   int(row[4]) if row[4] else 0,
            }
            for row in rows
        ])

    except Exception as e:
        logger.error(f"Telemetry summary error: {e}", exc_info=True)
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
    Uses telemetry_hourly for the aggregate stats; raw telemetry for latest values.
    """
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    if not metric.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid metric key format")

    try:
        query = text("""
            WITH device_stats AS (
                SELECT
                    h.device_id,
                    d.name                              AS device_name,
                    ROUND(AVG(h.avg_value)::numeric, 2) AS avg_value,
                    ROUND(MAX(h.max_value)::numeric, 2) AS max_value,
                    ROUND(MIN(h.min_value)::numeric, 2) AS min_value,
                    SUM(h.sample_count)                 AS sample_count
                FROM telemetry_hourly h
                JOIN devices d ON d.id = h.device_id
                WHERE h.tenant_id  = :tenant_id
                  AND h.metric_key = :metric_key
                  AND h.bucket >= NOW() - INTERVAL '1 hour' * :hours
                GROUP BY h.device_id, d.name
            ),
            latest_values AS (
                SELECT DISTINCT ON (device_id)
                    device_id,
                    metric_value AS latest_value,
                    ts           AS latest_ts
                FROM telemetry
                WHERE tenant_id  = :tenant_id
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

        result = await session.execute(
            query,
            {"tenant_id": str(tenant_id), "metric_key": metric, "hours": hours},
        )
        rows = result.fetchall()

        return SuccessResponse(data=[
            {
                "device_id":    str(row[0]),
                "device_name":  row[1],
                "latest_value": float(row[2]) if row[2] is not None else None,
                "latest_ts":    row[3].isoformat() if row[3] else None,
                "avg_value":    float(row[4]) if row[4] is not None else None,
                "min_value":    float(row[5]) if row[5] is not None else None,
                "max_value":    float(row[6]) if row[6] is not None else None,
                "sample_count": int(row[7]) if row[7] else 0,
            }
            for row in rows
        ])

    except Exception as e:
        logger.error(f"Device comparison error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))