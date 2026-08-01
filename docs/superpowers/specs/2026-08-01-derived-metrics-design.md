# Derived Metrics — Rate From a Counter

**Date**: 2026-08-01
**Status**: Approved, not yet implemented

## Problem

A B METERS IWM-LR3/LR4 water meter reports a cumulative totalizer
(`total_volume`, litres since install) and never an instantaneous flow rate.
`WaterMeterTemplate.tsx` drives every animated element — the pipe (`DashFlow`),
the gauge needle (`ArcSweep`) and the status LED (`Blink`) — from one value:

```ts
const flow = resolveNumeric(telemetry, FLOW_KEYS);   // WaterMeterTemplate.tsx:37
const flowIntensity = Math.min(flow / 100, 1);       // :38
```

`FLOW_KEYS` is `flow_rate, flow, flowrate, water_flow, rate, throughput`. None
exist on this device. The exact-match pass finds nothing; the substring pass
then matches `reverse_flow_alarm` (it contains `flow`) and returns `0.0`. So
`flowIntensity` is permanently zero and the illustration is a still life while
data arrives normally.

Adding `total_volume` to `FLOW_KEYS` would be worse:
`Math.min(146886 / 100, 1)` pins to `1.0` and the pipe animates at full speed
forever. Confidently wrong beats static.

The template cannot fix this itself — `TemplateProps.telemetry` is
`latestValues`, a flat snapshot with no history, and a rate needs two points in
time.

**Scope**: 59 devices of this type today, plus `WaterTankTemplate` which also
drives its inlet/outlet from `FLOW_KEYS`, plus every counter-style meter added
later (energy kWh, gas m³, pulse counters).

**Constraint that shapes the design**: no developer per device type. Authors
are the platform team, support staff, *and* tenant admins.

## The Second Root Cause — Read This Before Implementing

Delivering a correct `flow_rate` metric **is not sufficient**. The twin would
still not move.

`DashFlow.tsx:38` and `Blink.tsx:22` both gate on:

```ts
const active = intensity > 0.05 && !paused;
```

A real IWM meter moves ~2680 L/day = **1.86 L/min**. Through the template's
hardcoded `Math.min(flow / 100, 1)` that is `0.0186` — **below the 0.05
threshold**. The pipe and the status LED stay dead. `ArcSweep` renders at
`clampedIntensity > 0.01`, so the needle would twitch by 1.9% of sweep and read
as stationary.

The `/ 100` is a guess at the metric's full-scale range, and it is wrong by a
factor of ~35 for this meter. This pattern appears **18 times across all 8
templates**:

| Denominator | Basis |
|---|---|
| `flow / 100` (×4), `load / 100`, `amps / 100`, `position / 100`, `battery / 100`, `level / 100` | Guess |
| `rpm / 3000` (×2) | Guess (reasonable for a 2-pole motor at 50 Hz) |
| `temp / 120` | Physical — class-F winding limit |
| `vib / 10` | Physical — ISO 10816, >7 mm/s is rough |
| `irradiance / 1000` | Physical — 1000 W/m² is standard test conditions |
| `pressure / 10` | Guess |

The physically-grounded ones are good defaults. The guesses are not, and a
derived metric has no reason to land inside an arbitrary 0–100 band.

**Fix**: the full-scale range comes from the metric definition, which already
has `min`/`max` fields in `data_model` (currently `null` on these entries). The
hardcoded value becomes the *fallback* when no range is declared, so existing
behaviour is unchanged for every device type that hasn't declared one.

### `max` is display full-scale, NOT the device's rated maximum

This distinction decides whether the feature works, and the intuitive answer is
the wrong one.

The obvious value to enter for a water meter is its rated flow, Q3 = 4 m³/h =
**66.7 L/min**. Typical household flow of 1.86 L/min against that is `0.028` —
**still below the 0.05 threshold.** The twin stays dead, and the person who
filled the form in correctly has no idea why.

`max` must be *the value at which this illustration should read as full*, which
for a metric that normally sits at a few percent of its rated ceiling is
nowhere near that ceiling. For this meter, roughly 10 L/min gives `0.186` — a
visibly moving pipe at normal flow and headroom for a burst.

Two consequences:

- Help text says "the reading at which the picture should look **full**", never
  "maximum" — and warns explicitly against entering a nameplate rating.
- **The backfill suggests it.** Backfill already computes every historical rate
  for every device of that type; the p99 of those values is a far better
  full-scale estimate than a human guess, and it requires no knowledge of the
  hardware. Offer it as a pre-filled value the author can override.

The p99 suggestion is what makes this safe for tenant admins. Without it, the
most likely failure is a correctly-filled form producing a motionless twin.

### Plumbing required

`SlotBinding` today is `{ slot, metric, unit? }` (`types.ts`) and
`TemplateProps` is `{ width, height, telemetry?, deviceStatus? }`
(`TemplateRenderer.tsx`). Neither carries a range. The change:

1. `SlotBinding` gains optional `min` / `max`, copied from the matched schema
   entry by `resolveTemplate`.
2. `TemplateRenderer` passes the resolved ranges down to the template.
3. Each of the 18 call sites becomes `value / (declaredMax ?? <current
   constant>)`. Mechanical, one line each, behaviour-preserving where no range
   is declared.

Exact helper signature is an implementation-plan decision, not a design one.

## Approach

A derived metric is a fourth `source.mode` on the existing metric definition.
Every piece this needs already exists:

| Needed | Already exists |
|---|---|
| Per-metric "how does this arrive" UI | `MetricsTable.tsx:34` — `SOURCE_TABS` |
| Per-device-type config read at ingest | `get_key_mapping()`, `mqtt_processor.py:218` |
| Payload transform step at ingest | `apply_key_mapping()`, called at `:1325` and `:1680` |
| Cached device-type lookup, 5-min TTL | `_key_mapping_cache`, `:169` |
| Background work off a request | `BackgroundTasks` (FastAPI built-in) |

One more union member, one more tab, one more transform call, one SQL
statement.

## Config Shape

Extend the `MetricSource` union in
`web/src/app/dashboard/device-types/_types.ts:141`:

```ts
| { mode: 'derive'; from: string; op: 'rate'; per: 'second' | 'minute' | 'hour' | 'day' }
```

A configured metric:

```json
{
  "name": "flow_rate",
  "type": "float",
  "unit": "L/min",
  "min": 0,
  "max": 66,
  "source": { "mode": "derive", "from": "total_volume", "op": "rate", "per": "minute" }
}
```

Stored in `device_types.data_model` beside the existing entries. No new table,
no new column, no migration.

`op` is a single-value union today. It exists as a field so the shape need not
change when a second operation is added; it is not an extension point to build
against now.

## UI

A fourth tab in `MetricsTable.tsx`:

```
flow_rate
  [Sent as-is] [Decode bytes] [Rename key] [Calculate from ✓]
    Source metric:  [total_volume ▾]
    Operation:      [Rate over time ▾]
    Per:            [minute ▾]
    Unit:           L/min          (auto-filled, editable)
    Looks "full" at: [10] L/min    [Suggest from history]
```

The **Suggest from history** button runs the same window function the backfill
uses but returns only the p99 of the computed rates, so the author gets a
sensible full-scale value before saving and without knowing the hardware. It
needs one small read-only endpoint; it is the difference between this being
safe for tenant admins and being a trap.

Unit auto-fill is the source unit plus an interval suffix — `second → /s`,
`minute → /min`, `hour → /h`, `day → /day`. `L` with `per: 'minute'` yields
`L/min`. The field stays editable.

Guard rails, because tenant admins can author these:

- **Source dropdown is populated from this device type's own metrics.** A
  non-existent key cannot be typed.
- **A derived metric cannot be a source.** No chains, therefore no cycles to
  detect and no evaluation-order question.
- **`max` is required for a derived metric** (it is optional for others), and
  is labelled *"looks full at"*, never *"maximum"*. Without it the animation
  threshold problem returns silently; with a nameplate rating in it, the same.
  Pre-fill from **Suggest from history** wherever history exists.
- **Warn when the source is not a counter.** Server-side on save: sample the
  most recent readings of the source metric for devices of this type; if any
  consecutive pair decreases, warn that rate will be meaningless. A warning,
  not a block — a new device type has no history to judge by.
- **Reject a name colliding** with another metric on the same device type.
- **`per: 'day'` is offered** because a meter that uplinks daily only ever
  knows its daily average. The form must not imply precision the device cannot
  deliver.

## Ingest

`apply_derived(payload, device_id)` is called immediately after
`apply_key_mapping()` at both existing call sites (`mqtt_processor.py:1325`
and `:1680`). By then the derived key is an ordinary payload entry, so
storage, alert rules, charts and twins all receive it with no further change.

**Previous-reading cache.** Computing a rate needs the prior counter value. A
DB read per uplink per derived metric would be a throughput regression against
the batched-insert design. Instead keep an in-memory
`{(device_id, metric_key): (ts, value)}` map, seeded lazily from the DB on miss
and served thereafter from memory — the same shape as `_key_mapping_cache`. A
process restart costs one read per device on its next uplink.

**The cache advances only on a strictly newer timestamp.** LoRa uplinks arrive
out of order and are retransmitted. If a late-arriving older reading were
allowed to overwrite the cached baseline, the *next* uplink would compute
against the wrong prior point and emit a wrong rate. Update the entry only when
`ts > cached_ts`.

```
rate = (value - prev_value) / (ts - prev_ts).total_seconds() * PER_SECONDS[per]
```

**Guards, in order:**

| Condition | Behaviour | Why |
|---|---|---|
| Source key absent from this payload | Emit nothing | Nothing to compute from |
| No previous reading | Emit nothing | First uplink has no interval |
| `ts - prev_ts <= 0` | Emit nothing, do not advance cache | Out-of-order or duplicate uplink |
| `value - prev_value < 0` | Emit nothing, **do** advance cache | Counter wrapped or meter replaced |
| `value - prev_value == 0` | **Emit `0`** | Meter genuinely idle — the twin should show stopped |
| Otherwise | Emit the rate | |

The negative-delta guard is the important one. A meter swap or 32-bit rollover
produces a large negative delta, and a negative flow rate reaching an alert
rule is exactly the "confidently wrong" failure this design exists to avoid.
**Emit nothing rather than a wrong number** — but *do* advance the cache to the
new baseline, or every subsequent uplink compares against the pre-swap counter
and stays broken forever.

No upper clamp. A genuine burst or leak must remain visible as a spike.

## Backfill

Adding a derived metric to an existing device type backfills its history on
save. Current volume: **1978 counter rows across 59 devices**, oldest
2026-07-08. One statement, not a job:

```sql
INSERT INTO telemetry (tenant_id, device_id, metric_key, metric_value, unit, ts)
SELECT tenant_id, device_id, :new_key,
       (metric_value - prev_value) / EXTRACT(EPOCH FROM (ts - prev_ts)) * :per_seconds,
       :unit, ts
FROM (
  SELECT t.tenant_id, t.device_id, t.metric_value, t.ts,
         LAG(t.metric_value) OVER (PARTITION BY t.device_id ORDER BY t.ts) AS prev_value,
         LAG(t.ts)           OVER (PARTITION BY t.device_id ORDER BY t.ts) AS prev_ts
  FROM telemetry t
  WHERE t.device_id = ANY(:device_ids) AND t.metric_key = :source_key
) s
WHERE prev_value IS NOT NULL
  AND metric_value >= prev_value          -- same reset guard as ingest
  AND ts > prev_ts
  AND NOT EXISTS (
    SELECT 1 FROM telemetry x
    WHERE x.device_id = s.device_id AND x.metric_key = :new_key AND x.ts = s.ts
  );
```

Triggered from the existing `PUT /device-types/{id}`
(`api/app/routers/device_types.py:265`) via `BackgroundTasks`, so the save
returns immediately.

**`id` is omitted deliberately** — it defaults to `gen_random_uuid()`
(verified against the live schema).

**Idempotency is `NOT EXISTS`, not `ON CONFLICT`.** `telemetry` has no unique
constraint on `(device_id, metric_key, ts)` — only the non-unique
`idx_telemetry_device_metric_ts`, which makes the check fast. Re-saving a
device type must not double-write.

### Config changes invalidate existing derived rows

This is the sharp edge. If someone edits `from`, `op`, or `per` — say `minute`
→ `hour` — every previously backfilled row is now in the wrong unit. A plain
`NOT EXISTS` re-run would **skip** them, leaving one series with two different
units silently mixed. Charts and alarms would both be wrong.

**On save, if `from`, `op`, or `per` differs from the stored config, delete
every existing row for that `metric_key` across devices of this type before
backfilling.** Only an unchanged config takes the additive `NOT EXISTS` path.

Removing a derived metric from a device type deletes its rows too, behind a
confirmation naming the row count. Leaving orphans would strand a metric that
nothing can explain or regenerate.

### TimescaleDB

`telemetry` is a hypertable (**9 chunks, compression enabled, 4 currently
compressed**; oldest chunk 2026-03-05). Backfill writes into historical chunks,
some of them compressed.

TimescaleDB 2.25 supports inserting into compressed chunks, so this works, but
it is materially slower than writing to an uncompressed chunk and can fragment
compressed data. At 1978 rows this is irrelevant. **The ceiling to watch**: a
device type with millions of historical counter rows would want an explicit
decompress → insert → recompress cycle, or chunked batching. Note it, do not
build it.

### Backfill does not fire alarms — verified

Worth stating because it is the scariest possible side effect of writing 2000
historical rows. Two independent confirmations against the live system:

- `telemetry` has **no triggers** (`pg_trigger` returns empty for non-internal
  triggers).
- Alert evaluation is payload-driven: `evaluate_alerts` (`mqtt_processor.py:1374`)
  is called from the MQTT ingest path with the incoming payload, not from a
  table read. A SQL-level insert never reaches it.

Backfilled history is therefore inert with respect to alarms.

## Testing

Two test files, covering the branches that would otherwise ship wrong numbers:

**Ingest** (`processor/tests/`):
- A counter series containing a mid-series reset. Asserts the rate is correct
  across normal steps, that **no row is emitted** at the reset, and that the
  reading *after* the reset computes against the post-reset baseline.
- An out-of-order uplink. Asserts it emits nothing **and** does not move the
  cached baseline, so the following in-order uplink is still correct.
- A zero-delta uplink emits `0`, not nothing.

**Backfill** (`api/tests/`):
- The same counter series through the SQL produces the values the ingest path
  produces. The two implementations must not disagree — a chart and a live
  reading showing different numbers for the same moment is worse than either
  being absent.
- Running the backfill twice inserts no duplicate rows.
- Changing `per` from `minute` to `hour` and re-saving leaves **no** rows in the
  old unit. This is the failure that silently corrupts a whole series, and it
  cannot be caught by eye.

**End-to-end, run once by hand before calling this done**: configure
`flow_rate` on the IWM device type, open a real meter's page, and confirm the
pipe actually animates. Every layer can be individually correct and the twin
still static — that is precisely how this bug arose.

The UI guard rails are ordinary form validation and need no dedicated suite.

## Out of Scope

Each is a real feature; none is needed to make 59 meters move.

- Expression language or formula field.
- Two-metric arithmetic (`net = forward − reverse`, `power = V × I`).
- Derived-from-derived chains.
- Per-device overrides — configuration is per device type, matching the
  existing "new vendor/model → new device type" convention.
- Declaring `min`/`max` on the other 17 template call sites. The mechanism
  ships; populating ranges for existing device types is opportunistic.

## Related Defect — Fix Separately, Ship First

`resolveNumeric`'s substring pass let `reverse_flow_alarm` — an alarm boolean —
satisfy a lookup for a flow *rate*. That is wrong independently of this design
and will recur on other device types: any `*_alarm` / `*_status` key whose name
happens to contain a metric word can capture a numeric slot.

Suggested guard: exclude keys matching `*_alarm` / `*_status` / `*_flag` from
numeric slot matching, or require the matched key to carry a unit.

A handful of lines, no dependency on anything above. Ship it on its own.
