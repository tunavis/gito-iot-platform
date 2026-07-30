## 1. Schema

- [x] 1.1 Add `Asset` model in `api/app/models/asset.py`: `id`, `tenant_id` (FK tenants, CASCADE, NOT NULL), `site_id` (FK sites, CASCADE, NOT NULL), `parent_id` (self FK, CASCADE, nullable), `name`, `description`, `asset_type` (String, nullable, no enum), `attributes` (JSONB default `{}`), `created_at`, `updated_at`
- [x] 1.2 Add indexes on `assets(tenant_id)`, `assets(site_id)`, `assets(parent_id)`
- [x] 1.3 Register `Asset` in `api/app/models/__init__.py`
- [x] 1.4 Add nullable `asset_id` to the device model: FK to `assets` with `ON DELETE SET NULL`, plus an index on `devices(asset_id)`
- [x] 1.5 Write the additive Alembic migration in `api/alembic/versions/` — create table, add column, add indexes. No backfill, no drops, no type changes. Do **not** edit `db/init.sql` (frozen by convention)
- [x] 1.6 Verify `alembic upgrade head` succeeds on top of a fresh `db/init.sql` locally, matching what the CI "DB Bootstrap" job asserts
- [x] 1.7 Verify `alembic downgrade` drops the column then the table cleanly

## 2. Tree invariants (write-side validation)

- [x] 2.1 Implement an ancestor-chain walk used by create and update to reject cycles: parent is self, or parent is a descendant of the asset → `422`
- [x] 2.2 Enforce the depth cap of 8 levels from root on create and update → `422`
- [x] 2.3 Reject a `parent_id` belonging to a different tenant → `422`
- [x] 2.4 Tests: self-parent, parent-is-own-descendant, cross-tenant parent, ninth-level insert — each asserts `422` **and** that no row was modified

## 3. Asset CRUD

- [x] 3.1 Pydantic schemas in `api/app/schemas/asset.py` — `site_id: UUID` with no default so omitting it fails at validation with `422`
- [x] 3.2 New router `api/app/routers/assets.py` with list/get/create/update/delete, following the established pattern: tenant-mismatch `403`, `set_tenant_context`, explicit `WHERE tenant_id` (RLS is inert — do not rely on it)
- [x] 3.3 Register the router in `api/app/main.py`
- [ ] 3.4 Tests: tenant-mismatch `403` on every endpoint; cross-tenant asset absent from list; `422` when `site_id` omitted

## 4. Device attachment

- [x] 4.1 Accept and return `asset_id` on device create/update/read in `api/app/routers/devices.py`; keep it a column, never written into `attributes`
- [x] 4.2 Validate that a supplied `asset_id` belongs to the caller's tenant → `422` otherwise, with `asset_id` left unchanged
- [x] 4.3 Allow clearing the attachment by setting `asset_id` to `null`
- [ ] 4.4 Tests: attach, change, clear; cross-tenant `asset_id` rejected; a device update that changes only `asset_id` triggers no ChirpStack/TTN sync
- [ ] 4.5 Test that a device with `asset_id IS NULL` behaves identically to before across read/update/list, and that creation omitting `asset_id` succeeds

## 5. Deletion semantics

- [x] 5.1 Test: deleting an asset with attached devices leaves those devices existing with `asset_id IS NULL`
- [x] 5.2 Test: deleting a parent asset removes descendants and leaves the descendants' devices existing with `asset_id IS NULL`
- [x] 5.3 Test: deleting a site removes its assets and leaves their devices existing with `asset_id IS NULL`

## 6. Asset-scoped reads and rollups

- [x] 6.1 Recursive CTE returning each asset's subtree device count (own devices plus all descendants'), in one query for the whole tree
- [x] 6.2 Per-asset active-alarm count by joining `alarms` through `devices.asset_id` — read-side only; do not add an asset column to `alarms` and do not touch the processor or `alarm_core`
- [x] 6.3 `GET /tenants/{id}/assets/tree` returning the tree with subtree-inclusive rollups
- [x] 6.4 `GET /tenants/{id}/assets/{id}/devices` listing the devices attached to one asset
- [x] 6.5 Test: parent with no own devices reports its child's device count
- [ ] 6.6 Test: query count is independent of the number of assets returned (no N+1)
- [x] 6.7 Test: devices with `asset_id IS NULL` are in no rollup and no "Unassigned" node is synthesised

## 7. Verify nothing existing moved

- [ ] 7.1 Test that `GET /tenants/{id}/hierarchy` response shape and query count are unchanged with assets present
- [ ] 7.2 Test that an alarm fires identically for an attached and an unattached device, with the alarm record still keyed by `device_id`
- [x] 7.3 Run the full API suite and confirm no pre-existing test changed behaviour
- [x] 7.4 Run `black api/app` and `openspec validate add-asset-registry` before opening the PR
