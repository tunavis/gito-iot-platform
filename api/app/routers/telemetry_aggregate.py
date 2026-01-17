"""Tenant-level telemetry aggregation for dashboard charts."""

from fastapi import APIRouter, Depends, HTTPException, Query, Header, status
from sqlalchemy.ext.asyncio import AsyncSession
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
    metric: str = Query("temperature"),
    hours: int = Query(24, ge=1, le=168),
):
    """Get hourly aggregated telemetry across all tenant devices."""
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
    
    await session.set_tenant_context(tenant_id)
    
    # Validate metric to prevent SQL injection
    valid_metrics = {"temperature", "humidity", "battery", "pressure", "rssi", "messages"}
    if metric not in valid_metrics:
        metric = "temperature"
    
    if metric == "messages":
        query = text("""
            SELECT 
                to_char(date_trunc('hour', timestamp), 'HH24"h"') as hour,
                COUNT(*)::numeric as value
            FROM telemetry_hot
            WHERE tenant_id = :tenant_id
              AND timestamp >= NOW() - INTERVAL '24 hours'
            GROUP BY date_trunc('hour', timestamp)
            ORDER BY date_trunc('hour', timestamp) ASC
        """)
    else:
        query = text(f"""
            SELECT 
                to_char(date_trunc('hour', timestamp), 'HH24"h"') as hour,
                ROUND(COALESCE(AVG({metric}), 0)::numeric, 2) as value
            FROM telemetry_hot
            WHERE tenant_id = :tenant_id
              AND timestamp >= NOW() - INTERVAL '24 hours'
            GROUP BY date_trunc('hour', timestamp)
            ORDER BY date_trunc('hour', timestamp) ASC
        """)
    
    try:
        result = await session.execute(query, {"tenant_id": str(tenant_id)})
        rows = result.fetchall()
        
        return SuccessResponse(
            data=[{"time": row[0], "value": float(row[1] or 0)} for row in rows]
        )
    except Exception as e:
        logger.error(f"Telemetry aggregate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
