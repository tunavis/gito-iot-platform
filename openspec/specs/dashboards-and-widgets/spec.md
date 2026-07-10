## Purpose
Lets each user build a personal, drag-and-drop dashboard of widgets bound to
device/metric data sources, and lets a tenant bootstrap a pre-built dashboard (plus
device types and alert rules) from an industry solution template. Backed by
`api/app/routers/dashboards.py`, `dashboard_widgets.py`, `solution_templates.py`,
`api/app/models/dashboard.py`, and `api/app/services/solution_templates.py`.

## Requirements

### Requirement: Dashboards are user-scoped, not just tenant-scoped — RLS enforces both tenant AND owner
The system SHALL apply the `dashboards_user_isolation` RLS policy
(`tenant_id = current_tenant AND user_id = current_user`) rather than the
tenant-only policy used elsewhere, and every router in `dashboards.py`/
`dashboard_widgets.py` calls `session.set_tenant_context(tenant_id, current_user_id)`
(passing both IDs) rather than the tenant-only overload used by most other routers.
Every dashboard query additionally repeats `Dashboard.user_id == current_user_id`
in its `WHERE` clause in application code, on top of RLS.

#### Scenario: Two users in the same tenant cannot see each other's dashboards
- **WHEN** user A calls `GET /tenants/{id}/dashboards`
- **THEN** only dashboards where `user_id == A` are returned, even though both users
  share the same `tenant_id` and both would pass a tenant-only RLS check

### Requirement: Only one dashboard per user can be the default; setting a new default unsets the previous one
The system SHALL, on `POST /dashboards` with `is_default=true` or `PUT /dashboards/{id}`
transitioning `is_default` from false to true, first bulk-`UPDATE` all of that
user's other dashboards to `is_default=false` before creating/updating the target —
there is no unique partial index enforcing "at most one default per user" at the DB
level; this invariant is maintained entirely by the two endpoints doing the
unset-then-set dance in the correct order.

#### Scenario: Setting a second dashboard as default
- **WHEN** user already has dashboard A as default and creates dashboard B with
  `is_default=true`
- **THEN** A's `is_default` flips to `false` and B's is `true` — exactly one default
  exists afterward

### Requirement: Widget CRUD is nested under a dashboard and re-verifies dashboard ownership on every call
The system SHALL, for every widget endpoint (create/update/delete/bind-device),
call `verify_dashboard_ownership()` first — re-checking
`Dashboard.id == dashboard_id AND Dashboard.tenant_id == tenant_id AND Dashboard.user_id == current_user_id`
— before touching the `DashboardWidget` row, since `dashboard_widgets` itself carries
no `tenant_id`/`user_id` column and has no RLS policy of its own (it inherits
isolation transitively through its `dashboard_id` FK and this ownership check).

#### Scenario: Widget ID belongs to a different dashboard
- **WHEN** `PUT /dashboards/{A}/widgets/{widget-that-belongs-to-dashboard-B}` is
  called
- **THEN** the widget lookup filters on `DashboardWidget.dashboard_id == dashboard_id (A)`,
  so it returns `404 Not Found` — "Widget not found" even though the widget row
  exists (under a different dashboard)

### Requirement: Layout batch-update repositions multiple widgets in one call, silently skipping unknown/malformed entries
The system SHALL, on `PUT /dashboards/{id}/layout`, iterate `layout_data.widgets[]`
and for each entry with an `id`, build a partial `UPDATE` from whichever of
`x`/`y`/`w`/`h` keys are present (mapped to `position_x`/`position_y`/`width`/
`height`); entries missing `id` are skipped without error; the `UPDATE` is scoped
by both `DashboardWidget.id` and `.dashboard_id` so a malicious/incorrect widget ID
from another dashboard silently updates zero rows rather than erroring.

#### Scenario: Layout update mixes valid and unknown widget IDs
- **WHEN** the `widgets[]` payload includes 3 real widget IDs on this dashboard and
  1 ID that doesn't exist
- **THEN** `updated_count` in the response reflects only entries that had at least
  one position/size key and an `id` present in the payload (4, since the count is
  incremented whenever `update_values` is non-empty, regardless of whether the
  `UPDATE` actually matched a row) — the response does not distinguish "updated"
  from "attempted-but-matched-nothing"

### Requirement: Solution templates are global (no tenant scoping) and applying one is transactional across device types, dashboard, and alert rules
The system SHALL fetch the template (`TemplateService.get_template`) **before**
calling `session.set_tenant_context()`, since `solution_templates` carries no
`tenant_id` and is read the same way regardless of caller — then, once tenant
context is set, `apply_template()` creates the tenant's device types, one dashboard
with its widgets, and alert rules as tenant-scoped writes in a single logical
operation, returning the newly-created dashboard.

#### Scenario: Applying an inactive template
- **WHEN** `POST /tenants/{id}/solution-templates/{tid}/apply` targets a template
  with `is_active=false`
- **THEN** `400 Bad Request` — "Solution template is not active" (checked before
  `set_tenant_context`/any tenant-scoped writes)

#### Scenario: Non-existent template
- **WHEN** `template_id` doesn't match any row
- **THEN** `404 Not Found` — "Solution template not found" (same for both
  `GET /solution-templates/{id}` and the `/apply` action)
