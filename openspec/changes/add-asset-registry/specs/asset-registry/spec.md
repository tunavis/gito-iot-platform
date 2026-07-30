## ADDED Requirements

### Requirement: Assets are tenant-scoped and site-scoped, with isolation enforced in application code
The system SHALL store each asset with a required `tenant_id` and a required
`site_id`, and SHALL NOT store a duplicate `organization_id` — the organization is
reached through `sites.organization_id`. Because PostgreSQL RLS is inert in this
deployment (the app connects as database owner), every asset endpoint SHALL carry
tenant isolation in application code: an explicit `WHERE tenant_id` predicate, a
tenant-mismatch `403` when the path `tenant_id` differs from the token's, and
`set_tenant_context` before queries.

#### Scenario: Creating an asset without a site
- **WHEN** `POST /tenants/{id}/assets` omits `site_id`
- **THEN** request validation fails at the Pydantic layer with `422` before any
  handler code runs, since `site_id: UUID` has no default

#### Scenario: Reading an asset belonging to another tenant
- **WHEN** a token for tenant A requests `GET /tenants/B/assets/{asset_id}`
- **THEN** the response is `403` and no asset data is returned

#### Scenario: Listing assets never crosses tenants
- **WHEN** `GET /tenants/{id}/assets` is served
- **THEN** the query filters on `tenant_id` explicitly rather than relying on RLS,
  and assets belonging to other tenants are absent from the response

### Requirement: Assets form a self-referencing tree whose cycles are rejected on write
The system SHALL allow an asset to have a nullable `parent_id` referencing another
asset in the same tenant, so that an asset contains assets (pump station → pump →
motor). The system SHALL reject a write that would create a cycle — setting an
asset's parent to itself or to any of its own descendants — with `422`, by walking
the ancestor chain before commit. Storing a cycle and defending on read SHALL NOT be
treated as acceptable.

#### Scenario: Asset set as its own parent
- **WHEN** `PUT /tenants/{id}/assets/{asset_id}` sets `parent_id` to `asset_id`
- **THEN** the response is `422` and the stored asset is unchanged

#### Scenario: Asset set as a child of its own descendant
- **GIVEN** asset `station` has child `pump`, which has child `motor`
- **WHEN** `PUT` sets `station.parent_id` to `motor`
- **THEN** the response is `422` and no row is modified

#### Scenario: Parent in another tenant
- **WHEN** a `parent_id` names an asset belonging to a different tenant
- **THEN** the response is `422` and the parent is not applied

### Requirement: Asset tree depth is capped at 8 levels
The system SHALL reject a write that would place an asset deeper than 8 levels from
its root with `422`, so that recursive tree and rollup queries stay bounded and
rollup cost stays predictable.

#### Scenario: Creating a ninth level
- **GIVEN** an asset chain already 8 levels deep
- **WHEN** a new asset is created with the deepest asset as its `parent_id`
- **THEN** the response is `422` and no asset is created

### Requirement: A device attaches to at most one asset
The system SHALL attach a device to an asset through a nullable `devices.asset_id`
column, and SHALL NOT provide a many-to-many device↔asset membership. An asset has
many devices; a device instruments at most one asset. This is deliberately a
different shape from `group_devices`, because a device can legitimately belong to
several device groups but instruments only one physical thing — and a many-to-many
attachment would make subtree rollups ambiguous by counting one device under two
assets.

#### Scenario: Attaching a device to an asset
- **WHEN** a device is updated with an `asset_id` naming an asset in the same tenant
- **THEN** `devices.asset_id` holds that value and the device appears in that asset's
  device list

#### Scenario: Attaching a device to an asset in another tenant
- **WHEN** a device update names an `asset_id` belonging to a different tenant
- **THEN** the response is `422` and `devices.asset_id` is unchanged

### Requirement: Deleting an asset detaches its devices and never deletes them
The system SHALL, when an asset is deleted, set `asset_id` to NULL on every device
attached to it (`ON DELETE SET NULL`) rather than deleting those devices or refusing
the deletion. Deleting an asset SHALL cascade to its descendant assets, and those
descendants' devices SHALL likewise be detached and preserved.

#### Scenario: Deleting an asset that has devices
- **GIVEN** asset `pump` has 3 attached devices
- **WHEN** `DELETE /tenants/{id}/assets/{pump}` succeeds
- **THEN** all 3 devices still exist and each has `asset_id IS NULL`

#### Scenario: Deleting a parent asset
- **GIVEN** asset `station` has descendant `pump`, and `pump` has attached devices
- **WHEN** `DELETE /tenants/{id}/assets/{station}` succeeds
- **THEN** `station` and `pump` are both gone, and `pump`'s devices still exist with
  `asset_id IS NULL`

#### Scenario: Deleting the site an asset belongs to
- **WHEN** a site holding assets is deleted
- **THEN** those assets are deleted with it, and their devices survive with
  `asset_id IS NULL`

### Requirement: Asset rollups include the whole subtree and are computed without N+1 queries
The system SHALL, on the asset tree endpoint, report per-asset rollups that include
the asset's own devices **and** those of all its descendants — a pump station's
device count includes the devices on its child pumps. The system SHALL compute the
tree and its rollups in a bounded number of flat/recursive queries rather than one
query per asset.

#### Scenario: Subtree device count
- **GIVEN** asset `station` has no devices of its own and one child `pump` with 4
  devices
- **WHEN** `GET /tenants/{id}/assets/tree` is served
- **THEN** `station`'s device count is 4

#### Scenario: Query count does not grow with asset count
- **WHEN** the tree endpoint serves a tenant with many assets
- **THEN** the number of database queries issued is independent of the number of
  assets returned

### Requirement: Alarm rollups per asset are read-side joins over device-scoped alarms
The system SHALL derive per-asset alarm counts by joining `alarms` through
`devices.asset_id`. Alarm records SHALL remain keyed by `device_id`, and alarm
evaluation SHALL be unchanged — neither the processor nor `alarm_core` participates
in asset scoping in this change.

#### Scenario: Active alarm count for an asset
- **GIVEN** two devices attached to asset `pump`, one with an active alarm
- **WHEN** the asset tree or asset detail is read
- **THEN** `pump` reports 1 active alarm, and the `alarms` rows still reference
  `device_id` with no asset column

### Requirement: Unattached devices appear in no asset rollup and no synthetic node
The system SHALL treat a device with `asset_id IS NULL` as belonging to no asset: it
SHALL be counted in no asset's rollup, and the asset tree SHALL NOT manufacture an
"Unassigned" pseudo-asset to hold such devices. This follows the existing hierarchy
rule that a device with `organization_id`, `site_id`, and `device_group_id` all NULL
is counted in no node's `device_count`.

#### Scenario: Device with no asset
- **GIVEN** a tenant with 10 devices, 4 of them having `asset_id IS NULL`
- **WHEN** `GET /tenants/{id}/assets/tree` is served
- **THEN** the sum of all asset device counts is 6, and no node named "Unassigned"
  is present

### Requirement: The asset tree is served by its own endpoint, leaving `/hierarchy` unchanged
The system SHALL expose the asset tree at `GET /tenants/{id}/assets/tree` and SHALL
NOT add assets to `GET /tenants/{id}/hierarchy`. The existing hierarchy endpoint's
response shape and its documented "Org→Site→DeviceGroup tree with rollups in 5 flat
queries" behaviour SHALL be unaffected by this change.

#### Scenario: Hierarchy response is unchanged
- **WHEN** `GET /tenants/{id}/hierarchy` is served after assets exist
- **THEN** its response contains no asset nodes and no asset fields, and its query
  count is unchanged

### Requirement: `asset_type` is an unconstrained string
The system SHALL store `asset_type` as a free-text string with no enum and no lookup
table, so that verticals can name their own types while the vocabulary is still being
learned. No system behaviour SHALL branch on its value in this change.

#### Scenario: Arbitrary asset type accepted
- **WHEN** an asset is created with `asset_type` of `"borehole"` or any other string
- **THEN** it is stored verbatim and no validation rejects it for not being a known
  type
