## Why

`docs/strategy/2026-07-05-platform-5yr-strategy.md` §4b makes the asset registry
part of the Y1-H1 "Core Platform" backbone (§5, P0), and `add-mcp-server`'s own
sequencing note records that the strategy places the registry **before** F1 (the
MCP server). It is the last unstarted item on that critical path, and it is the
only one of the three open proposals with no written change.

**Nothing in the codebase models the thing being monitored.** A device attaches to
an `organization`, a `site`, and a `device_group` — but an organization is a
sub-customer, a site is a *place* (already a self-referencing tree per
`multi-tenancy-and-orgs`), and a device group is an administrative convenience:
its `group_type` is free text and the Device Groups UI tells the user outright
that it is *"not used by anything else in Gito"*. None of them is a pump station,
a borehole, or a conveyor. So today the platform can answer "which devices are at
this site" but not "is this pump station healthy" — and every asset-shaped
question (rollups, asset-scoped agent answers, a scene object that means
something) has nowhere to hang.

Two proposals are already waiting on this. `add-mcp-server` wants asset-scoped
read tools, and `add-spatial-scene-viewer` places objects that represent physical
plant — without assets, a scene object can only bind to a single device, which is
exactly why that change scopes multi-device twins out to Y2.

**Why additive-only:** §4b re-scoped this after a verified fan-out count — 231
`device_id` references across 16 routers, two alarm evaluation paths, and strictly
per-device twins. Re-keying alarms and twins onto assets is Y2 work, *scheduled,
not smuggled*. This change therefore adds a parallel structure and asset-scoped
**reads** only; nothing that currently keys on `device_id` changes behaviour.

## What Changes

- **New `assets` table** — tenant-scoped, attached to a `site`, with a
  self-referencing `parent_id` so an asset contains assets (pump station → pump →
  motor). Carries `asset_type` as a **string column, not a types table** (see
  below), plus `attributes` JSONB, following the `device_groups` precedent.
- **Device → asset attachment** — a **nullable** `devices.asset_id`. A device
  instruments at most one asset; an asset has many devices. Nullable is load-
  bearing: every existing device stays valid and unattached, so this migration
  cannot break an existing install.
- **A separate asset tree endpoint** — `GET /tenants/{id}/assets/tree`, deliberately
  **not** folded into the existing `GET /tenants/{id}/hierarchy`. That endpoint has
  a documented "Org→Site→DeviceGroup tree with rollups in 5 flat queries" contract
  and a live consumer (`HierarchyCanvas`); widening its response shape would make
  this change non-additive in practice.
- **Asset-scoped reads** — asset device lists, and device/alarm rollups per asset
  computed by joining through `devices.asset_id`. These are **read-side joins over
  device-scoped data**: the alarm engine, alarm records, and digital twins remain
  device-keyed and are not touched.
- **Asset CRUD** under `/tenants/{id}/assets`, following the established router
  pattern — explicit `WHERE tenant_id`, tenant-mismatch 403, `set_tenant_context`
  — because `multi-tenancy-and-orgs` records that RLS is inert in this deployment
  and isolation is carried in application code.

**Deliberately not in this change:**

- **No `asset_types` table.** §4b's Y1 scope is "assets table + hierarchy +
  attachment + asset-scoped reads". A types table earns its place when assets get
  their own twin templates and rollup schemas — which is the Y2 multi-device twin
  work. A string column now, a real table then, is the additive order.
- **No re-keying of alarms, alert rules, or twins onto assets** (Y2, per §4b).
- **No asset-scoped alarm *evaluation*** — only asset-scoped alarm *reads*.
- **No `device_groups` removal or deprecation.** Groups and assets answer
  different questions (bulk-operation target vs monitored thing) and both stay.
- **No UI in this change.** The asset tree has an obvious home on the existing
  hierarchy page, but pairing that with the scene viewer's needs is a separate
  decision once one of the two consumers is actually being built.

## Capabilities

### New Capabilities
- `asset-registry`: the `assets` table and its tenant/site scoping, the asset
  parent-child tree and its cycle/depth rules, device→asset attachment semantics,
  asset CRUD, the asset tree endpoint, and asset-scoped read/rollup behaviour
  including what happens to unattached devices.

### Modified Capabilities
- `device-management`: a device gains an optional asset attachment (`asset_id`,
  nullable), with attach/detach behaviour and the rule that detaching an asset or
  deleting one never deletes the devices that instrument it.

## Impact

- `db/migrations/` + `api/alembic/versions/` — one additive migration: create
  `assets`, add nullable `devices.asset_id` with an index and an FK that is
  `ON DELETE SET NULL`. No backfill, no column drops, no type changes.
- `api/app/models/asset.py` — new `Asset` model; `api/app/models/__init__.py`
  registration; `asset_id` added to the device model.
- `api/app/schemas/asset.py` — new request/response schemas.
- `api/app/routers/assets.py` — new router; registered in `api/app/main.py`.
- `api/app/routers/devices.py` — accept and return `asset_id`; attach/detach.
- `api/tests/` — tenant-isolation tests for every new endpoint, tree cycle/depth
  tests, attachment and rollup tests, and a test that an existing device with
  `asset_id IS NULL` is unaffected across the changed device endpoints.
- **Unblocks** `add-mcp-server` (asset read tools) and `add-spatial-scene-viewer`
  (scene objects that denote assets rather than single devices).
- **No changes** to: the processor, `alarm_core`, alarm/alert-rule tables and
  routers, digital-twin cache, or the existing `/hierarchy` endpoint.
