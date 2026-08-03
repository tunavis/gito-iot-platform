# Uptime monitoring

Watching `/api/health` from outside the platform. No code change is required —
the endpoint already reports everything below.

## Why this exists

A dropped MQTT subscription once ate 43 hours of telemetry across all 68 devices
before anyone noticed, and an 11-hour outage repeated it. The platform *detected*
both: `check_ingestion_stall` runs on a timer and is correct. It wrote
`logger.error` into a container log nobody was reading.

Delivery of that signal inside the platform is
`openspec/changes/add-notification-sources`. This document is the other half, and
it is not made redundant by that change: **a platform that is down cannot notify
you that it is down.** An external monitor is the only thing that covers the API
being unreachable at all.

## What to watch

```
GET https://<host>/api/health
```

Unauthenticated by design. Returns JSON:

```json
{
  "status": "healthy",
  "service": "Gito IoT Platform",
  "checks": {
    "database":  { "status": "ok" },
    "keydb":     { "status": "ok" },
    "ingestion": { "status": "ok", "last_uplink_age_seconds": 42, "detail": null },
    "mcp":       { "status": "disabled", "protocol_version": "..." }
  }
}
```

### ⚠️ Match on the body, not the HTTP status code

**A degraded platform returns HTTP 200.** A monitor that only checks for a 2xx
will report everything fine through a total ingestion stall.

That is deliberate, not a bug — see `api/app/main.py:239`. Returning 503 would
make Docker's healthcheck restart the API over a fault that lives in the
processor, taking the UI down to fix nothing.

| Overall `status` | HTTP | Meaning |
|---|---|---|
| `healthy` | 200 | Everything reporting. |
| `degraded` | 200 | KeyDB down **or** ingestion stalled. The platform serves, but telemetry may not be arriving. |
| `unhealthy` | 503 | Database unreachable. |

So configure the monitor to require the keyword `"status":"healthy"` in the
response body, and alert when it is absent. That single check covers all three
rows above plus the endpoint being unreachable.

### Reading `checks.ingestion`

| `status` | Meaning |
|---|---|
| `ok` | A device reported within `INGESTION_STALL_THRESHOLD_SECONDS` (default 900). |
| `idle` | No device has *ever* reported. A fresh deployment, not a fault. |
| `stalled` | Devices have reported before and the whole fleet is now silent past the threshold. |

`stalled` stays `stalled` however long it lasts — there is no window after which
a dead pipeline stops being a problem. `last_uplink_age_seconds` tells you how
long it has been going.

## Where to run it

**Prefer a monitor that is not on the same box as the platform.** A same-box
monitor catches an ingestion stall (the app is up, telemetry is not arriving) but
dies with the host in exactly the case you most want to hear about. Any of the
free hosted tiers — healthchecks.io, Better Stack, UptimeRobot — is enough for
one endpoint, and all three support response-body keyword matching.

Self-hosting Uptime Kuma on the homelab is fine as a *second* check, not the only
one.

Suggested settings:

- **Interval**: 60s. The stall threshold is already 900s, so a slower poll just
  adds latency to a signal that is deliberately slow to trigger.
- **Keyword**: `"status":"healthy"` — alert when **not** present.
- **Retries before alerting**: 2. Avoids paging on one dropped request, still
  well inside the stall threshold.

## First alert to expect

If you set this up while the fleet is quiet, the first alert may be a real
`idle`/`stalled` rather than a misconfiguration. Check
`checks.ingestion.detail` — it states the age and the threshold — before
assuming the monitor is wrong.

When it does fire on a stall, the processor's MQTT subscription is the first
thing to look at:

```bash
docker logs gito-processor | tail -20
```
