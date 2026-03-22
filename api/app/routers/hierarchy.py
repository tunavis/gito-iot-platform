"""Hierarchy API — Asset tree overview for tenant operations.

Returns the full Org → Site → DeviceGroup hierarchy in a single response,
with device counts (total / online) and active alarm counts rolled up at
every level.  No N+1 queries — uses 5 flat queries + Python assembly.
"""

from collections import defaultdict
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select

from app.database import RLSSession, get_session
from app.services.tenant_access import validate_tenant_access
from app.models.alarm import Alarm
from app.models.base import Device
from app.models.device_group import DeviceGroup
from app.models.organization import Organization
from app.models.site import Site
from app.dependencies import get_current_tenant

router = APIRouter(prefix="/tenants/{tenant_id}/hierarchy", tags=["hierarchy"])


@router.get("")
async def get_hierarchy(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Return the full asset hierarchy tree for the tenant."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")

    await session.set_tenant_context(tenant_id)

    # ── 1. All organisations ────────────────────────────────────────────────
    orgs = (
        await session.execute(
            select(Organization)
            .where(Organization.tenant_id == tenant_id)
            .order_by(Organization.name)
        )
    ).scalars().all()

    # ── 2. All sites ────────────────────────────────────────────────────────
    sites = (
        await session.execute(
            select(Site)
            .where(Site.tenant_id == tenant_id)
            .order_by(Site.name)
        )
    ).scalars().all()

    # ── 3. All device groups ────────────────────────────────────────────────
    groups = (
        await session.execute(
            select(DeviceGroup)
            .where(DeviceGroup.tenant_id == tenant_id)
            .order_by(DeviceGroup.name)
        )
    ).scalars().all()

    # ── 4. Device counts (total + online) per org / site / group ───────────
    dev_rows = (
        await session.execute(
            select(
                Device.organization_id,
                Device.site_id,
                Device.device_group_id,
                func.count(Device.id).label("total"),
                func.sum(case((Device.status == "online", 1), else_=0)).label("online"),
            )
            .where(Device.tenant_id == tenant_id)
            .group_by(Device.organization_id, Device.site_id, Device.device_group_id)
        )
    ).all()

    # ── 5. Active alarm counts per org / site / group (via device join) ────
    alarm_rows = (
        await session.execute(
            select(
                Device.organization_id,
                Device.site_id,
                Device.device_group_id,
                func.count(Alarm.id).label("alarms"),
            )
            .join(Device, Alarm.device_id == Device.id)
            .where(Alarm.tenant_id == tenant_id)
            .where(Alarm.status.in_(["ACTIVE", "ACKNOWLEDGED"]))
            .group_by(Device.organization_id, Device.site_id, Device.device_group_id)
        )
    ).all()

    # ── Aggregate into lookup dicts ─────────────────────────────────────────
    org_dev   = defaultdict(lambda: {"total": 0, "online": 0})
    site_dev  = defaultdict(lambda: {"total": 0, "online": 0})
    grp_dev   = defaultdict(lambda: {"total": 0, "online": 0})
    org_alm   = defaultdict(int)
    site_alm  = defaultdict(int)
    grp_alm   = defaultdict(int)

    for r in dev_rows:
        t, o = int(r.total or 0), int(r.online or 0)
        if r.organization_id:
            org_dev[r.organization_id]["total"]  += t
            org_dev[r.organization_id]["online"] += o
        if r.site_id:
            site_dev[r.site_id]["total"]  += t
            site_dev[r.site_id]["online"] += o
        if r.device_group_id:
            grp_dev[r.device_group_id]["total"]  += t
            grp_dev[r.device_group_id]["online"] += o

    for r in alarm_rows:
        a = int(r.alarms or 0)
        if r.organization_id:
            org_alm[r.organization_id]  += a
        if r.site_id:
            site_alm[r.site_id]         += a
        if r.device_group_id:
            grp_alm[r.device_group_id]  += a

    # ── Assembly helpers ────────────────────────────────────────────────────
    def build_groups(site_id):
        return [
            {
                "id":            str(g.id),
                "name":          g.name,
                "group_type":    g.group_type,
                "device_count":  grp_dev[g.id]["total"],
                "online_count":  grp_dev[g.id]["online"],
                "active_alarms": grp_alm[g.id],
            }
            for g in groups if g.site_id == site_id
        ]

    def build_sites(org_id, parent_id=None):
        return [
            {
                "id":            str(s.id),
                "name":          s.name,
                "site_type":     s.site_type,
                "address":       s.address,
                "coordinates":   s.coordinates,
                "device_count":  site_dev[s.id]["total"],
                "online_count":  site_dev[s.id]["online"],
                "active_alarms": site_alm[s.id],
                "device_groups": build_groups(s.id),
                "children":      build_sites(org_id, parent_id=s.id),
            }
            for s in sites
            if s.organization_id == org_id and s.parent_site_id == parent_id
        ]

    # ── Final tree ──────────────────────────────────────────────────────────
    return {
        "organizations": [
            {
                "id":              str(org.id),
                "name":            org.name,
                "status":          org.status,
                "billing_contact": org.billing_contact,
                "device_count":    org_dev[org.id]["total"],
                "online_count":    org_dev[org.id]["online"],
                "active_alarms":   org_alm[org.id],
                "sites":           build_sites(org.id),
            }
            for org in orgs
        ]
    }
