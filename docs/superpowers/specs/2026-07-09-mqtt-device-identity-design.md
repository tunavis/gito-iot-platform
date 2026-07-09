# MQTT Device Identity — Securing the Platform Broker

**Date:** 2026-07-09
**Status:** Approved (design) — ready for implementation planning
**Workstream:** Security & device identity (1 of 4 enterprise-readiness workstreams)

---

## Problem

The platform's own MQTT broker (`gito-mosquitto`, `eclipse-mosquitto:2.0`) runs with:

```
allow_anonymous true
```

no password file, no ACL. The processor subscribes to `+/devices/+/telemetry`,
reads `tenant_id` and `device_id` **straight from the topic string**, and only
checks that the device *exists* ([`mqtt_processor.py:1221`](../../../processor/mqtt_processor.py#L1221)) —
never that the publisher *is* that device.

**Net effect:** anyone with network access to the broker can inject or spoof
telemetry for **any device in any tenant** (cross-tenant data injection). This is
the single defect that disqualifies "enterprise-grade."

No live customer data is leaking today because production telemetry flows through
the LoRaWAN/ChirpStack path (see Scope), but the native-MQTT onboarding path the
platform *advertises* is wide open.

## Goal

Every device authenticates individually to the platform broker and may
publish/subscribe **only to its own topics**. Revocation is instant. Reuse the
existing `device_credentials` system — no parallel scheme. Keep the environment
simple: **one source of truth (Postgres), no per-device broker state to sync.**

## Scope

This secures **Case B only** — devices connecting *into* our broker. The other
ingest paths are already authenticated and are **out of scope**:

| Path | Direction | Auth today | In scope? |
|---|---|---|---|
| **Case B — MQTT-in** | device → our broker | none (anonymous) | **Yes — this doc** |
| Case A — LoRaWAN/ChirpStack | processor → customer's broker | customer broker auths us; creds stored per integration | No (already secure) |
| Case C — HTTP ingest | device → `POST /api/v1/ingest` | per-device token (`gito_dt_`), SHA-256, `resolve_device_token` | No (already secure) |

**Explicitly out of scope** (future workstreams): TLS/8883 transport encryption,
ChirpStack device provisioning, additional protocol adapters (Modbus/OPC-UA/CoAP),
credential-rotation UX beyond generate/revoke.

---

## Decision record — why EMQX

Per-device MQTT auth backed by our database, three options evaluated:

1. **`mosquitto-go-auth` (HTTP-auth plugin)** — the obvious Mosquitto choice.
   **Rejected:** the repository was **archived 2025-06-08** and is unmaintained.
   The maintainer explicitly stated no further changes will be made. Not
   future-proof.

2. **Mosquitto `dynsec` (native plugin)** — keeps the current broker, but the
   broker holds its own per-device client list that must be **synced** to the DB
   on every credential create/revoke. Two sources of truth; permanent custom sync
   code we own forever. **Rejected** for a cleaner option existing.

3. **EMQX open-source (chosen)** — native PostgreSQL authn *and* authz point
   **directly at `device_credentials` / `devices`**. No per-device broker state,
   no sync code — Postgres is the only source of truth. Actively maintained;
   PostgreSQL backends and `sha256`/salt-disabled hashing are confirmed available
   in the **open-source** edition (Enterprise only adds SSO/audit/geo-replication,
   which we do not need).

**Migration is small** because the external ChirpStack connection is
processor-side Python (`BridgeWorker` connecting *out* to customer brokers,
[`mqtt_processor.py:888`](../../../processor/mqtt_processor.py#L888)), **not** a
broker-level bridge. Swapping the platform broker does not touch it.

---

## Design

### 1. Credential model — reuse `device_credentials`

Add one credential type; no new table.

- `credential_type = 'mqtt_password'` — **one active per device** (distinct from
  the existing `device_token`, which is HTTP-only and may be many). Separate type
  keeps the auth lookup deterministic (one hash per device) and lets MQTT access
  be revoked without touching HTTP ingest.
- MQTT `username = device_id` (UUID); `password = gito_mq_<hex>` shown **once** at
  generation, stored only as `sha256(password)` in `credential_hash`.
- Same status/expiry/revoke machinery as today.
- One **service account** (`svc_processor`) with superuser rights for platform
  services (processor, command bridge).

Random high-entropy tokens do not need salting (salt defends low-entropy
passwords); this matches the existing `device_token` approach.

### 2. Broker → EMQX (open-source), single node, config-driven

Replace `eclipse-mosquitto:2.0` with `emqx/emqx:5` in dev + staging compose.
Port 1883 retained (8883/TLS is a later workstream). Keep the footprint minimal —
no dashboard RBAC, clustering, or geo-replication.

**Authentication (PostgreSQL authenticator)** — `password_hash_algorithm = {name = sha256, salt_position = disable}`:

```sql
SELECT credential_hash AS password_hash
FROM device_credentials
WHERE device_id = ${username}::uuid
  AND credential_type = 'mqtt_password'
  AND status = 'active'
  AND (expires_at IS NULL OR expires_at > now())
LIMIT 1
```

**Authorization (PostgreSQL authorizer)** — `no_match = deny`; the tenant is baked
into the topic string by SQL, so ACLs are exact per device+tenant (no wildcards):

```sql
SELECT 'allow' AS permission, 'publish' AS action,
       d.tenant_id || '/devices/' || d.id || '/telemetry' AS topic
FROM devices d WHERE d.id = ${username}::uuid
UNION ALL
SELECT 'allow' AS permission, 'subscribe' AS action,
       d.tenant_id || '/devices/' || d.id || '/commands' AS topic
FROM devices d WHERE d.id = ${username}::uuid
```

**Service account** — a `built_in_database` authenticator entry
(`svc_processor`, `is_superuser = true`) chained *before* the PostgreSQL
authenticator. Superusers bypass authz.

### 3. Processor + command bridge

Both connect to the platform broker with the service account
(`MQTT_SERVICE_USERNAME` / `MQTT_SERVICE_PASSWORD`). Because broker ACLs now
guarantee a message on `{tenant}/devices/{device}/telemetry` came from that
device, the processor's existing topic-trust + `device_exists` check becomes
sound with no processor code change. The outbound ChirpStack `BridgeWorker` is
untouched.

### 4. Connect instructions UX

Replace the hardcoded `anonymous` in `ConnectionInstructionsModal`:

- On open, if the device has no active `mqtt_password`, generate one and show it
  **once** (copy + regenerate). The MQTT snippet uses `username = <device_id>`,
  `password = <secret>`, real host/port.
- New endpoint on the existing credentials router: `POST …/credentials/mqtt`
  (generate/rotate, returns the secret once), reusing the current
  generate/hash/revoke logic. The credential appears in the device's credential
  list with a revoke action.

### 5. Config / migration / rollout

- **Schema:** no change required. Optional partial unique index to enforce one
  active `mqtt_password` per device.
- Seed the `svc_processor` service account (DB row + EMQX built-in entry) via
  migration/bootstrap.
- EMQX authn/authz configured via mounted config in dev + staging compose; add a
  healthcheck.
- **Breaking change** for anything currently publishing anonymously → rollout:
  1. Deploy EMQX with anonymous still permitted (grace window).
  2. Generate `mqtt_password` for existing devices; surface the new creds.
  3. Flip anonymous off.
- HTTP token ingest and the ChirpStack bridge are unaffected throughout.

---

## Success criteria

- Anonymous publish/subscribe to the platform broker is **rejected**.
- A device can publish only to its own `…/telemetry` topic and subscribe only to
  its own `…/commands`; another device's topic is **denied**.
- Revoking a device's `mqtt_password` cuts it off **immediately** (next connect
  fails; cache TTL ≤ 60 s bound).
- The Connect instructions show **real per-device credentials**, never
  `anonymous`.
- HTTP token ingest and the ChirpStack/LoRaWAN path continue working unchanged.

## Testing

- **Unit (pytest):** run the authn and authz SQL against a seeded device +
  credential and assert the decision — valid → allow; revoked / expired /
  wrong-device / wrong-tenant → deny; service account → allow. This is the
  security-critical path and gets a runnable check.
- **Integration:** bring up EMQX locally; with `mosquitto_pub`:
  anonymous → refused; correct creds to own topic → accepted; correct creds to
  another device's topic → refused; after revoke → refused. All against the
  **local** EMQX only — never a customer/production broker.

## Risks

| Risk | Mitigation |
|---|---|
| Breaking change for anonymous publishers | Phased rollout (grace window → issue creds → flip anonymous off) |
| EMQX operational learning curve | Minimal single-node, config-driven footprint; ignore enterprise features; it is a drop-in broker with real auth |
| authn/authz SQL correctness | Unit-tested decision path; default-deny authorization |
| Service-account credential leakage | Injected via env/secret, superuser scope limited to platform services on the internal network |
