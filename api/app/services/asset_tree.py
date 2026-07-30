"""Asset tree invariants and rollups.

Two jobs, kept together because both are about the shape of the asset tree:

1. **Write-side validation** — reject a parent that would create a cycle or exceed
   the depth cap, *before* commit. Storing a cycle and defending on read would
   leave corrupt data that every future consumer has to re-defend against; the
   client-side `layoutTree` guard in the web app is a rendering safeguard, not a
   data guarantee.

2. **Read-side rollups** — subtree-inclusive counts in one recursive query. A pump
   station's device count must include the devices on its child pumps, or the
   number misleads. One query for the whole tree, not one per asset.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import select, text

from app.models.asset import MAX_ASSET_DEPTH, Asset


class AssetTreeError(ValueError):
    """Raised when a write would violate a tree invariant. Routers map this to 422."""


async def _parent_chain(session, tenant_id: UUID, start_id: UUID) -> list[UUID]:
    """Ancestor ids of `start_id`, nearest first. Bounded by MAX_ASSET_DEPTH + 1.

    The loop is bounded rather than `while True` so that a cycle already present in
    the data (from a direct SQL edit, say) cannot hang the request.
    """
    chain: list[UUID] = []
    current: Optional[UUID] = start_id
    for _ in range(MAX_ASSET_DEPTH + 2):
        if current is None:
            break
        row = await session.execute(
            select(Asset.parent_id).where(Asset.id == current, Asset.tenant_id == tenant_id)
        )
        parent = row.scalar_one_or_none()
        if parent is None:
            break
        chain.append(parent)
        current = parent
    return chain


async def _subtree_ids(session, tenant_id: UUID, root_id: UUID) -> set[UUID]:
    """All descendant ids of `root_id`, inclusive, via one recursive CTE."""
    result = await session.execute(
        text(
            """
            WITH RECURSIVE sub AS (
                SELECT id FROM assets WHERE id = :root AND tenant_id = :tenant
                UNION
                SELECT a.id FROM assets a JOIN sub ON a.parent_id = sub.id
                WHERE a.tenant_id = :tenant
            )
            SELECT id FROM sub
            """
        ),
        {"root": str(root_id), "tenant": str(tenant_id)},
    )
    return {r[0] for r in result.fetchall()}


async def validate_parent(
    session,
    tenant_id: UUID,
    parent_id: Optional[UUID],
    asset_id: Optional[UUID] = None,
) -> None:
    """Raise AssetTreeError if `parent_id` is not a legal parent.

    `asset_id` is None on create (nothing exists to form a cycle with yet) and the
    asset's own id on update.

    Checks, in order — cheapest and most specific first so the error names the real
    problem rather than a downstream symptom:
      1. parent exists in this tenant (a cross-tenant parent is not visible here)
      2. parent is not the asset itself
      3. parent is not a descendant of the asset  (the cycle case)
      4. the resulting depth is within MAX_ASSET_DEPTH
    """
    if parent_id is None:
        return

    if asset_id is not None and parent_id == asset_id:
        raise AssetTreeError("An asset cannot be its own parent.")

    parent_row = await session.execute(
        select(Asset.id).where(Asset.id == parent_id, Asset.tenant_id == tenant_id)
    )
    if parent_row.scalar_one_or_none() is None:
        # Covers both "no such asset" and "belongs to another tenant" — deliberately
        # the same message, so this cannot be used to probe for ids in other tenants.
        raise AssetTreeError("Parent asset not found.")

    if asset_id is not None:
        descendants = await _subtree_ids(session, tenant_id, asset_id)
        if parent_id in descendants:
            raise AssetTreeError(
                "That parent is inside this asset's own subtree, which would create a cycle."
            )

    # Depth of the new parent, plus this asset, plus anything already hanging off it.
    parent_depth = len(await _parent_chain(session, tenant_id, parent_id)) + 1
    own_subtree_height = 0
    if asset_id is not None:
        own_subtree_height = await _subtree_height(session, tenant_id, asset_id)
    if parent_depth + 1 + own_subtree_height > MAX_ASSET_DEPTH:
        raise AssetTreeError(
            f"That would place an asset deeper than the {MAX_ASSET_DEPTH}-level limit."
        )


async def _subtree_height(session, tenant_id: UUID, root_id: UUID) -> int:
    """Levels below `root_id` (0 when it is a leaf)."""
    result = await session.execute(
        text(
            """
            WITH RECURSIVE sub AS (
                SELECT id, 0 AS depth FROM assets WHERE id = :root AND tenant_id = :tenant
                UNION ALL
                SELECT a.id, sub.depth + 1 FROM assets a JOIN sub ON a.parent_id = sub.id
                WHERE a.tenant_id = :tenant AND sub.depth < :cap
            )
            SELECT COALESCE(MAX(depth), 0) FROM sub
            """
        ),
        {"root": str(root_id), "tenant": str(tenant_id), "cap": MAX_ASSET_DEPTH + 1},
    )
    return int(result.scalar() or 0)


async def tree_with_rollups(session, tenant_id: UUID) -> list[dict]:
    """Every asset for the tenant with subtree-inclusive device and alarm counts.

    One query. The `descendants` CTE pairs each asset with every asset in its own
    subtree (itself included), so a single GROUP BY produces subtree totals without
    a second pass per node.

    Alarm counts are a **read-side join through devices.asset_id** — `alarms` stays
    keyed by `device_id` and alarm evaluation is untouched.
    """
    result = await session.execute(
        text(
            """
            WITH RECURSIVE descendants AS (
                SELECT id AS root_id, id AS node_id FROM assets WHERE tenant_id = :tenant
                UNION ALL
                SELECT d.root_id, a.id
                FROM assets a
                JOIN descendants d ON a.parent_id = d.node_id
                WHERE a.tenant_id = :tenant
            )
            SELECT
                a.id,
                a.parent_id,
                a.site_id,
                a.name,
                a.asset_type,
                a.description,
                a.attributes,
                a.created_at,
                a.updated_at,
                COUNT(DISTINCT dev.id) AS device_count,
                COUNT(DISTINCT CASE WHEN al.status = 'ACTIVE' THEN al.id END) AS active_alarm_count
            FROM assets a
            JOIN descendants d ON d.root_id = a.id
            LEFT JOIN devices dev ON dev.asset_id = d.node_id AND dev.tenant_id = :tenant
            LEFT JOIN alarms al ON al.device_id = dev.id AND al.tenant_id = :tenant
            WHERE a.tenant_id = :tenant
            GROUP BY a.id, a.parent_id, a.site_id, a.name, a.asset_type, a.description,
                     a.attributes, a.created_at, a.updated_at
            ORDER BY a.name
            """
        ),
        {"tenant": str(tenant_id)},
    )
    return [dict(r) for r in result.mappings().all()]
