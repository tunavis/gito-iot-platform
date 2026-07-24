"""Usage — current consumption per metered dimension, for checking against limits.

Two kinds of metric:
- **Point-in-time counts** (devices, gateways, users, dashboards): counted live
  from the owning tables. No separate bookkeeping to drift out of sync.
- **Period-cumulative counters** (API requests/day, notifications/month): read
  from `usage_counters`, which middleware / the dispatcher increment.

Every count is scoped by explicit `WHERE tenant_id` (RLS is inert for the app's
DB role — see [[rls-is-inert-under-superuser]]).

Metric keys match the feature keys in the plan_features matrix, so the enforcement
layer can pair `usage.current(metric)` with `entitlements.limit(metric)` directly.
"""

from __future__ import annotations

from datetime import date, timezone, datetime
from uuid import UUID

from sqlalchemy import text

# Point-in-time counts. Each returns a single integer for the tenant.
_LIVE_COUNT_SQL = {
    "devices.max": "SELECT count(*) FROM devices WHERE tenant_id = :tid",
    "users.max": "SELECT count(*) FROM users WHERE tenant_id = :tid AND status = 'active'",
    "dashboards.max": "SELECT count(*) FROM dashboards WHERE tenant_id = :tid",
    "gateways.max": (
        "SELECT count(*) FROM devices d "
        "JOIN device_types dt ON dt.id = d.device_type_id "
        "WHERE d.tenant_id = :tid AND dt.category = 'gateway'"
    ),
    "automations.max": "SELECT count(*) FROM alert_rules WHERE tenant_id = :tid",
}

# Period-cumulative counters (metric_feature_key -> period granularity).
_PERIOD_METRICS = {
    "api.requests_per_day": "day",
    "notifications.per_month": "month",
}


def _period_start(granularity: str) -> date:
    now = datetime.now(timezone.utc)
    if granularity == "month":
        return date(now.year, now.month, 1)
    return now.date()  # day


async def current(session, tenant_id: UUID | str, metric: str) -> int:
    """Current usage for `metric`. Raises ValueError for an unknown metric.

    Unknown metrics raise rather than returning 0, so a typo surfaces as a test
    failure instead of silently reporting "unlimited headroom".
    """
    tid = str(tenant_id)

    if metric in _LIVE_COUNT_SQL:
        result = await session.execute(text(_LIVE_COUNT_SQL[metric]), {"tid": tid})
        return int(result.scalar() or 0)

    if metric in _PERIOD_METRICS:
        period_start = _period_start(_PERIOD_METRICS[metric])
        result = await session.execute(
            text(
                "SELECT value FROM usage_counters "
                "WHERE tenant_id = :tid AND metric = :metric AND period_start = :ps"
            ),
            {"tid": tid, "metric": metric, "ps": period_start},
        )
        return int(result.scalar() or 0)

    raise ValueError(f"Unknown usage metric: {metric!r}")


async def increment(session, tenant_id: UUID | str, metric: str, amount: int = 1) -> None:
    """Bump a period-cumulative counter (upsert). No-op-safe for concurrent callers.

    Only valid for period metrics; point-in-time counts are derived, not incremented.
    """
    if metric not in _PERIOD_METRICS:
        raise ValueError(f"{metric!r} is not a period-cumulative metric")
    period_start = _period_start(_PERIOD_METRICS[metric])
    await session.execute(
        text(
            "INSERT INTO usage_counters (tenant_id, metric, period_start, value, updated_at) "
            "VALUES (:tid, :metric, :ps, :amount, now()) "
            "ON CONFLICT (tenant_id, metric, period_start) "
            "DO UPDATE SET value = usage_counters.value + :amount, updated_at = now()"
        ),
        {"tid": str(tenant_id), "metric": metric, "ps": period_start, "amount": amount},
    )


def is_metered(metric: str) -> bool:
    """Whether this feature key has a usage counterpart to check."""
    return metric in _LIVE_COUNT_SQL or metric in _PERIOD_METRICS
