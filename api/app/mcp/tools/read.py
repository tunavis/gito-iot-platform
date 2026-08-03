"""The read tools an agent gets over MCP.

Every tool here wraps an existing router function and contains **no SQL of its
own**. That is not tidiness — it is the only way the answer an agent reports and
the answer the dashboard shows stay the same answer. A tool with its own query
is a second implementation of "which devices are offline", free to drift from
the one the UI uses, and nobody would notice until an agent contradicted a
screen.

None of these take a tenant. The registrar refuses a tool that tries; the tenant
comes from the credential and is injected as `ctx`.

Descriptions are written for a model to read, not a developer: they say what the
tool answers and what it does *not* cover, because a model that misreads a tool's
scope produces a confident wrong answer rather than an error.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException

from app.mcp.auth import ToolContext
from app.mcp.shape import DEFAULT_ITEMS, MAX_ITEMS, call_route, capped, clamp, tool_session
from app.routers import (
    alarms,
    alert_rules_unified,
    analytics,
    assets,
    commands,
    device_types,
    devices,
    hierarchy,
    telemetry,
    telemetry_aggregate,
)
from app.schemas.commands import CommandResponse

# ── Shared shaping (tasks 4.10, 4.11) ────────────────────────────────────────


async def _topology_names(session, ctx: ToolContext) -> dict[str, str]:
    """`{uuid: name}` for every organisation, site and device group in the tenant.

    Built from the hierarchy endpoint rather than from three SELECTs of its own,
    for the same reason as everything else here: one source for a name.

    ponytail: rebuilt per call. It is a handful of grouped queries against
    tenant-sized tables, so it is cheap today; cache it on the MCP session if it
    ever shows up in a trace.
    """
    tree = await call_route(
        hierarchy.get_hierarchy,
        tenant_id=ctx.tenant_id,
        session=session,
        current_tenant=ctx.tenant_id,
    )
    names: dict[str, str] = {}

    def walk_site(site: dict) -> None:
        names[site["id"]] = site["name"]
        for group in site.get("device_groups") or []:
            names[group["id"]] = group["name"]
        for child in site.get("children") or []:
            walk_site(child)

    for org in tree.get("organizations") or []:
        names[org["id"]] = org["name"]
        for site in org.get("sites") or []:
            walk_site(site)
    return names


def _named(device: dict, names: dict[str, str]) -> dict:
    """Put a readable name next to each id a device points at.

    A device row is all UUIDs. An agent handed only those will either report a
    UUID to a human or invent a name for it, and the second is worse.
    """
    for id_field, name_field in (
        ("organization_id", "organization_name"),
        ("site_id", "site_name"),
        ("device_group_id", "device_group_name"),
    ):
        value = device.get(id_field)
        if value:
            device[name_field] = names.get(str(value))
    return device


async def _telemetry_schema(session, ctx: ToolContext, device_type_id: Any) -> dict:
    """The device type's metric definitions, or `{}` when there is no type.

    `devices.device_type_id` is SET NULL on delete, so a device can legitimately
    have no type. A missing type is not an error worth failing the whole read
    over — the telemetry is still real, it just has no declared units.
    """
    if not device_type_id:
        return {}
    try:
        response = await call_route(
            device_types.get_device_type,
            tenant_id=ctx.tenant_id,
            device_type_id=device_type_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )
    except HTTPException:
        return {}
    return response.data.telemetry_schema or {}


# ── 4.1 list_devices ─────────────────────────────────────────────────────────


async def list_devices(
    ctx: ToolContext,
    site_id: UUID | None = None,
    device_group_id: UUID | None = None,
    device_type: str | None = None,
    status: str | None = None,
    search: str | None = None,
    limit: int = DEFAULT_ITEMS,
) -> dict:
    async with tool_session(ctx) as session:
        response = await call_route(
            devices.list_devices,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
            page=1,
            per_page=clamp(limit, 1, MAX_ITEMS),
            site_id=site_id,
            device_group_id=device_group_id,
            device_type=device_type,
            device_status=status,
            search=search,
        )
        names = await _topology_names(session, ctx)
        items = [_named(d.model_dump(mode="json"), names) for d in response.data]
        return capped(items, limit, total=response.meta.total)


# ── 4.2 get_device ───────────────────────────────────────────────────────────


async def get_device(ctx: ToolContext, device_id: UUID) -> dict:
    async with tool_session(ctx) as session:
        response = await call_route(
            devices.get_device,
            tenant_id=ctx.tenant_id,
            device_id=device_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )
        device = response.data
        out = _named(device.model_dump(mode="json"), await _topology_names(session, ctx))
        # Inlined rather than left to a separate device-type tool: the metric
        # names are what an agent needs before it can ask for telemetry at all,
        # and a two-call handshake to learn them is a round trip that will
        # sometimes be skipped with a guessed metric name instead.
        out["metrics"] = await _telemetry_schema(session, ctx, device.device_type_id)
        return out


# ── 4.3 get_device_telemetry ─────────────────────────────────────────────────


async def get_device_telemetry(
    ctx: ToolContext,
    device_id: UUID,
    metrics: str | None = None,
    hours: int = 24,
    aggregation: Literal["raw", "avg", "min", "max", "sum"] = "raw",
    limit: int = 200,
) -> dict:
    hours = clamp(hours, 1, 24 * 90)
    end_time = datetime.now(UTC)
    start_time = end_time - timedelta(hours=hours)
    async with tool_session(ctx) as session:
        response = await call_route(
            telemetry.query_telemetry,
            tenant_id=ctx.tenant_id,
            device_id=device_id,
            session=session,
            current_tenant=ctx.tenant_id,
            start_time=start_time,
            end_time=end_time,
            metrics=metrics,
            aggregation=aggregation,
            page=1,
            per_page=clamp(limit, 1, 1000),
        )
        device = await call_route(
            devices.get_device,
            tenant_id=ctx.tenant_id,
            device_id=device_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )
        schema = await _telemetry_schema(session, ctx, device.data.device_type_id)

        out = capped(response.data, limit, total=response.meta.total)
        out["window"] = {"start": start_time.isoformat(), "end": end_time.isoformat()}
        out["units"] = {k: v.get("unit") for k, v in schema.items() if v.get("unit")}
        return out


# ── 4.4 get_telemetry_aggregate ──────────────────────────────────────────────


async def get_telemetry_aggregate(ctx: ToolContext, hours: int = 24) -> dict:
    # The route declares ge=1, le=168, but calling it directly skips FastAPI's
    # validation entirely — see call_route. Clamped here, not asserted, because a
    # model asking for a week and a day should get a week, not an error.
    hours = clamp(hours, 1, 168)
    async with tool_session(ctx) as session:
        response = await call_route(
            telemetry_aggregate.get_telemetry_summary,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
            hours=hours,
        )
        return {"window_hours": hours, "items": response.data}


# ── 4.5 list_active_alarms ───────────────────────────────────────────────────


async def _alarms(
    ctx: ToolContext,
    *,
    limit: int,
    alarm_status: str | None = None,
    severity: str | None = None,
    device_id: UUID | None = None,
    site_id: UUID | None = None,
    alert_rule_id: UUID | None = None,
    fired_after: datetime | None = None,
) -> dict:
    """One alarm read, shared by the active-alarm and history tools.

    ponytail: alarms carry `device_id` but no device name — resolving one would
    cost a lookup per page for a field `message` and `source` usually already
    name. If agents start echoing raw UUIDs at users, add a batched name map the
    way `_topology_names` does it.
    """
    async with tool_session(ctx) as session:
        response = await call_route(
            alarms.list_alarms,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
            page=1,
            page_size=clamp(limit, 1, MAX_ITEMS),
            alarm_status=alarm_status,
            severity=severity,
            device_id=device_id,
            site_id=site_id,
            alert_rule_id=alert_rule_id,
            fired_after=fired_after,
        )
        items = [a.model_dump(mode="json") for a in response.alarms]
        return capped(items, limit, total=response.total)


async def list_active_alarms(
    ctx: ToolContext,
    severity: str | None = None,
    site_id: UUID | None = None,
    limit: int = DEFAULT_ITEMS,
) -> dict:
    return await _alarms(
        ctx, limit=limit, alarm_status="ACTIVE", severity=severity, site_id=site_id
    )


# ── 4.6 get_alarm_history ────────────────────────────────────────────────────


async def get_alarm_history(
    ctx: ToolContext,
    device_id: UUID | None = None,
    alert_rule_id: UUID | None = None,
    hours: int = 168,
    limit: int = DEFAULT_ITEMS,
) -> dict:
    hours = clamp(hours, 1, 24 * 365)
    since = datetime.now(UTC) - timedelta(hours=hours)
    out = await _alarms(
        ctx, limit=limit, device_id=device_id, alert_rule_id=alert_rule_id, fired_after=since
    )
    out["window"] = {"since": since.isoformat(), "hours": hours}
    return out


# ── 4.7 list_alert_rules ─────────────────────────────────────────────────────


async def list_alert_rules(
    ctx: ToolContext,
    rule_type: str | None = None,
    severity: str | None = None,
    device_id: UUID | None = None,
    enabled: bool | None = None,
    limit: int = DEFAULT_ITEMS,
) -> dict:
    async with tool_session(ctx) as session:
        # Values come back through `to_response_dict()`, the rule's API-format
        # representation. Reading the raw columns instead would silently match
        # nothing: rule_type and severity are stored in a different vocabulary
        # than the one the API speaks (see unified_alert_rule.py).
        response = await call_route(
            alert_rules_unified.list_alert_rules,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
            rule_type=rule_type,
            severity=severity,
            device_id=device_id,
            enabled=enabled,
            page=1,
            per_page=clamp(limit, 1, MAX_ITEMS),
        )
        return capped(response["data"], limit, total=response["meta"]["total"])


# ── 4.8 get_hierarchy ────────────────────────────────────────────────────────


async def get_hierarchy(ctx: ToolContext) -> dict:
    async with tool_session(ctx) as session:
        return await call_route(
            hierarchy.get_hierarchy,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )


# ── 4.9 get_fleet_health ─────────────────────────────────────────────────────


async def get_fleet_health(ctx: ToolContext) -> dict:
    async with tool_session(ctx) as session:
        fleet = await call_route(
            analytics.get_fleet_overview,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )
        alarm_summary = await call_route(
            alarms.get_alarm_summary,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )
        # The status distribution is the *effective* one — fleet-overview ages a
        # device out of 'online' when its last_seen passes its type's offline
        # threshold, so this does not agree with a naive count of the status
        # column, and the effective answer is the true one.
        return {
            "devices": fleet.data,
            "alarms": alarm_summary.model_dump(mode="json"),
        }


# ── 4.12 get_asset_tree ──────────────────────────────────────────────────────


async def get_asset_tree(ctx: ToolContext) -> dict:
    async with tool_session(ctx) as session:
        response = await call_route(
            assets.get_asset_tree,
            tenant_id=ctx.tenant_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )
        items = [a.model_dump(mode="json") for a in response.data]
        return {"items": items, "total": len(items)}


# ── get_command_status ───────────────────────────────────────────────────────
#
# `send_device_command` hands back an approval reference and then, until this
# tool existed, the agent knew nothing further, forever — there was no tool that
# read a command back. That was survivable while every command expired after
# sixty seconds. With per-driver response windows of up to twelve hours, an agent
# will *never* learn the outcome inside one conversation, and a model with no way
# to check either stays silent or guesses.

# What each status actually means, written for a model to repeat to a person.
# The two that matter are the ones a plain status string reads backwards:
# `delivered_unconfirmed` is a success, and `sent` is not one yet.
_STATUS_MEANING = {
    "awaiting_approval": (
        "Requested. A person has not decided yet, and NOTHING has been sent to the "
        "device. Do not describe this as done or in progress."
    ),
    "rejected": "A person refused this command. It was never sent, and it will not be.",
    "pending": "Approved and accepted by the platform, not yet handed to the transport.",
    "sent": (
        "Handed to the device's transport. This is NOT confirmation the device "
        "received or acted on it — say 'sent', not 'done'."
    ),
    "delivered": "The transport reports the device received it. It has not yet reported a result.",
    "delivered_unconfirmed": (
        "Delivered, and this device can never confirm this command — its driver says "
        "the command produces no reply of any kind. This is the terminal success "
        "state for such commands. Report it as delivered, and say plainly that the "
        "device cannot acknowledge it, rather than implying either success or failure."
    ),
    "executed": "The device reported it carried the command out.",
    "failed": "It did not go through. `error_message` says why.",
    "timed_out": (
        "The device's response window passed with no answer. That window comes from "
        "the device type's driver, so this means the device stayed silent for as long "
        "as its own hardware should have needed — not merely that a default elapsed."
    ),
}


async def get_command_status(ctx: ToolContext, device_id: UUID, command_id: UUID) -> dict:
    async with tool_session(ctx) as session:
        command = await call_route(
            commands.get_command,
            tenant_id=ctx.tenant_id,
            device_id=device_id,
            command_id=command_id,
            session=session,
            current_tenant=ctx.tenant_id,
        )
        out = CommandResponse.model_validate(command).model_dump(mode="json")
        out["meaning"] = _STATUS_MEANING.get(
            out["status"],
            "Unrecognised status — report it verbatim rather than interpreting it.",
        )
        return out


# ── Catalogue ────────────────────────────────────────────────────────────────
#
# A list of (name, function, description) rather than a decorator, so that
# `app.mcp.tools.register_all` stays the single place registration policy lives
# and this module cannot register anything by itself, guards or no guards.

READ_TOOLS: list[tuple[str, Any, str]] = [
    (
        "list_devices",
        list_devices,
        "List the devices in your fleet, newest first. Optional filters: site, "
        "device group, device type name, status (online/offline), and a text "
        "search over name, serial number and dev_eui. Returns at most 100; the "
        "response states the true total when it is larger.",
    ),
    (
        "get_device",
        get_device,
        "One device in full: status, last seen, battery, signal, location "
        "attributes, and its site/group names. Also returns `metrics` — the "
        "metric names, units and valid ranges this device reports, taken from "
        "its device type. Read `metrics` before calling get_device_telemetry "
        "rather than guessing a metric name.",
    ),
    (
        "get_device_telemetry",
        get_device_telemetry,
        "Time-series readings for one device over the last `hours`. `metrics` is "
        "a comma-separated list of metric names (omit for all of them); get them "
        "from get_device. `aggregation` is raw, avg, min, max or sum — raw "
        "returns individual readings, the others bucket by time. Units are "
        "returned alongside.",
    ),
    (
        "get_telemetry_aggregate",
        get_telemetry_aggregate,
        "Min, max, average and sample count per metric across ALL devices in the "
        "tenant over the last `hours` (1-168). Fleet-wide, not per device — for "
        "one device use get_device_telemetry with an aggregation.",
    ),
    (
        "list_active_alarms",
        list_active_alarms,
        "Alarms currently in ACTIVE state, newest first. Optional filters: "
        "severity (CRITICAL, MAJOR, MINOR, WARNING) and site. Excludes "
        "acknowledged and cleared alarms — use get_alarm_history for those.",
    ),
    (
        "get_alarm_history",
        get_alarm_history,
        "Alarms of every state (active, acknowledged, cleared) fired in the last "
        "`hours`, optionally for one device or one alert rule. Use this to answer "
        "how often something has happened, rather than what is wrong right now.",
    ),
    (
        "list_alert_rules",
        list_alert_rules,
        "The alert rules configured for this tenant, threshold and composite "
        "alike, with their conditions, severity and enabled state. Filters: rule "
        "type (THRESHOLD/COMPOSITE), severity, device, enabled.",
    ),
    (
        "get_hierarchy",
        get_hierarchy,
        "The organisation → site → device group tree, each node carrying its "
        "device count, online count and active alarm count. Use this to orient "
        "yourself before filtering other tools by site or group.",
    ),
    (
        "get_fleet_health",
        get_fleet_health,
        "One tenant-wide snapshot: device totals, the effective online/offline "
        "distribution (a device whose last_seen has aged past its type's offline "
        "threshold counts as offline, whatever its status column says), device "
        "type mix, battery, and alarm counts by state and severity.",
    ),
    (
        "get_command_status",
        get_command_status,
        "The current state of one command you requested, by the approval "
        "reference send_device_command returned plus the device id. Call this "
        "before saying anything about what happened to a command — requesting one "
        "tells you nothing about its outcome, a person may not have decided yet, "
        "and some devices take up to twelve hours to answer. The `meaning` field "
        "says what the status actually implies; use it rather than inferring from "
        "the status word, because 'sent' is not success and "
        "'delivered_unconfirmed' is.",
    ),
    (
        "get_asset_tree",
        get_asset_tree,
        "The asset registry — pump stations, reservoirs, lines — with each "
        "asset's device and active-alarm counts rolled up over its whole "
        "subtree. Use this to answer whether a piece of plant is healthy, rather "
        "than reasoning device by device.",
    ),
]
