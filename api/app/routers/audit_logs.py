"""Audit Logs API - Compliance and security monitoring."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime, timedelta

from app.database import get_session, RLSSession
from app.models.base import AuditLog, User
from app.schemas.audit import AuditLogResponse
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token

router = APIRouter(prefix="/tenants/{tenant_id}/audit-logs", tags=["audit-logs"])


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


async def get_current_user(
    authorization: str = Header(None),
) -> dict:
    """Extract current user info from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)

    return {
        "user_id": UUID(payload.get("sub")),
        "tenant_id": UUID(payload.get("tenant_id")),
        "role": payload.get("role"),
    }


@router.get("", response_model=SuccessResponse)
async def list_audit_logs(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    user_id: Optional[UUID] = Query(None, description="Filter by user"),
    action: Optional[str] = Query(None, description="Filter by action (create, update, delete, login)"),
    resource_type: Optional[str] = Query(None, description="Filter by resource type (device, user, alert, etc.)"),
    resource_id: Optional[UUID] = Query(None, description="Filter by specific resource ID"),
    start_date: Optional[datetime] = Query(None, description="Filter logs after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter logs before this date"),
    search: Optional[str] = Query(None, max_length=255, description="Search in action or resource_type"),
):
    """List audit logs for a tenant with comprehensive filtering.

    Args:
        tenant_id: Tenant UUID from path
        user_id: Filter by specific user
        action: Filter by action type
        resource_type: Filter by resource type
        resource_id: Filter by specific resource
        start_date: Filter logs after this date
        end_date: Filter logs before this date
        search: Search in action or resource_type
        page: Page number (1-indexed)
        per_page: Items per page (max 100)

    Returns:
        Paginated list of audit logs

    Raises:
        403: If current user doesn't have permission to view audit logs
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Check permission (only admins can view audit logs)
    if current_user["role"] not in ["TENANT_ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to view audit logs"
        )

    await session.set_tenant_context(tenant_id)

    # Build query
    query = select(AuditLog).where(AuditLog.tenant_id == tenant_id)

    if user_id:
        query = query.where(AuditLog.user_id == user_id)

    if action:
        query = query.where(AuditLog.action == action)

    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)

    if resource_id:
        query = query.where(AuditLog.resource_id == resource_id)

    if start_date:
        query = query.where(AuditLog.created_at >= start_date)

    if end_date:
        query = query.where(AuditLog.created_at <= end_date)

    if search:
        search_pattern = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(AuditLog.action).like(search_pattern),
                func.lower(AuditLog.resource_type).like(search_pattern)
            )
        )

    # Order by created_at descending (newest first)
    query = query.order_by(AuditLog.created_at.desc())

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_query)).scalar()

    # Paginate
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)

    result = await session.execute(query)
    logs = result.scalars().all()

    return SuccessResponse(
        data=[AuditLogResponse.model_validate(log) for log in logs],
        meta=PaginationMeta(page=page, per_page=per_page, total=total),
    )


@router.get("/stats", response_model=SuccessResponse)
async def get_audit_stats(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
    days: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
):
    """Get audit log statistics for dashboard visualization.

    Args:
        tenant_id: Tenant UUID from path
        days: Number of days to analyze (default: 30)

    Returns:
        Statistics including action counts, top users, resource types

    Raises:
        403: If current user doesn't have permission to view audit logs
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Check permission
    if current_user["role"] not in ["TENANT_ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to view audit logs"
        )

    await session.set_tenant_context(tenant_id)

    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    # Get action counts
    action_query = select(
        AuditLog.action,
        func.count(AuditLog.id).label('count')
    ).where(
        AuditLog.tenant_id == tenant_id,
        AuditLog.created_at >= start_date
    ).group_by(AuditLog.action)

    action_result = await session.execute(action_query)
    action_counts = {row[0]: row[1] for row in action_result.fetchall()}

    # Get resource type counts
    resource_query = select(
        AuditLog.resource_type,
        func.count(AuditLog.id).label('count')
    ).where(
        AuditLog.tenant_id == tenant_id,
        AuditLog.created_at >= start_date,
        AuditLog.resource_type.isnot(None)
    ).group_by(AuditLog.resource_type)

    resource_result = await session.execute(resource_query)
    resource_counts = {row[0]: row[1] for row in resource_result.fetchall()}

    # Get top active users
    user_query = select(
        AuditLog.user_id,
        func.count(AuditLog.id).label('count')
    ).where(
        AuditLog.tenant_id == tenant_id,
        AuditLog.created_at >= start_date,
        AuditLog.user_id.isnot(None)
    ).group_by(AuditLog.user_id).order_by(func.count(AuditLog.id).desc()).limit(10)

    user_result = await session.execute(user_query)
    top_users = [{"user_id": str(row[0]), "action_count": row[1]} for row in user_result.fetchall()]

    # Get total log count
    total_query = select(func.count(AuditLog.id)).where(
        AuditLog.tenant_id == tenant_id,
        AuditLog.created_at >= start_date
    )
    total_logs = (await session.execute(total_query)).scalar()

    return SuccessResponse(
        data={
            "period": {
                "days": days,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            },
            "total_logs": total_logs,
            "action_counts": action_counts,
            "resource_counts": resource_counts,
            "top_users": top_users,
        }
    )


@router.get("/{log_id}", response_model=SuccessResponse[AuditLogResponse])
async def get_audit_log(
    tenant_id: UUID,
    log_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Get a specific audit log entry by ID.

    Args:
        tenant_id: Tenant UUID from path
        log_id: Audit log UUID from path

    Returns:
        Audit log details

    Raises:
        403: If current user doesn't have permission
        404: If log not found
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Check permission
    if current_user["role"] not in ["TENANT_ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to view audit logs"
        )

    await session.set_tenant_context(tenant_id)

    query = select(AuditLog).where(AuditLog.id == log_id, AuditLog.tenant_id == tenant_id)
    result = await session.execute(query)
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit log not found")

    return SuccessResponse(data=AuditLogResponse.model_validate(log))
