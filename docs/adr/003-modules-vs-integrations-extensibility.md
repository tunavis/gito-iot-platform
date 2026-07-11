# ADR-003: Extending the platform — Integrations (connectors) vs Modules (vertical solution packs)

**Last Updated: 2026-07-11**

---

## Status

**Accepted** — as the *pattern* for how future capabilities attach to the platform.

Scope note: this ADR records a **decision about structure**, not a work order. No
new module or integration is scheduled by it. The current priority is getting the
existing application to 100%; this document exists so that when we *do* pick up an
adjacent opportunity, it slots in against an agreed contract instead of being
improvised against the core.

## Context

Gito began as a device-monitoring SaaS: telemetry in (MQTT / HTTP / LoRaWAN),
dashboards and alarms out. We are now seeing adjacent opportunities that extend the
platform *beyond* pure device monitoring — the first concrete one being a
**feed-mill recipe bridge** between nutrition-formulation software (e.g. "Alex")
and mill control systems (e.g. Kairos Automill or a bare PLC), where today a person
manually re-types a formula from one system into the other with no audit trail. See
the systems map for that specific case (scratchpad artifact, 2026-07).

The recurring question this raises: **when a new external system or a whole new
problem domain shows up, how do we add it without hacking the core, forking the
app, or derailing current work?**

The codebase already contains two *un-named, un-codified* extension patterns:

- **External connectors** — `api/app/routers/integrations.py` plus the LoRaWAN /
  ChirpStack ingest paths (`lorawan_ingest.py`, the `chirpstack_mqtt` bridge). These
  adapt an outside system to the platform and are surfaced in the "Connections" UI.
- **Vertical/domain extension** — `solution_templates` (industry vertical templates)
  and the **device-type decoder pattern** (per-vendor `decoder` + `telemetry_schema`
  + `key_mapping` keyed on `device_type_id`, see the "Device Type per Vendor"
  convention). These add domain shape without touching the ingest core.

What's missing is a **naming + placement convention**: is a given new thing a thin
connector or a whole capability, where does its code / data / UI live, and what must
it *reuse* versus *build*. Without that, the first vertical we build risks either
bloating `integrations.py` or quietly bypassing the funnel/alarm/audit/RLS
guarantees we spent real effort making reliable.

## Decision

Adopt a **three-layer model with two distinct, deliberately-named extension seams.**

### 1. Platform core (never forked per vertical)
Auth & RBAC, multi-tenancy/RLS, the single telemetry ingest funnel, TimescaleDB
storage, the shared alarm engine (`alarm_core`), dashboards/widgets, notifications,
audit logging, and protocol-abstracted command/OTA dispatch. Everything else attaches
to this; nothing else reimplements it.

### 2. Integrations = connectors (the plumbing)
An **adapter to an external system**, inbound or outbound. Thin by definition:
normalize external data *into* the platform's internal model, or push internal data
*out* over some external protocol. **No domain logic of its own.** Extends the
existing `integrations` concept.

Examples that exist today: LoRaWAN network-server webhooks, ChirpStack (REST + MQTT
bridge), the Mosquitto MQTT path. Examples a future module might need: a
formulation-software import adapter (parse Alex's export → normalized recipe), an
industrial-protocol driver (Modbus / OPC-UA / Siemens S7 / EtherNet-IP → write
setpoints to a PLC).

### 3. Modules = vertical solution packs (the product-shaped capability)
An **opt-in domain capability** that introduces a new thing the user works in. A
module bundles its own data model + API namespace + UI, and *composes* one or more
integrations on top of the platform core. It is bigger than a connector and is
enabled per tenant.

The nascent precedent is `solution_templates` (already a "this is the water vertical"
notion). The feed-mill recipe bridge would be the first *full* module.

### The rule of thumb (how to classify a new thing)
> **Does it just move data across a boundary?** → Integration (connector).
> **Does it introduce a new domain the user operates in?** → Module (which will
> itself use one or more integrations).

A recipe bridge is a **module** (new domain: recipes/batches/mill jobs, own UI,
audit of every handoff) that *uses* two **integrations** (an Alex importer, a PLC
driver). Classifying it as "just an integration" would be the mistake — it has a
data model and a UI, so it doesn't belong inside `integrations.py`.

### Non-negotiable invariants any extension must honor
These are the actual "add it without issues" guardrails, grounded in reliability work
already done in this codebase. A new integration or module MUST:

1. **Set RLS context** via `RLSSession.set_tenant_context(...)` — transaction-scoped
   (see ADR-001 and the `database.py` fix). Never query tenant data without it.
2. **Ingest only through the single funnel** (`telemetry_stream.stream_ingest` →
   processor). Never write telemetry directly — that bypasses alarm evaluation.
3. **Let the audit middleware cover it** — tenant-scoped mutating endpoints
   (`/tenants/{id}/...`, POST/PUT/PATCH/DELETE) are audited automatically by
   `app/middleware.py`; a module gets this for free by following the URL convention,
   and should not hand-roll its own audit unless it needs richer `changes` detail.
4. **Match response shape to convention** — don't invent a third response envelope;
   follow the `SuccessResponse` / bare-model conventions already catalogued, so
   frontend consumers stay consistent.
5. **Evaluate alarms only in the processor**, reusing `alarm_core` — do not add a
   second evaluation path.
6. **Ship its schema as an Alembic migration in the same commit** as the model,
   RLS-scoped to tenant like every other tenant table.

A module that respects these six reuses the platform's hard-won guarantees instead of
re-earning them.

## Candidate modules (future — NOT built, append here as ideas arise)

This is the running list the user asked for — a place to capture "environments we
could fit into" without committing to build them.

1. **Feed-mill recipe bridge** *(first candidate; parked)* — watch/pull a formulation
   export (Alex or peers: Format, Adifo/Bestmix, AFOS, Hybrimin), normalize it, push
   to whichever on-site control system accepts it, and surface a dashboard + alert
   answering "did this batch get the right recipe" — which nobody can answer today.
   **Blocked on discovery, not engineering:** need (a) a real Alex export sample and
   whether Alex exposes any API beyond file export, and (b) per-site, whether a
   SCADA/HMI layer sits above the raw PLC (one integration point) or it's bare PLC
   (potentially several protocol drivers). Does **not** make Gito a PLC/SCADA vendor
   (that's a certified on-site engineering business — Kairos's domain) nor a
   formulation-science competitor (Alex's domain); it sits in the *seam* between them.
2. _(future candidates go here)_

## Consequences

### Positive
- ✅ A new opportunity has an obvious home and a checklist — no improvising against the core.
- ✅ Connectors stay thin and swappable; verticals stay self-contained and opt-in.
- ✅ Reuses the reliability core (RLS, funnel, alarms, audit) instead of forking it per vertical.
- ✅ Zero impact on the current app — this is documentation; nothing ships from it.

### Negative / Trade-offs
- ⚠️ The module/integration boundary is a judgment call at the edges; the rule of thumb resolves most but not all cases.
- ⚠️ No enforced module framework yet — until the first module lands, the "contract" is convention + review, not compiler-checked.

### Neutral / To monitor
- 📝 When the first real module is built, it will likely formalize a lightweight module
  registry + per-tenant enablement flag. Deliberately deferred (YAGNI) — building that
  framework now, with zero modules to run on it, is exactly the speculative work this
  ADR is meant to prevent.

## Alternatives Considered

### Alternative 1: Everything is an "integration" (flat, no module concept)
**Pros:** one concept, less to explain.
**Cons:** a recipe bridge has its own data model + UI; forcing it into `integrations.py`
bloats a connector layer meant to be thin, and mixes domain logic into plumbing.
**Why not chosen:** the two things are genuinely different sizes; collapsing them hurts
both.

### Alternative 2: Fork the app / separate codebase per vertical
**Pros:** total isolation per vertical.
**Cons:** loses the multi-tenant core, the alarm engine, audit, and dashboards — each
fork re-earns them and drifts. Maintenance and security-fix fan-out become a nightmare.
**Why not chosen:** the whole value is the shared reliable core; forking discards it.

### Alternative 3: Build the module framework now
**Pros:** first module would drop in faster.
**Cons:** speculative abstraction with nothing to validate it against; directly
competes with the stated priority of finishing the current app.
**Why not chosen:** YAGNI. Write the contract now, build the framework lazily when the
first real module forces its actual shape.

## Implementation Notes

- Until a first module exists, copy the working precedents: `integrations.py`
  (connector CRUD + the "Connections" UI), `solution_templates` (vertical pack shape),
  and the device-type decoder pattern (per-vendor normalization).
- When the recipe bridge (or any module) becomes real, drive it through
  `/opsx:propose` so it gets proposal + delta specs + tasks, rather than being
  hand-built — this ADR is the standing context that proposal should reference.

## References

- Systems map artifact: "Where Gito Sits Between the Recipe and the Mill" (2026-07)
- [ADR-001: Row-Level Security multi-tenancy](./001-row-level-security-multi-tenancy.md)
- Specs: `openspec/specs/integrations-and-commands`, `telemetry-ingestion`,
  `audit-and-events`, `multi-tenancy-and-orgs`, `architecture`
- Conventions: "Device Type per Vendor" (decoder/schema/key_mapping), single ingest
  funnel (`api/app/services/telemetry_stream.py`)

---

## Changelog

- 2026-07-11: Initial draft, Accepted as the extensibility pattern (no modules built yet)
