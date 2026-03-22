"""Settings API — Tenant profile and configuration management.

GET  /tenants/{id}/settings/profile  → tenant name, slug, status + metadata
PUT  /tenants/{id}/settings/profile  → update name and metadata fields
"""

from typing import Annotated, Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, text

from app.database import RLSSession, get_session
from app.services.tenant_access import validate_tenant_access
from app.models.base import Tenant
from app.dependencies import get_current_tenant

router = APIRouter(prefix="/tenants/{tenant_id}/settings", tags=["settings"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class IntegrationsConfig(BaseModel):
    mqtt_broker_url: Optional[str] = None
    chirpstack_api_key: Optional[str] = None
    chirpstack_server: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_from: Optional[str] = None


class TenantProfileResponse(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    contact_email: Optional[str] = None
    timezone: Optional[str] = None
    retention_days: int = 90
    integrations: IntegrationsConfig = Field(default_factory=IntegrationsConfig)


class TenantProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    contact_email: Optional[str] = None
    timezone: Optional[str] = None
    retention_days: Optional[int] = Field(None, ge=7, le=3650)
    integrations: Optional[IntegrationsConfig] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_profile(tenant: Tenant) -> TenantProfileResponse:
    """Merge tenant row + metadata JSONB into profile response."""
    meta: Dict[str, Any] = tenant.tenant_metadata if hasattr(tenant, "tenant_metadata") and tenant.tenant_metadata else {}
    integ_raw = meta.get("integrations", {})
    return TenantProfileResponse(
        id=str(tenant.id),
        name=tenant.name,
        slug=tenant.slug,
        status=tenant.status,
        contact_email=meta.get("contact_email"),
        timezone=meta.get("timezone"),
        retention_days=meta.get("retention_days", 90),
        integrations=IntegrationsConfig(**integ_raw) if integ_raw else IntegrationsConfig(),
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=TenantProfileResponse)
async def get_profile(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Return tenant profile and configuration."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    # Tenants table has no RLS so we query directly (no set_tenant_context needed)
    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    return _build_profile(tenant)


@router.put("/profile", response_model=TenantProfileResponse)
async def update_profile(
    tenant_id: UUID,
    body: TenantProfileUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Update tenant name and metadata fields."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    if body.name is not None:
        tenant.name = body.name

    # Merge metadata fields
    meta: Dict[str, Any] = dict(tenant.tenant_metadata) if hasattr(tenant, "tenant_metadata") and tenant.tenant_metadata else {}

    if body.contact_email is not None:
        meta["contact_email"] = body.contact_email
    if body.timezone is not None:
        meta["timezone"] = body.timezone
    if body.retention_days is not None:
        meta["retention_days"] = body.retention_days
    if body.integrations is not None:
        meta["integrations"] = body.integrations.model_dump(exclude_none=True)

    # SQLAlchemy JSONB mutation tracking requires explicit reassignment
    tenant.tenant_metadata = meta

    from datetime import datetime
    tenant.updated_at = datetime.utcnow()

    await session.flush()
    await session.refresh(tenant)

    return _build_profile(tenant)
