"""Admin Tenant Management — management-tenant-only CRUD for client tenants.

Endpoints under /api/v1/admin/tenants are restricted to users whose tenant
has tenant_type = 'management' (i.e. Gito staff only).

Clients get their own isolated tenant. Gito admins can:
- List all client tenants with health metrics
- Create a new client tenant + first admin user
- Update tenant name / status
- Disable (soft-delete) a tenant

GET  /admin/tenants          → list all child tenants
POST /admin/tenants          → create new client tenant + admin user
GET  /admin/tenants/{id}     → get tenant details
PUT  /admin/tenants/{id}     → update name/status
"""

import secrets
import string
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, text

from app.database import RLSSession, get_session
from app.models.base import Tenant, User, Device, AlertEvent
from app.security import hash_password, create_access_token
from app.dependencies import get_management_tenant

router = APIRouter(prefix="/admin/tenants", tags=["admin"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class TenantSummary(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    tenant_type: str
    parent_tenant_id: Optional[str] = None
    device_count: int = 0
    user_count: int = 0
    active_alarms: int = 0


class TenantDetail(TenantSummary):
    created_at: str
    updated_at: str


class CreateTenantRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    slug: str = Field(..., min_length=2, max_length=100, pattern=r'^[a-z0-9-]+$')
    admin_email: str
    admin_name: str
    admin_password: Optional[str] = None  # auto-generated if omitted
    tenant_type: str = Field("client", pattern=r'^(client|sub_client)$')


class CreateTenantResponse(BaseModel):
    tenant: TenantDetail
    admin_email: str
    admin_password: str  # returned only on creation so Gito can hand off credentials


class UpdateTenantRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    status: Optional[str] = Field(None, pattern=r'^(active|inactive|suspended)$')


# ── Helpers ──────────────────────────────────────────────────────────────────

def _generate_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def _tenant_summary(session: RLSSession, tenant: Tenant, management_tenant_id: UUID) -> TenantSummary:
    """Build TenantSummary with device/user/alarm counts via direct queries (bypass RLS)."""
    # These queries run as management tenant context — use raw SQL to bypass per-tenant RLS
    device_count = (await session.execute(
        text("SELECT count(*) FROM devices WHERE tenant_id = :tid"),
        {"tid": str(tenant.id)}
    )).scalar() or 0

    user_count = (await session.execute(
        text("SELECT count(*) FROM users WHERE tenant_id = :tid"),
        {"tid": str(tenant.id)}
    )).scalar() or 0

    active_alarms = (await session.execute(
        text("SELECT count(*) FROM alert_events WHERE tenant_id = :tid AND status = 'ACTIVE'"),
        {"tid": str(tenant.id)}
    )).scalar() or 0

    return TenantSummary(
        id=str(tenant.id),
        name=tenant.name,
        slug=tenant.slug,
        status=tenant.status,
        tenant_type=tenant.tenant_type,
        parent_tenant_id=str(tenant.parent_tenant_id) if tenant.parent_tenant_id else None,
        device_count=int(device_count),
        user_count=int(user_count),
        active_alarms=int(active_alarms),
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[TenantSummary])
async def list_tenants(
    session: Annotated[RLSSession, Depends(get_session)],
    current: Annotated[tuple[UUID, UUID], Depends(get_management_tenant)],
):
    """List all child tenants of the management tenant."""
    management_tenant_id, _ = current

    # Set context so management tenant can query tenants table
    await session.execute(
        text("SET LOCAL app.current_tenant_id = :tid"),
        {"tid": str(management_tenant_id)},
    )

    # Fetch all tenants where parent_tenant_id = management tenant
    result = await session.execute(
        select(Tenant).where(Tenant.parent_tenant_id == management_tenant_id).order_by(Tenant.name)
    )
    tenants = result.scalars().all()

    summaries = []
    for t in tenants:
        summaries.append(await _tenant_summary(session, t, management_tenant_id))
    return summaries


@router.post("", response_model=CreateTenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: CreateTenantRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current: Annotated[tuple[UUID, UUID], Depends(get_management_tenant)],
):
    """Create a new client tenant and its first admin user."""
    management_tenant_id, _ = current

    await session.execute(
        text("SET LOCAL app.current_tenant_id = :tid"),
        {"tid": str(management_tenant_id)},
    )

    # Check slug uniqueness
    existing = await session.execute(select(Tenant).where(Tenant.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Slug '{body.slug}' is already taken")

    # Create tenant
    new_tenant = Tenant(
        name=body.name,
        slug=body.slug,
        status="active",
        tenant_type=body.tenant_type,
        parent_tenant_id=management_tenant_id,
        tenant_metadata={},
    )
    session.add(new_tenant)
    await session.flush()  # get new_tenant.id

    # Create first admin user
    password = body.admin_password or _generate_password()
    admin_user = User(
        tenant_id=new_tenant.id,
        email=body.admin_email.lower(),
        password_hash=hash_password(password),
        full_name=body.admin_name,
        role="TENANT_ADMIN",
        status="active",
    )
    session.add(admin_user)
    await session.flush()

    detail = TenantDetail(
        id=str(new_tenant.id),
        name=new_tenant.name,
        slug=new_tenant.slug,
        status=new_tenant.status,
        tenant_type=new_tenant.tenant_type,
        parent_tenant_id=str(new_tenant.parent_tenant_id),
        device_count=0,
        user_count=1,
        active_alarms=0,
        created_at=new_tenant.created_at.isoformat(),
        updated_at=new_tenant.updated_at.isoformat(),
    )

    return CreateTenantResponse(
        tenant=detail,
        admin_email=body.admin_email.lower(),
        admin_password=password,
    )


@router.get("/{tenant_id}", response_model=TenantDetail)
async def get_tenant(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current: Annotated[tuple[UUID, UUID], Depends(get_management_tenant)],
):
    """Get details for a specific client tenant."""
    management_tenant_id, _ = current

    await session.execute(
        text("SET LOCAL app.current_tenant_id = :tid"),
        {"tid": str(management_tenant_id)},
    )

    result = await session.execute(
        select(Tenant).where(
            Tenant.id == tenant_id,
            Tenant.parent_tenant_id == management_tenant_id,
        )
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    summary = await _tenant_summary(session, tenant, management_tenant_id)
    return TenantDetail(
        **summary.model_dump(),
        created_at=tenant.created_at.isoformat(),
        updated_at=tenant.updated_at.isoformat(),
    )


@router.put("/{tenant_id}", response_model=TenantDetail)
async def update_tenant(
    tenant_id: UUID,
    body: UpdateTenantRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current: Annotated[tuple[UUID, UUID], Depends(get_management_tenant)],
):
    """Update a client tenant's name or status."""
    management_tenant_id, _ = current

    await session.execute(
        text("SET LOCAL app.current_tenant_id = :tid"),
        {"tid": str(management_tenant_id)},
    )

    result = await session.execute(
        select(Tenant).where(
            Tenant.id == tenant_id,
            Tenant.parent_tenant_id == management_tenant_id,
        )
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if body.name is not None:
        tenant.name = body.name
    if body.status is not None:
        tenant.status = body.status

    from datetime import datetime
    tenant.updated_at = datetime.utcnow()
    await session.flush()
    await session.refresh(tenant)

    summary = await _tenant_summary(session, tenant, management_tenant_id)
    return TenantDetail(
        **summary.model_dump(),
        created_at=tenant.created_at.isoformat(),
        updated_at=tenant.updated_at.isoformat(),
    )
