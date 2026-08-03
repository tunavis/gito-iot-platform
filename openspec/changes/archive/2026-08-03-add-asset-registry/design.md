## Context

The platform models customers (`tenants` → `organizations`), places (`sites`, already
a self-referencing tree), and administrative device groupings (`device_groups` +
`group_devices`). It does not model the **physical thing being monitored**. See
`proposal.md` for why that gap blocks `add-mcp-server` and
`add-spatial-scene-viewer`.

Three constraints shape every decision below:

1. **The fan-out is large and verified.** Strategy §4b counted 231 `device_id`
   references across 16 routers, two alarm evaluation paths, and strictly per-device
   twins. Anything that re-keys existing data is Y2.
2. **PostgreSQL RLS is inert in this deployment.** Per `multi-tenancy-and-orgs`, the
   app connects as a database superuser/owner, so policies do not enforce. Tenant
   isolation is carried entirely by explicit `WHERE tenant_id` predicates plus
   `validate_tenant_access()` in routers. New tables inherit that obligation.
3. **`GET /tenants/{id}/hierarchy` has a documented performance contract** —
   "Org→Site→DeviceGroup tree with rollups in 5 flat queries" — and a live consumer
   (`HierarchyCanvas`). It is a fixed point, not a place to add fields.

## Goals / Non-Goals

**Goals:**

- An `assets` table that can represent a pump station, borehole, or conveyor, and can
  contain other assets.
- A device→asset attachment that is safe to add to a live install with existing
  devices.
- Asset-scoped reads — device lists and device/alarm rollups — that include an
  asset's whole subtree, without N+1 queries.
- Leave every existing `device_id`-keyed code path behaviourally unchanged.

**Non-Goals:**

- Re-keying alarms, alert rules, or digital twins onto assets (Y2, §4b).
- Asset-scoped alarm *evaluation*. Only asset-scoped alarm *reads*.
- An `asset_types` table, asset twin templates, or multi-device asset twins (Y2).
- Deprecating or migrating `device_groups`.
- Any UI. No page, no canvas node, no navigation entry.

## Decisions

### 1. A new `assets` table — not more `sites` levels, not `device_groups`

*Alternatives considered:*

- **Extend the `sites` tree.** Sites are already self-referencing, so a "Pump Station
  A" site node is physically possible. Rejected: it makes every consumer ask "is this
  node a place or a machine?", and the two have different deletion semantics (losing a
  site should not imply the plant was decommissioned). It would also silently change
  the meaning of the existing hierarchy endpoint's site rollups.
- **Repurpose `device_groups`.** Rejected on two hard facts: it is **flat** (no
  `parent_id`), so it cannot express pump station → pump → motor; and it already has
  live semantics — a many-to-many `group_devices` membership plus
  `group_bulk_operations` targeting it. Changing what a group *means* would make this
  change non-additive, which is the one thing §4b forbids.

**Chosen:** a new table. Groups stay the bulk-operation target; assets become the
monitored thing. Both can coexist because they answer different questions.

### 2. `devices.asset_id` — a nullable single-valued FK, not a join table

Note this is deliberately the **opposite** shape from `group_devices`. Group
membership is genuinely many-to-many (a meter can be in "Production Sensors" *and*
"Site A Meters"). Asset attachment is not: a physical sensor instruments one thing.

*Alternatives considered:*

- **A `device_assets` join table**, mirroring `group_devices`. Rejected: allowing a
  device on several assets makes every rollup ambiguous — the same device would be
  counted under two asset subtrees, so "how many devices are faulty on this pump
  station" would have no single correct answer.

**Chosen:** `devices.asset_id UUID NULL REFERENCES assets(id) ON DELETE SET NULL`,
indexed. Nullable is load-bearing: every existing device remains valid and
unattached, so the migration cannot break a live install and needs no backfill.

`ON DELETE SET NULL` over `RESTRICT`: deleting an asset should detach its
instrumentation, never delete devices or be blocked by them. This gets an explicit
test, because silent detachment is the kind of behaviour that surprises people.

### 3. `site_id` required; `organization_id` **not** duplicated

`device_groups` stores both `organization_id` and `site_id`, both `NOT NULL`. Assets
store only `site_id` (required) and reach the organization through the site.

*Rationale:* `sites.organization_id` already exists, so a second copy is a
denormalisation that can diverge — exactly the class of bug that produces two
different answers to the same question. *Trade-off accepted:* filtering assets by
organization needs a join through `sites` rather than a direct column. That is one
join on an indexed FK, against a permanent consistency guarantee.

### 4. A separate `GET /tenants/{id}/assets/tree`, not a widened `/hierarchy`

Adding assets to the existing hierarchy response would change a documented 5-query
contract and its live consumer in the same change that claims to be additive.
Separate endpoint, separate recursive query, existing endpoint untouched.

### 5. Acyclicity enforced on write; depth capped

The client-side `layoutTree` already defends against parent cycles (it has a `seen`
guard so a malformed tree cannot hang the tab) — but that is a rendering safeguard,
not a data guarantee.

**Chosen:** reject on write. Setting an asset's parent to itself or to any of its own
descendants is a 422, checked by walking the ancestor chain before commit. Storing a
cycle and defending on read would leave corrupt data that every future consumer has
to re-defend against.

Depth is capped at a documented constant (8) so the recursive CTE stays bounded and
rollup cost is predictable. Pump station → pump → motor → bearing is 4; 8 leaves
generous room without allowing an unbounded chain.

### 6. Rollups are subtree-inclusive, in one recursive query

A pump station's device count must include the devices on its child pumps, or the
number is misleading. Rollups therefore walk the asset subtree via a recursive CTE
and aggregate in a single query, following the same no-N+1 discipline the hierarchy
spec already sets.

Alarm rollups join `alarms` through `devices.asset_id`. This is a **read-side join
over device-scoped data** — `alarms` keeps its `device_id`, the processor and
`alarm_core` are not touched, and nothing about evaluation changes.

### 7. Unattached devices appear in no asset rollup

`multi-tenancy-and-orgs` already specifies that a device with `organization_id`,
`site_id`, and `device_group_id` all NULL is counted in no node's `device_count`.
Assets follow that precedent rather than inventing an "Unassigned" pseudo-asset:
`asset_id IS NULL` means the device is in no asset rollup, and the asset tree does
not manufacture a node to hold it.

### 8. `asset_type` is an unconstrained string in Y1

No enum, no lookup table. Verticals name their own types (`pump_station`, `borehole`,
`conveyor`) while the vocabulary is still being learned from real sites. A controlled
vocabulary earns a table when something *depends* on the value — which is precisely
when `add-isometric-asset-kit`'s footprint sidecars or asset twin templates land, and
those are Y2. Introducing the table now would freeze a vocabulary before there is
evidence for it.

## Risks / Trade-offs

- **Dead schema if neither consumer starts.** → This change ships tables nothing reads
  yet. Being honest: if `add-mcp-server` and `add-spatial-scene-viewer` both stay
  unstarted, this is inert. It is *harmless* because it is additive (nullable column,
  new table), but it is not free. Mitigation is sequencing, not code: build this
  immediately before one of its two consumers, not long in advance.
- **Two overlapping grouping concepts confuse users.** → Real risk; assets and device
  groups will both look like "a folder of devices" in a picker. Mitigated here only by
  shipping no UI. The first UI that surfaces both must make the distinction explicit,
  the way the Device Groups form already tells the user its category field is for
  their own organisation and nothing else.
- **`ON DELETE SET NULL` silently detaches devices.** → Explicit test asserting devices
  survive asset deletion with `asset_id IS NULL`; called out in the spec so it is
  documented behaviour rather than a discovered surprise.
- **Y2 alarm/twin re-keying is still a large change.** → This design does not pretend
  otherwise. What it does provide is the join path (`devices.asset_id`) that the Y2
  work needs, so the re-keying is a migration rather than a modelling exercise.
- **Recursive CTE cost on wide trees.** → Index on `assets(parent_id)` and
  `devices(asset_id)`, plus the depth cap. Rollups are one query per request, not per
  node.

## Migration Plan

One additive Alembic migration in `api/alembic/versions/`:

1. `CREATE TABLE assets` (tenant FK cascade, site FK cascade, self FK `parent_id`
   `ON DELETE CASCADE`, `asset_type` string, `attributes` JSONB default `{}`).
2. Indexes on `tenant_id`, `site_id`, `parent_id`.
3. `ALTER TABLE devices ADD COLUMN asset_id UUID NULL REFERENCES assets(id) ON DELETE
   SET NULL` + index.

No backfill, no column drops, no type changes, no data movement.

`db/init.sql` is **not** edited — it is frozen by convention (its frozen role is
documented at the top of the file, and the CI "DB Bootstrap" job asserts that
init.sql followed by `alembic upgrade head` succeeds on a fresh database). This
migration must pass that job.

**Rollback:** drop the column, then the table. Safe by construction — at the moment
this lands nothing reads either, so a rollback cannot orphan behaviour. That property
disappears once a consumer ships, which is the real reason to keep this change small.

## Open Questions

- **Where does the asset tree surface in the UI?** The existing hierarchy page is the
  obvious home, but the scene viewer may want a different shape. Deferred to whichever
  consumer is built first, deliberately: no UI ships in this change.
- **Does a scene object bind to an asset or to a device?** `add-spatial-scene-viewer`'s
  call, not this change's. Assets make the multi-device case *possible*; that proposal
  currently scopes it to Y2.
- **When does `asset_type` become a controlled vocabulary?** Proposed trigger: the
  first time code branches on its value.
