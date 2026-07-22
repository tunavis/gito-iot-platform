## Context

The incident: fixture mode's device query was `WHERE dt.id = %s LIMIT 1` with no
concept of "safe to touch" — any device of the requested type was fair game,
indistinguishable from a purpose-built test device. That's a direct consequence of
this tool's own core design goal ("nothing downstream can tell a simulated uplink
from a real one") — the same property that makes it useful for proving a decoder
also means nothing *upstream* (the tool itself) could tell them apart either,
which is the half of the problem the original design didn't address.

## Goals / Non-Goals

**Goals:**
- Make it structurally impossible — not just discouraged — for the simulator to
  touch a device it didn't create.
- Make "give me a device to test with" a first-class, one-click operation instead
  of an implicit side effect of fixture mode.
- Remove the two concrete pieces of setup friction hit repeatedly this session:
  manual dependency install, guessing the Gito URL/port.

**Non-Goals:**
- Retroactively marking existing real devices as "known safe" — there is no such
  category. Only newly-created, explicitly-tagged devices are ever eligible.
- A generic device-tagging/labeling feature for the main app — `simulated` is a
  single reserved tag this tool owns; not exposed as a user-facing concept in the
  Gito dashboard itself.

## Decisions

**Enforcement lives in the SQL query, not the UI.** `_DEVICE_QUERY` (used by both
continuous sync and fixture mode) requires `tags @> '["simulated"]'`. Alternative
considered: check-then-warn in the Flask layer only. Rejected — the incident
happened through this exact tool's own fixture mode, which had no UI-layer malice,
just a query that was too permissive; putting the guarantee one layer down, in the
thing that actually talks to Postgres, means there's no code path (CLI, future UI,
someone else's script importing `Simulator`) that can bypass it by construction.

**Tag, not a new column.** `devices.tags` is already `jsonb`, already exposed on
create/update. Reusing it needs no migration and no schema change to the main app's
Device model — `tags @> '["simulated"]'` is a normal Postgres JSONB containment
query. Alternative considered: a dedicated `is_simulated` boolean column — more
explicit, but a schema migration for something this tool alone needs is more
machinery than the problem calls for.

**Device creation goes through the real device API, not a shortcut.** The
create-device endpoint is a thin wrapper around the same `POST /tenants/{id}/devices`
every real device creation uses — a simulator device is a completely real,
first-class Gito device (visible in the dashboard, usable in dashboards/alerts),
just tagged. This matters for "test it like production" fidelity: the device
itself, not only its telemetry, should be indistinguishable from a real one except
for the tag.

**`dev_eui` is randomly generated, collision handled by the database, not guessed
around.** `(tenant_id, dev_eui)` already has a unique index; the create endpoint
just retries with a fresh random value on the resulting 409. No pre-check query
needed — the constraint is the source of truth.

**Gito URL detection is a server-side probe, not a client-side guess.** The Flask
backend tries a short candidate list against `/api/health` itself (avoids CORS,
and the backend is where `requests` already lives) and returns whichever answers.
Browser-side detection was considered and rejected — cross-origin requests to
try multiple ports from the page would hit CORS restrictions the backend doesn't have.

## Risks / Trade-offs

- **[Risk] Someone manually adds the `simulated` tag to a real device via the main
  Gito UI or API, expecting a label, not knowing it grants simulator write access**
  → Mitigation: documented prominently in this tool's README (Safety section);
  the tag name itself is deliberately unambiguous. Not enforced at the main app's
  schema level — out of scope for a standalone tool to police the primary product's
  UI, but worth a future cross-check if this ever recurs.
- **[Risk] Multiple simulator devices exist for one type and `--fixture` without
  `--device-id` picks a different one each time** → Mitigation: harmless (both are
  equally safe, tagged devices) but can be surprising; `--device-id` exists
  precisely to pin it down when it matters, and the UI's per-device "send test
  data" button always uses a specific `device_id`.

## Migration Plan

No data migration. Existing real devices are simply never tagged `simulated`, so
they were already correctly excluded the moment this shipped — no cleanup step
needed. Anyone who had grown used to "the simulator touches every device"
(the pre-incident continuous-mode behavior) needs to create simulator devices via
the new Step 5 panel to get that behavior back, deliberately, per device type.
