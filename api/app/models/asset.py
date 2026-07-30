"""Asset model - the physical thing being monitored, as opposed to a place.

An `organization` is a sub-customer, a `site` is a place, and a `device_group` is
an administrative convenience for bulk operations. None of them is a pump station.
An asset is: it has an identity, contains other assets, and devices instrument it.

Deliberately additive (strategy §4b). Alarms, alert rules, and digital twins stay
keyed by `device_id` through Y1 — re-keying them onto assets is Y2 work. Nothing
here changes an existing `device_id`-keyed code path.
"""

from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid

from app.models.base import BaseModel

# Deepest an asset may sit below its root. Bounds the recursive CTE used for the
# tree and its rollups, and keeps rollup cost predictable. Pump station -> pump ->
# motor -> bearing is 4, so this leaves generous room without allowing an
# unbounded chain.
MAX_ASSET_DEPTH = 8


class Asset(BaseModel):
    """A monitored physical asset, nestable, with devices attached to it.

    Scoped to a tenant and to a site. Unlike `DeviceGroup`, which stores both
    `organization_id` and `site_id`, an asset stores only `site_id` and reaches the
    organization through `sites.organization_id` — a second copy of that FK is a
    denormalisation that can diverge.
    """

    __tablename__ = "assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    site_id = Column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Self-referencing: an asset contains assets. CASCADE means deleting a parent
    # deletes its descendants; the devices attached to those descendants are
    # detached rather than deleted (devices.asset_id is ON DELETE SET NULL).
    parent_id = Column(
        UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=True, index=True
    )

    name = Column(String(255), nullable=False)
    description = Column(Text)
    # Free text on purpose: no enum, no lookup table. Verticals name their own
    # types while the vocabulary is still being learned from real sites, and
    # nothing in this change branches on the value. A types table earns its place
    # the first time code does.
    asset_type = Column(String(100))
    attributes = Column(JSONB, default={}, nullable=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_assets_tenant", "tenant_id"),
        Index("idx_assets_site", "site_id"),
        Index("idx_assets_parent", "parent_id"),
    )
