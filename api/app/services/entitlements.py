"""Entitlements — the single place that answers "what is this tenant allowed to do?".

Every plan limit / feature flag decision in the app goes through here, so the
checks never get scattered across routers the way the role checks did.

Resolution: a tenant's live subscription → its plan → that plan's `plan_features`
rows. A tenant with no live subscription resolves to the **free** plan (safe
default — new/lapsed tenants still get the free tier, never an error and never
accidental unlimited access).

Enforcement of *status* (trial expired, past_due → read-only) is NOT decided here;
this service reports the plan's entitlements plus the raw status, and the
dependency layer (dependencies_billing) interprets status. Separation keeps this
pure and testable.

Caching: resolved entitlements are cached in KeyDB (app.state.redis) for a short
TTL. Writes to subscriptions/plans call `invalidate()`. If Redis is unavailable
the service degrades to resolving straight from the database — never fails closed
on a cache outage.

RLS note: reads are scoped by explicit `WHERE tenant_id` (see
[[rls-is-inert-under-superuser]] — RLS does not enforce for the app's DB role).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text

logger = logging.getLogger(__name__)

# Statuses that grant a plan's entitlements. 'canceled'/'expired' do not — those
# resolve to the free-tier default instead.
LIVE_STATUSES = ("trialing", "active", "past_due", "restricted")

CACHE_PREFIX = "ent:"
CACHE_TTL_SECONDS = 60

# Sentinel returned by limit() when a feature is missing from the matrix — a
# missing limit denies rather than silently granting unlimited.
_MISSING_LIMIT = 0


@dataclass(frozen=True)
class Entitlements:
    """Resolved entitlement snapshot for one tenant. Immutable and cheap to pass around."""

    tenant_id: str
    plan_code: str
    status: str
    features: dict[str, Any] = field(default_factory=dict)
    trial_ends_at: Optional[str] = None
    current_period_end: Optional[str] = None
    grace_until: Optional[str] = None

    def allows(self, feature_key: str) -> bool:
        """True if a boolean feature is granted. Missing feature → False (deny)."""
        return bool(self.features.get(feature_key, False))

    def limit(self, feature_key: str) -> Optional[int]:
        """Numeric cap for a limit feature.

        Returns None for *unlimited* (stored JSON null), an int for a finite cap,
        or 0 if the feature is missing entirely (conservative deny).
        """
        if feature_key not in self.features:
            return _MISSING_LIMIT
        value = self.features[feature_key]
        return None if value is None else int(value)

    def option(self, feature_key: str) -> Optional[str]:
        """Value of an enum feature (e.g. support.level), or None if absent."""
        value = self.features.get(feature_key)
        return value if isinstance(value, str) else None

    def within_limit(self, feature_key: str, current: int) -> bool:
        """True if `current` usage is still allowed under this feature's limit."""
        cap = self.limit(feature_key)
        if cap is None:
            return True  # unlimited
        return current < cap

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "plan_code": self.plan_code,
            "status": self.status,
            "features": self.features,
            "trial_ends_at": self.trial_ends_at,
            "current_period_end": self.current_period_end,
            "grace_until": self.grace_until,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Entitlements":
        return cls(
            tenant_id=d["tenant_id"],
            plan_code=d["plan_code"],
            status=d["status"],
            features=d.get("features", {}),
            trial_ends_at=d.get("trial_ends_at"),
            current_period_end=d.get("current_period_end"),
            grace_until=d.get("grace_until"),
        )


_LIVE_SUBSCRIPTION_SQL = text(
    """
    SELECT p.code            AS plan_code,
           s.status          AS status,
           s.trial_ends_at   AS trial_ends_at,
           s.current_period_end AS current_period_end,
           s.grace_until     AS grace_until,
           pf.feature_key    AS feature_key,
           pf.value          AS value
    FROM subscriptions s
    JOIN plans p          ON p.id = s.plan_id
    JOIN plan_features pf ON pf.plan_id = p.id
    WHERE s.tenant_id = :tid
      AND s.status = ANY(:statuses)
    ORDER BY s.created_at DESC
    """
)

_FREE_PLAN_SQL = text(
    """
    SELECT pf.feature_key AS feature_key, pf.value AS value
    FROM plan_features pf
    JOIN plans p ON p.id = pf.plan_id
    WHERE p.code = 'free'
    """
)


async def resolve(session, tenant_id: UUID | str, redis=None) -> Entitlements:
    """Resolve a tenant's entitlements, using KeyDB as a short-lived cache."""
    tid = str(tenant_id)

    cached = await _cache_get(redis, tid)
    if cached is not None:
        return cached

    ent = await _resolve_from_db(session, tid)
    await _cache_set(redis, tid, ent)
    return ent


async def _resolve_from_db(session, tid: str) -> Entitlements:
    rows = (
        (
            await session.execute(
                _LIVE_SUBSCRIPTION_SQL, {"tid": tid, "statuses": list(LIVE_STATUSES)}
            )
        )
        .mappings()
        .all()
    )

    if not rows:
        # No live subscription → free tier.
        free_rows = (await session.execute(_FREE_PLAN_SQL)).mappings().all()
        features = {r["feature_key"]: _coerce(r["value"]) for r in free_rows}
        return Entitlements(tenant_id=tid, plan_code="free", status="none", features=features)

    first = rows[0]
    features = {r["feature_key"]: _coerce(r["value"]) for r in rows}
    return Entitlements(
        tenant_id=tid,
        plan_code=first["plan_code"],
        status=first["status"],
        features=features,
        trial_ends_at=_iso(first["trial_ends_at"]),
        current_period_end=_iso(first["current_period_end"]),
        grace_until=_iso(first["grace_until"]),
    )


def _coerce(value: Any) -> Any:
    """JSONB comes back already decoded by asyncpg/psycopg; str only if double-encoded."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt is not None else None


# ── Cache ─────────────────────────────────────────────────────────────────────


async def _cache_get(redis, tid: str) -> Optional[Entitlements]:
    if redis is None:
        return None
    try:
        raw = await redis.get(CACHE_PREFIX + tid)
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode()
        return Entitlements.from_dict(json.loads(raw))
    except Exception as e:  # cache is best-effort — never fail a request on it
        logger.warning("entitlements cache read failed for %s: %s", tid, e)
        return None


async def _cache_set(redis, tid: str, ent: Entitlements) -> None:
    if redis is None:
        return
    try:
        await redis.set(CACHE_PREFIX + tid, json.dumps(ent.to_dict()), ex=CACHE_TTL_SECONDS)
    except Exception as e:
        logger.warning("entitlements cache write failed for %s: %s", tid, e)


async def invalidate(redis, tenant_id: UUID | str) -> None:
    """Drop a tenant's cached entitlements. Call after any subscription/plan write."""
    if redis is None:
        return
    try:
        await redis.delete(CACHE_PREFIX + str(tenant_id))
    except Exception as e:
        logger.warning("entitlements cache invalidate failed for %s: %s", tenant_id, e)
